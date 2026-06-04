// Vitest stub for WXT's #imports alias.
// Provides the storage/local/session APIs that lib/storage.ts (and other
// modules) import via WXT's runtime injection. Tests that need real
// storage behavior should use the in-memory storage from setup.ts.
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
};
