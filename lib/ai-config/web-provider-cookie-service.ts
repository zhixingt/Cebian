/**
 * Background service for web provider cookie extraction & encrypted storage.
 *
 * Handles 2 message types from the React hook:
 *   - WEB_PROVIDER_LOGIN: open tab, poll for cookies, encrypt, persist
 *   - WEB_PROVIDER_RECHECK: verify stored credentials still decrypt
 *
 * Implements 6 production-grade enhancements (A1-A6):
 *   A3: Active tab tracking (background polling throttling)
 *   A4: Login attempt audit log (writes to Dexie on every attempt)
 *   A5: RefreshAuth retry with exponential backoff
 *   A6: Detect already-open tab (reuse instead of open)
 */

import { WEB_PROVIDER_PRESETS, resolveEffectiveConfig } from './web-provider-presets';
import { getWebProviderRepository } from './web-provider-store';
import { encryptCookieBundle, decryptCookieBundle } from './web-provider-crypto';
import type {
  WebProvider,
  LoginAuditEntry,
  LoginStatus,
} from '../types';

const POLL_INTERVAL_MS = 2_000;
const BACKGROUND_POLL_INTERVAL_MS = 5_000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000;
const MIN_WAIT_MS = 5_000;
const REFRESH_AUTH_MAX_ATTEMPTS = 3;
const REFRESH_AUTH_BACKOFFS = [1000, 2000, 4000] as const;

const COMMON_AUTH_COOKIES = ['lastActiveOrg', 'XSRF-TOKEN', 'csrf_token'] as const;

interface LoginResponse {
  success: boolean;
  status?: LoginStatus;
  error?: string;
  capturedCookieNames?: string[];
  capturedTokenSources?: Array<'cookie' | 'localStorage'>;
}

/**
 * Register the message listener. Idempotent: call once from background.ts.
 * The listener dispatches based on msg.type and returns true to keep the
 * message channel open (we use async sendResponse).
 */
export function registerCookieService(): void {
  chrome.runtime.onMessage.addListener((msg: any, _sender: any, sendResponse: any) => {
    if (msg?.type === 'WEB_PROVIDER_LOGIN') {
      handleLogin(msg.presetId)
        .then(sendResponse)
        .catch(err => {
          sendResponse({ success: false, error: String(err), status: 'loggedOut' as LoginStatus });
        });
      return true;
    }
    if (msg?.type === 'WEB_PROVIDER_RECHECK') {
      handleRecheck(msg.presetId)
        .then(sendResponse)
        .catch(err => {
          sendResponse({ success: false, error: String(err), status: 'loggedOut' as LoginStatus });
        });
      return true;
    }
    return false;
  });
}

// ====== Login Flow ======

