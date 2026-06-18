/**
 * ⑤ T② — SW-side orchestration for WEB_LLM_NEEDS_RELOGIN.
 *
 * When the relay's MAIN-world fetcher gets a 401/403, it posts
 * WEB_LLM_NEEDS_RELOGIN to the SW. This handler:
 *   1. Invalidates the bundle cache for that provider (so the next
 *      resolveBundle() returns null → user sees "please log in" error
 *      instead of stale 401)
 *   2. Broadcasts a 'web_provider_needs_relogin' ServerMessage to all
 *      connected sidepanel ports (so the UI can open Settings +
 *      highlight the failed provider + show a toast)
 *
 * Testability: handleWebProviderRelogin() is a pure function that
 * takes injected deps. registerWebProviderReloginHandler() wires the
 * chrome.runtime.onMessage listener and is called once at SW startup.
 */

import { WEB_LLM_NEEDS_RELOGIN, type WebProviderRelayMessage } from '@/lib/ai-config/web-provider-relay';
import { invalidateBundle } from '@/lib/ai-config/web-provider-bundle';
import type { WebProvider } from '@/lib/types';

/**
 * ServerMessage variant broadcast to sidepanel ports when a provider
 * needs re-login. The sidepanel handler (⑤.4) opens Settings, scrolls
 * to the failed provider card, and shows a toast.
 */
export interface WebProviderNeedsReloginMessage {
  type: 'web_provider_needs_relogin';
  providerId: WebProvider['presetId'];
  status: 401 | 403;
  message: string;
}

/** Dependencies injected for testability. */
export interface WebProviderReloginDeps {
  /** Broadcast a server message to all connected sidepanel ports. */
  broadcast: (msg: WebProviderNeedsReloginMessage) => void;
  /** Invalidate the bundle cache for a provider. */
  invalidateBundle: (providerId: WebProvider['presetId']) => void;
}

/**
 * Pure handler: inspects the relay message, invalidates the bundle,
 * broadcasts to the UI. Returns true if handled, false to let other
 * listeners process the message.
 */
export function handleWebProviderRelogin(
  msg: WebProviderRelayMessage,
  deps: WebProviderReloginDeps,
): boolean {
  if (msg.type !== WEB_LLM_NEEDS_RELOGIN) return false;

  // 1. Invalidate bundle cache FIRST so the next resolveBundle() returns
  //    null → chat will show "please log in" instead of looping on 401.
  //    Order matters: the broadcast may trigger UI that reads bundle state.
  deps.invalidateBundle(msg.providerId);

  // 2. Broadcast to sidepanel ports to open Settings + highlight.
  deps.broadcast({
    type: 'web_provider_needs_relogin',
    providerId: msg.providerId,
    status: msg.status,
    message: msg.message,
  });

  return true;
}

let _chromeListenerInstalled = false;
let _currentDeps: WebProviderReloginDeps | null = null;

/**
 * Register a chrome.runtime.onMessage listener for WEB_LLM_NEEDS_RELOGIN.
 * Idempotent: safe to call multiple times (only installs the listener once).
 * Call this ONCE at SW startup (entrypoints/background/index.ts).
 */
export function registerWebProviderReloginHandler(deps: WebProviderReloginDeps): void {
  _currentDeps = deps;
  if (_chromeListenerInstalled) return;
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    if (!_currentDeps) return false;
    if (!msg || typeof msg !== 'object') return false;
    return handleWebProviderRelogin(msg as WebProviderRelayMessage, _currentDeps);
  });
  _chromeListenerInstalled = true;
}

/** Test-only: reset module-level state. Use in vitest beforeEach. */
export function _resetReloginHandlerForTesting(): void {
  _currentDeps = null;
  _chromeListenerInstalled = false;
}
