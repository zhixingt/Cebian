import type { Worker } from '@playwright/test';

/**
 * Read a value from `chrome.storage.local` by key.
 *
 * The extension uses WXT's `storage.defineItem` which prefixes keys with
 * the storage area id, e.g. `local:activeModel`. We try the bare key first
 * (some entries are stored at the top level) then fall back to `local:<key>`.
 */
export async function getStorageItem<T = unknown>(
  sw: Worker,
  key: string,
): Promise<T | undefined> {
  return sw.evaluate(async (k: string) => {
    // @ts-expect-error - chrome global is available in the SW context
    const all = await chrome.storage.local.get(null);
    return all[k] ?? all[`local:${k}`];
  }, key) as Promise<T | undefined>;
}

/**
 * Set a value in `chrome.storage.local`. Tests use this to seed state
 * (e.g. simulate a previous DeepSeek login that needs cleanup).
 */
export async function setStorageItem(
  sw: Worker,
  key: string,
  value: unknown,
): Promise<void> {
  await sw.evaluate(
    async ({ k, v }: { k: string; v: unknown }) => {
      // @ts-expect-error - chrome global is available in the SW context
      await chrome.storage.local.set({ [k]: v });
    },
    { k: key, v: value },
  );
}

/**
 * Remove a value from `chrome.storage.local`.
 */
export async function removeStorageItem(sw: Worker, key: string): Promise<void> {
  await sw.evaluate(async (k: string) => {
    // @ts-expect-error - chrome global is available in the SW context
    await chrome.storage.local.remove(k);
  }, key);
}

/**
 * List all keys in `chrome.storage.local`. Useful for cleanup assertions.
 */
export async function listStorageKeys(sw: Worker): Promise<string[]> {
  return sw.evaluate(async () => {
    // @ts-expect-error - chrome global is available in the SW context
    const all = await chrome.storage.local.get(null);
    return Object.keys(all);
  }) as Promise<string[]>;
}
