import { useCallback, useRef, useState } from 'react';
import type { WebProvider } from '@/lib/types';

export interface LastCaptureInfo {
  cookieNames: string[];
  tokenSources: Array<'cookie' | 'localStorage'>;
  capturedAt: string;
}

export interface WebLoginConfig {
  /** Called when login flow succeeds (cookies captured + encrypted + persisted). */
  onSuccess: (id: WebProvider['presetId']) => void;
  /** Called on any failure (timeout, tab closed, cookies insufficient, etc.). */
  onFailure: (id: WebProvider['presetId'], error: string) => void;
  /**
   * ⭐ A1: called when a successful capture happens, with the per-provider
   *        capture info. Persists past the login window so the UI can show
   *        "Captured N cookies" even after the tab auto-closes.
   *        Optional — only needed if the consumer wants persistent A1 display.
   */
  onCapture?: (id: WebProvider['presetId'], info: LastCaptureInfo) => void;
}

export interface WebLoginResult {
  /** Open new tab + poll for session cookies. 5s MIN_WAIT, 5min timeout. */
  login: (id: WebProvider['presetId']) => Promise<void>;
  /** Read stored credentials and verify they're still valid. No tab. */
  recheck: (id: WebProvider['presetId']) => Promise<void>;
  /** Which provider is currently in the login flow (one at a time). */
  checkingId: WebProvider['presetId'] | null;
  /** True while a login is in progress (for spinner on the Login button). */
  loginLoading: boolean;
  /** ⭐ A1: most recent capture metadata (across all providers). Cleared on next login. */
  lastCaptureInfo: LastCaptureInfo | null;
}

interface LoginResponse {
  success: boolean;
  status?: 'unknown' | 'checking' | 'loggedIn' | 'loggedOut' | 'expired';
  error?: string;
  capturedCookieNames?: string[];
  capturedTokenSources?: Array<'cookie' | 'localStorage'>;
}

/**
 * ② real web login hook (replaces useWebProviderSimulatedLogin).
 *
 * Sends messages to the background service worker (web-provider-cookie-service.ts):
 *   - login(id):    WEB_PROVIDER_LOGIN — full tab-open + poll + capture + encrypt + store
 *   - recheck(id):  WEB_PROVIDER_RECHECK — read + verify stored bundle, no tab
 *
 * Never auto-checks on mount. The user must click "Login" or "Re-check login status"
 * to trigger any verification. This matches the MVP's behavior and chromeclaw's design.
 *
 * The hook does NOT touch Dexie directly. On success/failure, it calls the provided
 * onSuccess/onFailure callbacks, which the SubSection wires to update.setLoginStatus().
 */
export function useWebProviderWebLogin(config: WebLoginConfig): WebLoginResult {
  const [checkingId, setCheckingId] = useState<WebProvider['presetId'] | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [lastCaptureInfo, setLastCaptureInfo] = useState<LastCaptureInfo | null>(null);
  const inFlightRef = useRef<WebProvider['presetId'] | null>(null);

  const sendRequest = useCallback(
    async (
      messageType: 'WEB_PROVIDER_LOGIN' | 'WEB_PROVIDER_RECHECK',
      id: WebProvider['presetId'],
      isLogin: boolean,
    ): Promise<void> => {
      // In-flight lock: ignore calls while another is in progress (matches MVP pattern)
      if (inFlightRef.current !== null) return;
      inFlightRef.current = id;
      setCheckingId(id);
      if (isLogin) setLoginLoading(true);

      try {
        const response: LoginResponse = await chrome.runtime.sendMessage({
          type: messageType,
          presetId: id,
        });
        if (response?.success) {
          // A1: capture metadata for UI transparency (only on login success)
          let captured: LastCaptureInfo | null = null;
          if (
            isLogin &&
            response.capturedCookieNames &&
            response.capturedTokenSources
          ) {
            captured = {
              cookieNames: response.capturedCookieNames,
              tokenSources: response.capturedTokenSources,
              capturedAt: new Date().toISOString(),
            };
            setLastCaptureInfo(captured);
            config.onCapture?.(id, captured);
          }
          config.onSuccess(id);
        } else {
          config.onFailure(id, response?.error ?? 'Unknown error');
        }
      } catch (err) {
        config.onFailure(
          id,
          err instanceof Error ? err.message : 'Request failed',
        );
      } finally {
        inFlightRef.current = null;
        setCheckingId(null);
        if (isLogin) setLoginLoading(false);
      }
    },
    [config],
  );

  const login = useCallback(
    (id: WebProvider['presetId']) => sendRequest('WEB_PROVIDER_LOGIN', id, true),
    [sendRequest],
  );

  const recheck = useCallback(
    (id: WebProvider['presetId']) => sendRequest('WEB_PROVIDER_RECHECK', id, false),
    [sendRequest],
  );

  return { login, recheck, checkingId, loginLoading, lastCaptureInfo };
}
