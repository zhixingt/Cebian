// Vitest stub for WXT's #imports alias.
// Provides the storage/local/session APIs that lib/storage.ts (and other
// modules) import via WXT's runtime injection. Tests that need real
// storage behavior should use the in-memory storage from setup.ts.

// In-memory backing store for `storage.defineItem(...)` declarations.
// Keyed by the same 'area:key' string that lib/storage.ts passes in (e.g.
// 'local:favoritePrompts'). Tests that exercise the real storage items can
// read/write through this map transparently.
const defineItemStore = new Map<string, unknown>();

export const storage = {
  local: {
    get: async (_key: string) => ({}),
    set: async (_items: Record<string, unknown>) => {},
    remove: async (_key: string) => {},
  },
  sync: {
    get: async (_key: string) => ({}),
    set: async (_items: Record<string, unknown>) => {},
  },
  session: {
    get: async (_key: string) => ({}),
    set: async (_items: Record<string, unknown>) => {},
  },
  onChanged: {
    addListener: (_cb: unknown) => {},
    removeListener: (_cb: unknown) => {},
  },
  /**
   * Minimal `storage.defineItem` replacement sufficient for unit tests that
   * import real storage declarations from `lib/storage.ts`.
   *
   * - `getValue()` returns the stored value, or `opts.fallback` if unset.
   * - `setValue(v)` stores `v` in the module-scoped `defineItemStore`.
   * - `watch()` is a no-op returning an unsubscribe function. Tests that
   *   need to assert on watch behavior should mock `@/lib/storage` directly.
   *
   * NOTE: the store is shared across tests in the same file by design. Tests
   * that need isolation should clear the relevant key (e.g. via
   * `storage.local.remove`) in a `beforeEach`, or mock the storage module.
   */
  defineItem: <T>(key: string, opts: { fallback: T }) => {
    return {
      getValue: async (): Promise<T> => {
        if (defineItemStore.has(key)) {
          return defineItemStore.get(key) as T;
        }
        return opts.fallback;
      },
      setValue: async (value: T): Promise<void> => {
        defineItemStore.set(key, value);
      },
      watch: (_cb: (newValue: T, oldValue: T) => void): (() => void) => {
        return () => {};
      },
    };
  },
};
