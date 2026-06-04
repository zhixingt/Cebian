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
