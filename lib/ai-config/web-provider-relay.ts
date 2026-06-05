/**
 * ⑧ Tab registry for the DOM-injection relay.
 *
 * Why a registry:
 *   - Web session chat requires a real tab (we reuse the browser's logged-in session)
 *   - Opening a fresh tab for every chat is wasteful (page load, JS init, session revalidation)
 *   - One tab per provider, reused across requests
 *   - Auto-close after 5min idle (chromeclaw pattern) to free resources
 *
 * ⑧ NEW: This is a thin wrapper around TabRegistry. The actual DOM-injection
 * logic lives in web-provider-content-script.ts; the message types and
 * injection entry point are exported here for the SW listener + stream layer.
 */

import type { WebProvider } from '../types';
import {
  runDomRelayMainWorld,
  installIsolatedBridge,
  type DomRelayRequest,
} from './web-provider-content-script';

const TAB_IDLE_CLOSE_MS = 5 * 60 * 1000;  // 5 minutes
/** Default timeout for a single chat stream (no end signal = stall = abort). */
export const WEB_SESSION_TIMEOUT_MS = 60_000;

/**
 * ⑪.7: Read HttpOnly cookies for a provider that the MAIN world can't see
 * via `document.cookie`. Used to pass an Authorization header to adapters
 * that need the token as a Bearer header.
 *
 * Returns `'Bearer <token>'` (the full Authorization header value) or
 * `null` if no auth cookie is found for the provider.
 */
export async function getAuthHeadersForProvider(
  providerId: WebProvider['presetId'],
): Promise<string | null> {
  // Reserved for future providers that need HttpOnly cookie auth.
  // Currently GLM and DeepSeek read auth from localStorage / non-HttpOnly
  // cookies, so no SW-side HttpOnly read is required.
  return null;
}

export interface TabRegistryConfig {
  /** Override the idle close timeout. Production: 5min. Tests: small values. */
  idleCloseMs: number;
}

interface TabEntry {
  tabId: number;
  openedAt: number;
  lastUsedAt: number;
  /** setTimeout handle for the auto-close; null only briefly during construction */
  closeTimerId: ReturnType<typeof setTimeout>;
}

export class TabRegistry {
  private tabs = new Map<WebProvider['presetId'], TabEntry>();

  constructor(private config: TabRegistryConfig = { idleCloseMs: TAB_IDLE_CLOSE_MS }) {}

  /**
   * Get or open a tab for the given provider.
   *
   * Lookup order (chromeclaw pattern):
   *   1. In-memory registry (fast path — we already have a tab)
   *   2. Chrome tab query by hostname (cold-start path — user may have the provider open)
   *   3. chrome.tabs.create (last resort)
   *
   * @returns tabId
   */
  async openOrReuseTab(
    providerId: WebProvider['presetId'],
    url: string,
  ): Promise<number> {
    // 1. Registry hit
    const existing = this.tabs.get(providerId);
    if (existing) {
      this.markUsed(providerId);
      return existing.tabId;
    }

    // 2. Cold-start: check Chrome for an existing tab at the same hostname
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL for provider ${providerId}: ${url}`);
    }
    const pattern = `*://${parsed.hostname}/*`;
    const chromeTabs = await chrome.tabs.query({ url: pattern });
    if (chromeTabs.length > 0) {
      const tabId = chromeTabs[0].id!;
      this.tabs.set(providerId, this.createEntry(providerId, tabId));
      return tabId;
    }

    // 3. Cold-start: open new tab (active=false — don't disturb user's focus)
    const tab = await chrome.tabs.create({ url, active: false });
    this.tabs.set(providerId, this.createEntry(providerId, tab.id!));
    return tab.id!;
  }

  /**
   * Reset the idle timer for a provider's tab. Call this on every successful
   * stream chunk / message so the tab stays alive while in active use.
   */
  markUsed(providerId: WebProvider['presetId']): void {
    const entry = this.tabs.get(providerId);
    if (!entry) return;
    entry.lastUsedAt = Date.now();
    clearTimeout(entry.closeTimerId);
    entry.closeTimerId = setTimeout(
      () => { void this.closeTab(providerId); },
      this.config.idleCloseMs,
    );
  }