async function handleLogin(presetId: string): Promise<LoginResponse> {
  const presetIdTyped = presetId as WebProvider['presetId'];
  const preset = WEB_PROVIDER_PRESETS.find(p => p.id === presetIdTyped);
  if (!preset) {
    return { success: false, error: 'Unknown preset', status: 'loggedOut' };
  }
  const repo = getWebProviderRepository();
  const provider = await repo.get(presetIdTyped);
  if (!provider) {
    return { success: false, error: 'Provider not found', status: 'loggedOut' };
  }
  const effective = resolveEffectiveConfig(provider, preset);

  // A6: open or focus existing tab
  const tabId = await openOrFocusLoginTab(effective.loginUrl);

  // A3: track focus state for throttling
  let isTabFocused = true;
  const onActivated = (activeInfo: { tabId: number; windowId: number }) => {
    isTabFocused = activeInfo.tabId === tabId;
  };
  const onFocusChanged = (windowId: number) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      isTabFocused = false;
    } else {
      chrome.tabs.get(tabId).then(t => {
        chrome.windows.get(t.windowId, (w: any) => {
          isTabFocused = w.focused;
        });
      }).catch(() => { /* tab gone */ });
    }
  };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.windows.onFocusChanged.addListener(onFocusChanged);

  const startTime = Date.now();
  let lastError: string | null = null;

  try {
    const tokens = await pollForSession(
      tabId,
      effective,
      startTime,
      () => isTabFocused,
      (err) => { lastError = err; },
    );
    if (!tokens) {
      const errorStr: string = lastError ?? '';
      const result: 'timeout' | 'tab-closed' = errorStr.includes('closed') ? 'tab-closed' : 'timeout';
      await appendAudit(presetId, {
        timestamp: new Date().toISOString(),
        result,
        errorMessage: lastError ?? undefined,
      });
      await safeRemoveTab(tabId);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.windows.onFocusChanged.removeListener(onFocusChanged);
      return { success: false, error: lastError ?? 'Login failed', status: 'loggedOut' };
    }

    const captured: Record<string, string> = { ...tokens.cookies };

    // A5: refresh auth retry for GLM (only when refreshUrl is set)
    if (effective.refreshUrl) {
      const refreshToken = captured['chatglm_refresh_token'] || captured['refresh_token'];
      if (refreshToken && !captured['chatglm_token']) {
        const accessToken = await tryRefreshAuthWithRetry(
          effective.refreshUrl,
          refreshToken,
          tabId,
        );
        if (accessToken) {
          captured['chatglm_token'] = accessToken;
        } else {
          await appendAudit(presetId, {
            timestamp: new Date().toISOString(),
            result: 'refresh-failed',
            errorMessage: 'RefreshAuth failed after 3 attempts; stored refresh_token only',
          });
        }
      }
    }

    const ciphertext = await encryptCookieBundle(JSON.stringify(captured));
    await repo.setEncryptedCookieBundle(presetId as WebProvider['presetId'], ciphertext);
    await repo.setLoginStatus(presetId as WebProvider['presetId'], 'loggedIn');

    const cookiesCaptured = Object.keys(captured).length;
    const auditEntry: LoginAuditEntry = {
      timestamp: new Date().toISOString(),
      result: 'success',
      source: tokens.source,
      cookiesCaptured,
    };
    await appendAudit(presetId, auditEntry);

    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.windows.onFocusChanged.removeListener(onFocusChanged);
    await safeRemoveTab(tabId);

    return {
      success: true,
      status: 'loggedIn',
      capturedCookieNames: Object.keys(captured),
      capturedTokenSources: [tokens.source],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAudit(presetId, {
      timestamp: new Date().toISOString(),
      result: 'no-cookies',
      errorMessage: message,
    });
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.windows.onFocusChanged.removeListener(onFocusChanged);
    await safeRemoveTab(tabId);
    return { success: false, error: message, status: 'loggedOut' };
  }
}

// ====== Recheck Flow ======

