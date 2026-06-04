/**
 * ③+④ T6 — Tab registry for the network relay.
 *
 * Why a registry:
 *   - Web session chat requires a real tab (CORS + first-party cookies)
 *   - Opening a fresh tab for every chat is wasteful (page load, JS init, cookie rotation)
 *   - One tab per provider, reused across requests
 *   - Auto-close after 5min idle (chromeclaw pattern) to free resources
 *
 * This is the foundation; T7 adds injectScripts, T8 adds SSE parsing, T9 adds abort/timeout.
 *
 * Note: T6 is the *registry* layer. The actual fetch happens in the injected content scripts
 * (T7-T8), which postMessage back to the SW where runWebSessionStream (T10) consumes the stream.
 */

import type { WebProvider } from '../types';

const TAB_IDLE_CLOSE_MS = 5 * 60 * 1000;  // 5 minutes

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

/**
 * Test-only: force a known lastUsedAt value on a tab entry.
 * Use to avoid Date.now() resolution issues in tests that assert markUsed updates lastUsedAt.
 */
export function _setLastUsedAtForTesting(
  registry: TabRegistry,
  providerId: WebProvider['presetId'],
  ms: number,
): void {
  const entry = (registry as unknown as { tabs: Map<WebProvider['presetId'], TabEntry> }).tabs.get(providerId);
  if (entry) entry.lastUsedAt = ms;
}

// ====================================================================
// T7: Script injection + message contract
// ====================================================================

/**
 * Message types for the MAIN → ISOLATED → SW pipeline.
 * String constants are exported so the injected scripts (which are stringified)
 * and the SW listener (typed TS) share the same source of truth.
 */
export const WEB_LLM_RELAY_READY = 'WEB_LLM_RELAY_READY' as const;
export const WEB_LLM_CHUNK = 'WEB_LLM_CHUNK' as const;
export const WEB_LLM_DONE = 'WEB_LLM_DONE' as const;
export const WEB_LLM_ERROR = 'WEB_LLM_ERROR' as const;

/**
 * Discriminated union of all messages the injected content scripts can send
 * to the SW via chrome.runtime.sendMessage. SW listener narrows on .type.
 */
export type WebProviderRelayMessage =
  | { type: typeof WEB_LLM_RELAY_READY; providerId: WebProvider['presetId'] }
  | { type: typeof WEB_LLM_CHUNK; providerId: WebProvider['presetId']; text: string; reasoning?: string }
  | { type: typeof WEB_LLM_DONE; providerId: WebProvider['presetId']; stopReason?: string }
  | { type: typeof WEB_LLM_ERROR; providerId: WebProvider['presetId']; error: string };

/**
 * Chat request payload passed from the SW to the MAIN-world fetcher.
 * The MAIN script serializes this for the provider's chat endpoint.
 */
export interface WebProviderChatRequest {
  providerId: WebProvider['presetId'];
  endpoint: string;
  bodyTemplate: string;
  streamFormat: 'sse' | 'jsonl';
  endSignal: string;
  deltaPath: string;
  reasoningPath?: string;
  stopReasonPath?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * Inject the relay scripts (ISOLATED bridge + MAIN fetcher) into a tab.
 *
 * Order matters: ISOLATED must run first so it can register the
 * `window.postMessage` listener before MAIN starts emitting.
 *
 * @param tabId - the Chrome tab to inject into
 * @param request - the chat request to send to the MAIN-world fetcher
 * @returns the ISOLATED injection result (used to confirm bridge is up)
 */
export async function injectRelayScripts(
  tabId: number,
  request: WebProviderChatRequest,
): Promise<unknown> {
  // 1. ISOLATED world: install the bridge that forwards window.postMessage
  //    from the page context (MAIN) to the SW via chrome.runtime.sendMessage.
  const isolatedResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: installIsolatedBridge,
    args: [request.providerId],
  });

  // 2. MAIN world: install the page-context fetcher that does the actual
  //    chat request (with first-party cookies) and postMessages results
  //    back to the ISOLATED bridge.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: runMainFetcher,
    args: [request],
  });

  return isolatedResult;
}

/**
 * ISOLATED-world bridge. Registered once per chat session per tab.
 * Listens for window.postMessage from the page context and forwards
 * to the SW via chrome.runtime.sendMessage.
 *
 * Stringified and executed via chrome.scripting.executeScript; must be
 * self-contained (no closure references to outer scope).
 */
function installIsolatedBridge(providerId: string): void {
  // Idempotent: don't double-register on re-injection
  const w = window as unknown as { __cebWebProviderBridge?: { providerId: string } };
  if (w.__cebWebProviderBridge?.providerId === providerId) return;

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'ceb-web-provider-main') return;
    if (data.providerId !== providerId) return;
    // Forward to SW
    chrome.runtime.sendMessage(data.payload).catch((err) => {
      console.warn('[ceb-web-provider-bridge] sendMessage failed:', err);
    });
  });

  w.__cebWebProviderBridge = { providerId };

  // Tell SW the bridge is up
  chrome.runtime.sendMessage({
    type: 'WEB_LLM_RELAY_READY',
    providerId,
  }).catch(() => { /* SW may not be ready; harmless */ });
}

/**
 * MAIN-world fetcher. Runs the actual chat request with first-party cookies.
 * Streams chunks back to the ISOLATED bridge via window.postMessage.
 *
 * Stringified and executed via chrome.scripting.executeScript; must be
 * self-contained (no closure references to outer scope).
 *
 * T8 will add the SSE parser; for T7 we just demonstrate the message contract.
 */
async function runMainFetcher(request: WebProviderChatRequest): Promise<void> {
  // T7 placeholder: the actual SSE streaming is implemented in T8.
  // For now, post a single error so the SW knows the bridge works.
  window.postMessage({
    source: 'ceb-web-provider-main',
    providerId: request.providerId,
    payload: {
      type: 'WEB_LLM_ERROR',
      providerId: request.providerId,
      error: 'T7 placeholder: SSE fetcher not yet implemented (T8)',
    },
  }, '*');
}