  /**
   * Manually close a tab and clear registry state. Idempotent.
   * Swallows chrome.tabs.remove errors (tab may already be closed).
   */
  async closeTab(providerId: WebProvider['presetId']): Promise<void> {
    const entry = this.tabs.get(providerId);
    if (!entry) return;
    clearTimeout(entry.closeTimerId);
    try {
      await chrome.tabs.remove(entry.tabId);
    } catch {
      // Tab may already be closed (user closed it, SW restarted, etc.)
    }
    this.tabs.delete(providerId);
  }

  /**
   * Get the current tabId for a provider, or undefined if no tab is open.
   */
  getTab(providerId: WebProvider['presetId']): number | undefined {
    return this.tabs.get(providerId)?.tabId;
  }

  /**
   * Test-only: clear all state. Use in vitest beforeEach.
   */
  clearAll(): void {
    for (const [pid, entry] of this.tabs) {
      clearTimeout(entry.closeTimerId);
    }
    this.tabs.clear();
  }

  private createEntry(providerId: WebProvider['presetId'], tabId: number): TabEntry {
    const now = Date.now();
    return {
      tabId,
      openedAt: now,
      lastUsedAt: now,
      closeTimerId: setTimeout(
        () => { void this.closeTab(providerId); },
        this.config.idleCloseMs,
      ),
    };
  }
}

// ===== Singleton =====

let _instance: TabRegistry | null = null;
let _singletonConfig: TabRegistryConfig = { idleCloseMs: TAB_IDLE_CLOSE_MS };

export function getTabRegistry(): TabRegistry {
  if (!_instance) {
    _instance = new TabRegistry(_singletonConfig);
  }
  return _instance;
}

// ===== Test-only hooks =====

/**
 * Test-only: reset the singleton with an optional config override.
 * Use in vitest beforeEach; pass {idleCloseMs: 100} for fast auto-close tests.
 */
export function _resetTabRegistryForTesting(config?: TabRegistryConfig): void {
  if (_instance) {
    _instance.clearAll();
  }
  _instance = null;
  _singletonConfig = config ?? { idleCloseMs: TAB_IDLE_CLOSE_MS };
}

/**
 * Test-only: get the internal TabEntry for a provider (exposes lastUsedAt + closeTimerId).
 * Use to assert markUsed reset behavior.
 */
export function _getTabEntryForTesting(
  registry: TabRegistry,
  providerId: WebProvider['presetId'],
): TabEntry | undefined {
  // Access private field via type assertion (test-only)
  return (registry as unknown as { tabs: Map<WebProvider['presetId'], TabEntry> }).tabs.get(providerId);
}

// ====================================================================
// ⑧ Message contract (re-export from content script for SW convenience)
// ====================================================================

import { diag, diagError } from './web-provider-diag';

export const WEB_LLM_RELAY_READY = 'WEB_LLM_RELAY_READY' as const;
export const WEB_LLM_CHUNK = 'WEB_LLM_CHUNK' as const;
export const WEB_LLM_DONE = 'WEB_LLM_DONE' as const;
export const WEB_LLM_ERROR = 'WEB_LLM_ERROR' as const;
export const WEB_LLM_NEEDS_RELOGIN = 'WEB_LLM_NEEDS_RELOGIN' as const;
// ⑨.2: multi-turn — adapter emits this when it has the canonical
// conversation/session/parent_message id from the server. The SW listener
// persists it to webProviderConversations so the next buildContentFetchRequest
// can echo it back. Providers that don't track a session id (or whose
// server is stateless) simply don't emit this event.
export const WEB_LLM_CONVERSATION_UPDATE = 'WEB_LLM_CONVERSATION_UPDATE' as const;

/**
 * Discriminated union of messages the content script sends to the SW.
 * ⑧: removed toolcall events (web session providers don't emit tool calls
 * via the DOM; tool use is not in MVP scope for this relay).
 */