async function handleRecheck(presetId: string): Promise<LoginResponse> {
  const presetIdTyped = presetId as WebProvider['presetId'];
  const repo = getWebProviderRepository();
  const provider = await repo.get(presetIdTyped);
  if (!provider?.encryptedCookieBundle) {
    return { success: false, error: 'No stored credentials', status: 'loggedOut' };
  }
  try {
    const plaintext = await decryptCookieBundle(provider.encryptedCookieBundle);
    JSON.parse(plaintext);  // validate it's still parseable JSON
    return { success: true, status: 'loggedIn' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAudit(presetId, {
      timestamp: new Date().toISOString(),
      result: 'decryption-failed',
      errorMessage: message,
    });
    return { success: false, error: message, status: 'loggedOut' };
  }
}

// ====== A6: Open or Focus Existing Tab ======

async function openOrFocusLoginTab(loginUrl: string): Promise<number> {
  const url = new URL(loginUrl);
  const urlPattern = `*://${url.hostname}/*`;
  const existingTabs = await chrome.tabs.query({ url: urlPattern });
  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.tabs.update(tab.id!, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return tab.id!;
  }
  const tab = await chrome.tabs.create({ url: loginUrl, active: true });
  return tab.id!;
}

// ====== A3: Polling with Focus-Aware Throttling ======

async function pollForSession(
  tabId: number,
  preset: ReturnType<typeof resolveEffectiveConfig>,
  startTime: number,
  isTabFocused: () => boolean,
  onError: (err: string) => void,
): Promise<{ cookies: Record<string, string>; source: 'cookie' | 'localStorage' } | null> {
  while (Date.now() - startTime < LOGIN_TIMEOUT_MS) {
    // Check tab still exists
    try {
      await chrome.tabs.get(tabId);
    } catch {
      // Last-chance probe: users may close the tab right after login succeeds.
      // For cookie-based providers (GLM/DeepSeek), we can still detect the
      // session directly from cookie jar even if the tab is gone.
      const cookieSession = await tryCaptureCookieSession(preset);
      if (cookieSession) return cookieSession;

      onError('Login tab was closed before session was detected');
      return null;
    }

    // MIN_WAIT before first check (chromeclaw pattern)
    if (Date.now() - startTime < MIN_WAIT_MS) {
      await sleep(500);
      continue;
    }

    try {
      const cookieSession = await tryCaptureCookieSession(preset);
      if (cookieSession) return cookieSession;

      if (preset.useLocalStorageFallback) {
        const lsTokens = await readLocalStorageFromTab(tabId, preset.sessionIndicators);
        if (Object.keys(lsTokens).length > 0) {
          return { cookies: lsTokens, source: 'localStorage' };
        }
      }
    } catch (err) {
      onError(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // A3: focus-aware interval
    const interval = isTabFocused() ? POLL_INTERVAL_MS : BACKGROUND_POLL_INTERVAL_MS;
    await sleep(interval);
  }
  onError(`Login timed out after ${LOGIN_TIMEOUT_MS / 1000}s`);
  return null;
}

async function tryCaptureCookieSession(
  preset: ReturnType<typeof resolveEffectiveConfig>,
): Promise<{ cookies: Record<string, string>; source: 'cookie' } | null> {
  const cookies = await chrome.cookies.getAll({ domain: preset.cookieDomain });
  const cookieMap: Record<string, string> = {};
  for (const c of cookies) cookieMap[c.name] = c.value;

  const matched = preset.sessionIndicators.filter((n: string) => cookieMap[n]);
  if (matched.length === 0) return null;

  const captured: Record<string, string> = {};
  for (const n of preset.sessionIndicators) {
    if (cookieMap[n]) captured[n] = cookieMap[n];
  }
  for (const n of COMMON_AUTH_COOKIES) {
    if (cookieMap[n]) captured[n] = cookieMap[n];
  }
  return { cookies: captured, source: 'cookie' };
}

// ====== localStorage Fallback (MAIN world) ======

async function readLocalStorageFromTab(
  tabId: number,
  keys: string[],
): Promise<Record<string, string>> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',  // CRITICAL: page's localStorage, not isolated
      func: (keysToRead: string[]) => {
        const out: Record<string, string> = {};
        for (const k of keysToRead) {
          const v = localStorage.getItem(k);
          if (v !== null) out[k] = v;
        }
        return out;
      },
      args: [keys],
    });
    return (results?.[0]?.result as Record<string, string>) ?? {};
  } catch (err) {
    console.warn('[web-provider] localStorage read failed:', err);
    return {};
  }
}

// ====== A5: RefreshAuth with Retry ======

async function tryRefreshAuthWithRetry(
  refreshUrl: string,
  refreshToken: string,
  tabId: number,
): Promise<string | null> {
  for (let attempt = 1; attempt <= REFRESH_AUTH_MAX_ATTEMPTS; attempt++) {
    const token = await tryRefreshAuth(refreshUrl, refreshToken, tabId);
    if (token) return token;
    if (attempt < REFRESH_AUTH_MAX_ATTEMPTS) {
      await sleep(REFRESH_AUTH_BACKOFFS[attempt - 1]);
    }
  }
  return null;
}

async function tryRefreshAuth(
  refreshUrl: string,
  refreshToken: string,
  tabId: number,
): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (url: string, token: string) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({}),
            credentials: 'include',
          });
          if (!res.ok) return null;
          const data = await res.json();
          return (
            data?.result?.access_token ??
            data?.result?.accessToken ??
            data?.accessToken ??
            null
          );
        } catch {
          return null;
        }
      },
      args: [refreshUrl, refreshToken],
    });
    return (results?.[0]?.result as string | null) ?? null;
  } catch {
    return null;
  }
}

// ====== Helpers ======

async function appendAudit(presetId: string, entry: LoginAuditEntry): Promise<void> {
  try {
    await getWebProviderRepository().appendAuditEntry(presetId as WebProvider['presetId'], entry);
  } catch (err) {
    console.warn('[web-provider] failed to append audit entry:', err);
  }
}

async function safeRemoveTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* tab may already be closed */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
