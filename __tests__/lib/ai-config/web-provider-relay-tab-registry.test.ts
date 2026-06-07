import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TabRegistry, _resetTabRegistryForTesting } from '@/lib/ai-config/web-provider-relay';

/** Minimal subset of TabEntry (not exported from the module). */
interface TabEntry {
  tabId: number;
  openedAt: number;
  lastUsedAt: number;
  closeTimerId: ReturnType<typeof setTimeout>;
}

const PROVIDER = 'glm' as const;
const URL = 'https://chatglm.cn/';

/**
 * Stale tab regression test (2026-06-06):
 *
 * The registry used to return a cached tabId without verifying the tab
 * still exists in Chrome. After the user closes the tab (or SW restarts
 * but the in-memory map was reconstructed), the next chat attempt would
 * pass a dead tabId to the content script and fail with
 * "No tab with id: <n>".
 *
 * The fix: in `openOrReuseTab`, when the in-memory cache hits, call
 * `chrome.tabs.get(tabId)` to verify; if it throws (tab gone), fall
 * through to the cold-start path.
 */
describe('TabRegistry stale tab', () => {
  beforeEach(() => {
    _resetTabRegistryForTesting({ idleCloseMs: 60_000 });
  });

  it('falls back to chrome.tabs.query when cached tabId is dead', async () => {
    const registry = new (TabRegistry as unknown as { new (cfg: { idleCloseMs: number }): TabRegistry })({ idleCloseMs: 60_000 });

    // First call: create a new tab
    const created = { id: 111, url: URL };
    // Second chrome.tabs.query: should find a different existing tab (the "resurrected" one)
    const resurrected = { id: 222, url: URL };

    const getCalls: number[] = [];
    const chromeApi = {
      tabs: {
        get: vi.fn(async (tabId: number) => {
          getCalls.push(tabId);
          // Cached tab is dead
          if (tabId === 111) throw new Error(`No tab with id: ${tabId}`);
          return { id: tabId };
        }),
        query: vi.fn(async () => [resurrected]),
        create: vi.fn(),
        remove: vi.fn(async () => undefined),
      },
    };
    (globalThis as any).chrome = chromeApi;

    // Seed the registry with a dead tab
    (registry as unknown as { tabs: Map<string, TabEntry> }).tabs.set(PROVIDER, {
      tabId: 111,
      openedAt: Date.now(),
      lastUsedAt: Date.now(),
      closeTimerId: setTimeout(() => undefined, 60_000) as unknown as ReturnType<typeof setTimeout>,
    });

    const tabId = await registry.openOrReuseTab(PROVIDER, URL);

    // Should have attempted to verify the cached tab
    expect(getCalls).toContain(111);
    // Should NOT have re-created
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
    // Should have fallen back to chrome.tabs.query
    expect(chromeApi.tabs.query).toHaveBeenCalled();
    // And returned the resurrected tab
    expect(tabId).toBe(222);

    delete (globalThis as any).chrome;
  });

  it('returns cached tabId when it is still alive', async () => {
    const registry = new (TabRegistry as unknown as { new (cfg: { idleCloseMs: number }): TabRegistry })({ idleCloseMs: 60_000 });
    const chromeApi = {
      tabs: {
        get: vi.fn(async (tabId: number) => ({ id: tabId })),
        query: vi.fn(),
        create: vi.fn(),
        remove: vi.fn(async () => undefined),
      },
    };
    (globalThis as any).chrome = chromeApi;

    (registry as unknown as { tabs: Map<string, TabEntry> }).tabs.set(PROVIDER, {
      tabId: 555,
      openedAt: Date.now(),
      lastUsedAt: Date.now(),
      closeTimerId: setTimeout(() => undefined, 60_000) as unknown as ReturnType<typeof setTimeout>,
    });

    const tabId = await registry.openOrReuseTab(PROVIDER, URL);
    expect(tabId).toBe(555);
    expect(chromeApi.tabs.query).not.toHaveBeenCalled();

    delete (globalThis as any).chrome;
  });
});
