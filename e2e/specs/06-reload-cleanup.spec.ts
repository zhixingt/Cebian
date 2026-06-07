import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext, wipeUserDataDir } from '../helpers/extension';
import { setStorageItem, getStorageItem, listStorageKeys } from '../helpers/storage';

/**
 * E2E Item 6: after a stale-state reload, no residue crashes the UI.
 *
 * This is the regression test for the 3 layers of defense added in
 * commit 64ed2ea:
 *   A) `WebProviderRepository.list()` bulkDelete on Dexie stale rows
 *   B) `isValidActiveModel` startup-pass on chrome.storage
 *   C) `agent-manager.resolveModelObj` self-heal on null
 *
 * The test:
 *   1. Launches Chrome with a clean user data dir
 *   2. Pre-seeds `chrome.storage.local` with a stale `activeModel`
 *      pointing at a removed `web:deepseek:...` id
 *   3. Closes the context
 *   4. Relaunches Chrome (simulating "extension reload" + SW restart)
 *   5. Asserts the startup-pass cleared the stale value
 */
test.describe('E2E Item 6: reload cleanup', () => {
  test('stale activeModel is cleared on startup-pass', async () => {
    test.setTimeout(60_000);

    // Clean slate
    wipeUserDataDir();

    // Pass 1: launch + seed stale state
    const pass1 = await launchWithExtension();
    await setStorageItem(pass1.serviceWorker, 'local:activeModel', {
      provider: 'web',
      modelId: 'web:deepseek:deepseek-chat',
    });
    // Verify the seed took
    const seeded = await getStorageItem(pass1.serviceWorker, 'local:activeModel');
    expect(seeded, 'stale seed should be present before restart').toBeTruthy();
    expect((seeded as any).provider).toBe('web');
    await pass1.context.close();

    // Pass 2: relaunch (simulating extension reload)
    const pass2 = await launchWithExtension();
    try {
      // The startup-pass should have cleared the stale value
      const cleared = await getStorageItem(pass2.serviceWorker, 'local:activeModel');
      expect(
        cleared === null || cleared === undefined,
        `stale activeModel should be cleared on startup-pass, got: ${JSON.stringify(cleared)}`,
      ).toBe(true);

      // Also check that no other web:* keys linger
      const allKeys = await listStorageKeys(pass2.serviceWorker);
      const webKeys = allKeys.filter(
        (k) => k.includes('deepseek') || k.includes('kimi'),
      );
      expect(webKeys, `no deepseek/kimi keys should remain, found: ${webKeys.join(', ')}`).toEqual([]);
    } finally {
      await pass2.context.close();
      wipeUserDataDir();
    }
  });
});