export type WebProviderRelayMessage =
  | { type: typeof WEB_LLM_RELAY_READY; providerId: WebProvider['presetId'] }
  | {
      type: typeof WEB_LLM_CHUNK;
      providerId: WebProvider['presetId'];
      text?: string;
      /** ⑪: raw SSE-style chunk for content-fetch adapters (Kimi/DeepSeek/GLM). */
      chunk?: string;
      reasoning?: string;
    }
  | { type: typeof WEB_LLM_DONE; providerId: WebProvider['presetId']; stopReason?: string }
  | { type: typeof WEB_LLM_ERROR; providerId: WebProvider['presetId']; error: string }
  | { type: typeof WEB_LLM_NEEDS_RELOGIN; providerId: WebProvider['presetId']; status: 401 | 403; message: string }
  | {
      type: typeof WEB_LLM_CONVERSATION_UPDATE;
      providerId: WebProvider['presetId'];
      modelId: string;
      conversationId?: string;
      parentMessageId?: string;
    };

// ====================================================================
// ⑧ injectDomRelay: SW → ISOLATED bridge → MAIN fetcher
// ====================================================================

/**
 * Inject the DOM relay scripts into a tab.
 *
 * Order matters: ISOLATED must run first so it can register the
 * `window.postMessage` listener before MAIN starts emitting.
 *
 * @param tabId - the Chrome tab to inject into
 * @param request - the DOM relay request (providerId, modelId, message, strategy)
 * @returns the ISOLATED injection result (used to confirm bridge is up)
 */
export async function injectDomRelay(
  tabId: number,
  request: DomRelayRequest,
): Promise<unknown> {
  // 1. ISOLATED bridge: forwards window.postMessage from MAIN to SW
  const isolatedResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: installIsolatedBridge,
    args: [request.providerId],
  });

  // 2. MAIN orchestrator: set message + send + poll DOM
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: runDomRelayMainWorld,
    args: [request],
  });

  return isolatedResult;
}

// ====================================================================
// ⑪ injectContentFetch: SW → ISOLATED bridge → MAIN per-provider fetch
// ====================================================================
//
// ⑪: chromeclaw-style HTTP-replay path. The MAIN-world function is the
// per-provider adapter (DeepSeek / Kimi / GLM) that performs its own
// auth + fetch + SSE stream. We reuse the SAME ISOLATED bridge as
// `injectDomRelay` so the SW listener doesn't need to care which path
// produced a given message — the message contract (WEB_LLM_RELAY_READY
// / CHUNK / DONE / ERROR / NEEDS_RELOGIN) is identical.
export type MainWorldFetchFunction = (request: unknown) => Promise<void>;

export async function injectContentFetch(
  tabId: number,
  providerId: WebProvider['presetId'],
  mainWorldFetch: MainWorldFetchFunction,
  request: unknown,
): Promise<unknown> {
  // ⑫: DIAGNOSTIC — trace each executeScript call. User flow failures
  // often manifest as silent chrome.scripting.executeScript rejections
  // (host_permissions, CSP, wrong target tabId, etc.). Routed through
  // the ⑨.4 diag gate — silent in production unless the user has
  // enabled `web_provider_debug` in chrome.storage.local.
  diag('WS-DIAG', `injectContentFetch: tabId=${tabId} providerId=${providerId}`);

  // 1. ISOLATED bridge first (so it can attach a window.message listener
  //    that forwards WEB_LLM_* events to chrome.runtime).
  let isolatedResult: unknown;
  try {
    isolatedResult = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: installIsolatedBridge,
      args: [providerId],
    });
    diag('WS-DIAG', `ISOLATED bridge installed for ${providerId}`);
  } catch (e) {
    diagError('WS-DIAG', `ISOLATED bridge FAILED for ${providerId}`, e);
    throw e;
  }
  // 2. MAIN world per-provider fetch.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: mainWorldFetch,
      args: [request],
    });
    diag('WS-DIAG', `MAIN adapter invoked for ${providerId}`);
  } catch (e) {
    diagError('WS-DIAG', `MAIN adapter invoke FAILED for ${providerId}`, e);
    throw e;
  }
  return isolatedResult;
}

// ====================================================================
// Legacy HTTP-replay exports (REMOVED in ⑧)
// ====================================================================
// ⑧: removed because the HTTP-replay approach cannot work for any of the
// 3 built-in providers (T1 2026-06-04). See CHANGELOG ⑧ for details.
//   - parseSseFrames
//   - parseDelta
//   - processChatStream
//   - executeChatRequest (the HTTP fetcher)
//   - runMainFetcher
//   - WebProviderChatRequest
//   - WEB_LLM_TOOLCALL_START / _DELTA / _END
