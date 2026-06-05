import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('9.4 diagnostic gating (chrome.storage flag)', () => {
  // Minimal chrome.storage.local mock + onChanged event bus.
  let storage: Record<string, unknown> = {};
  type ChangeListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => void;
  const listeners: ChangeListener[] = [];

  const mockChrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) storage[k] = v;
        }),
      },
      onChanged: {
        addListener: vi.fn((cb: ChangeListener) => {
          listeners.push(cb);
        }),
        removeListener: vi.fn((cb: ChangeListener) => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        }),
      },
    },
  };
  // Inject mock into the test process so the helper picks it up
  // (it reads `globalThis.chrome` at module-eval time).
  beforeEach(() => {
    storage = {};
    listeners.length = 0;
    (globalThis as any).chrome = mockChrome;
    // The diag module has a module-scope `cached` boolean; reset the
    // module cache so each test starts cold. Otherwise the second
    // test would see the first test's cached value.
    vi.resetModules();
  });
  afterEach(() => {
    delete (globalThis as any).chrome;
    vi.restoreAllMocks();
  });

  it('defaults to disabled when no flag is set', async () => {
    const { isDiagEnabled } = await import('@/lib/ai-config/web-provider-diag');
    expect(await isDiagEnabled()).toBe(false);
  });

  it('returns true when the flag is set to true', async () => {
    storage.web_provider_debug = true;
    const { isDiagEnabled } = await import('@/lib/ai-config/web-provider-diag');
    expect(await isDiagEnabled()).toBe(true);
  });

  it('diag() emits a tagged console.log when enabled', async () => {
    storage.web_provider_debug = true;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { diag, isDiagEnabled } = await import(
      '@/lib/ai-config/web-provider-diag'
    );
    // Pre-warm the cache so the cold-start guard doesn't swallow the
    // first call. In production this happens automatically during
    // module init via a fire-and-forget isDiagEnabled() call.
    expect(await isDiagEnabled()).toBe(true);
    diag('WS-DIAG', 'hello', { a: 1 });
    expect(spy).toHaveBeenCalledWith('[WS-DIAG] hello', { a: 1 });
  });

  it('diag() is a no-op when disabled (production)', async () => {
    storage.web_provider_debug = false;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { diag, isDiagEnabled } = await import(
      '@/lib/ai-config/web-provider-diag'
    );
    expect(await isDiagEnabled()).toBe(false);
    diag('WS-DIAG', 'should be silent');
    expect(spy).not.toHaveBeenCalled();
  });

  it('picks up live changes to the flag via onChanged', async () => {
    storage.web_provider_debug = false;
    const { isDiagEnabled, subscribeDiagEnabled } = await import(
      '@/lib/ai-config/web-provider-diag'
    );
    // First call: false
    expect(await isDiagEnabled()).toBe(false);
    // Subscribe to live updates
    let latest = await isDiagEnabled();
    const unsub = subscribeDiagEnabled((v) => {
      latest = v;
    });
    // Simulate the user toggling the flag in another context
    storage.web_provider_debug = true;
    for (const cb of listeners) {
      cb(
        { web_provider_debug: { oldValue: false, newValue: true } },
        'local',
      );
    }
    expect(latest).toBe(true);
    expect(await isDiagEnabled()).toBe(true);
    unsub();
  });
});
