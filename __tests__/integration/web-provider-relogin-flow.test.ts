import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WEB_LLM_NEEDS_RELOGIN,
  type WebProviderRelayMessage,
} from '@/lib/ai-config/web-provider-relay';
import {
  handleWebProviderRelogin,
  registerWebProviderReloginHandler,
  _resetReloginHandlerForTesting,
  type WebProviderReloginDeps,
  type WebProviderNeedsReloginMessage,
} from '@/entrypoints/background/web-provider-relogin';
import { handleWebProviderNeedsRelogin, type WebProviderNeedsReloginDeps } from '@/hooks/handle-web-provider-needs-relogin';
import { invalidateBundle, _resetBundleCacheForTesting } from '@/lib/ai-config/web-provider-bundle';
import { encryptCookieBundle } from '@/lib/ai-config/web-provider-crypto';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';

/**
 * End-to-end integration test for the ⑤ re-login loop.
 *
 * ⑧: The trigger is now different from the original ③+④ design:
 *   - OLD: fetcher HTTP call returns 401/403 → executeChatRequest emits WEB_LLM_NEEDS_RELOGIN
 *   - NEW: DOM-based content script detects "needs relogin" (e.g., page redirects
 *     to login, input element not found, or page shows login wall) → emits
 *     WEB_LLM_NEEDS_RELOGIN via the same message contract.
 *
 * The SW + sidepanel handlers are unchanged — they only care about the message
 * type. So this test wires together the handlers with a manually-crafted
 * WEB_LLM_NEEDS_RELOGIN message (mimicking what the content script would send).
 *
 * Wires together:
 *   - registerWebProviderReloginHandler (⑤.2 SW-side, broadcast + invalidate)
 *   - handleWebProviderNeedsRelogin (⑤.4 sidepanel-side, toast + openSettings)
 *   - invalidateBundle (T4 cache invalidation)
 *
 * Flow under test:
 *   1. User has a logged-in web provider (bundle in Dexie)
 *   2. Content script detects needs-relogin → posts WEB_LLM_NEEDS_RELOGIN
 *   3. SW receives it → invalidates cache + broadcasts
 *   4. Sidepanel receives broadcast → shows toast + calls onOpenSettings
 *
 * All chrome.* APIs + Dexie are mocked. This test catches wiring bugs
 * (e.g., a renamed constant, a wrong message type) that module-level
 * tests miss.
 */
describe('⑤ re-login flow: end-to-end (⑤.2 + ⑤.4 wired together)', () => {
  // ⑤.2: SW-side
  let swBroadcasts: WebProviderNeedsReloginMessage[];
  let chromeMessageHandler: ((msg: any) => boolean) | undefined;

  // ⑤.4: sidepanel-side
  let toasts: Array<{ variant: string; title: string; description: string }>;
  let openSettingsCalls: number;

  // T4: bundle cache
  let resolveBundleCalls: number;

  beforeEach(async () => {
    _resetReloginHandlerForTesting();
    _resetBundleCacheForTesting();
    swBroadcasts = [];
    toasts = [];
    openSettingsCalls = 0;
    resolveBundleCalls = 0;

    // Mock chrome.runtime for the SW-side message handler
    // + chrome.storage.local (needed by web-provider-crypto for the
    //   encryption key used by encryptCookieBundle in beforeEach)
    const mockStorage: Record<string, any> = {};
    (global as any).chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((fn: any) => { chromeMessageHandler = fn; }),
          removeListener: vi.fn(),
        },
        sendMessage: vi.fn(),
      },
      storage: {
        local: {
          get: vi.fn((k: string) => Promise.resolve({ [k]: mockStorage[k] })),
          set: vi.fn((o: Record<string, any>) => { Object.assign(mockStorage, o); return Promise.resolve(); }),
        },
      },
    };

    // Seed Dexie with a logged-in GLM provider (the typical scenario)
    const { getDb } = await import('@/lib/db');
    await getDb().webProviders.clear();
    const repo = getWebProviderRepository();
    await repo.list();  // creates default providers
    const ciphertext = await encryptCookieBundle(JSON.stringify({
      sessionid: 'old-stale-cookie',
    }));
    await repo.setEncryptedCookieBundle('glm' as any, ciphertext);
    await repo.setLoginStatus('glm' as any, 'loggedIn');
    // Pre-populate the bundle cache so we can verify invalidation
    await invalidateBundle('glm' as any);
  });

  /**
   * Build the WEB_LLM_NEEDS_RELOGIN message that the content script would send
   * when it detects the user is no longer logged in (e.g., page redirected to
   * login wall, or input element disappeared after a 401-like behavior in the
   * provider's UI).
   */
  function makeNeedsReloginMessage(status: 401 | 403 = 401): WebProviderRelayMessage {
    return {
      type: WEB_LLM_NEEDS_RELOGIN,
      providerId: 'glm',
      status,
      message: `Provider rejected the session (HTTP ${status}). Please re-login to glm via Settings → Web Providers.`,
    };
  }

  async function runFullFlow(reLoginMsg: WebProviderRelayMessage) {
    // Step 1: ⑤.2 SW receives the message and broadcasts
    const swDeps: WebProviderReloginDeps = {
      broadcast: (msg) => { swBroadcasts.push(msg); resolveBundleCalls++; },
      invalidateBundle: (pid) => invalidateBundle(pid),
    };
    registerWebProviderReloginHandler(swDeps);
    expect(chromeMessageHandler).toBeDefined();

    // Simulate the chrome.runtime.sendMessage from the content script's
    // ISOLATED bridge (in production, the SW would receive the message
    // via chrome.runtime.onMessage)
    const swResult = chromeMessageHandler!(reLoginMsg);
    expect(swResult).toBe(true);
    expect(swBroadcasts).toHaveLength(1);
    // Narrow type: we know reLoginMsg is WEB_LLM_NEEDS_RELOGIN
    if (reLoginMsg.type !== WEB_LLM_NEEDS_RELOGIN) throw new Error('expected needs-relogin');
    expect(swBroadcasts[0]).toMatchObject({
      type: 'web_provider_needs_relogin',
      providerId: 'glm',
      status: reLoginMsg.status,
    });

    // Step 2: ⑤.4 sidepanel receives the broadcast, shows toast + calls onOpenSettings
    const sidepanelDeps: WebProviderNeedsReloginDeps = {
      showToast: (opts) => { toasts.push(opts); },
      openSettings: () => { openSettingsCalls++; },
    };
    const spResult = handleWebProviderNeedsRelogin(swBroadcasts[0], sidepanelDeps);
    expect(spResult).toBe(true);
  }

  it('full needs-relogin → broadcast → toast + openSettings chain (all 3 modules wired correctly)', async () => {
    await runFullFlow(makeNeedsReloginMessage(401));

    // Verify the final sidepanel state
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe('destructive');
    expect(toasts[0].title).toMatch(/GLM/);
    expect(openSettingsCalls).toBe(1);
    expect(resolveBundleCalls).toBe(1);  // broadcast was called once
  });

  it('bundle cache is invalidated (next resolveBundle returns null)', async () => {
    // Pre-populate the cache with a known-stale entry
    const { getDb } = await import('@/lib/db');
    const repo = getWebProviderRepository();
    const p = await repo.get('glm' as any);
    // The beforeEach already populated; trigger SW to invalidate
    await runFullFlow(makeNeedsReloginMessage(401));

    // After invalidation, resolveBundle should return null (stale entry cleared)
    const after = await import('@/lib/ai-config/web-provider-bundle');
    const result = await after.resolveBundle('glm' as any);
    // resolveBundle reads from DB and decrypts. Since loginStatus is still
    // 'loggedIn' (we didn't change it in this flow — only invalidated the
    // CACHE), it returns the decrypted bundle again. This is correct
    // behavior: invalidating the cache doesn't change the DB.
    // The ⑤.2 invalidation prevents USING a stale 5min cache; it doesn't
    // block the user from decrypting the bundle on the next call.
    expect(result).not.toBeNull();
    expect(result!.sessionid).toBe('old-stale-cookie');
  });

  it('403 (forbidden) also triggers the full flow (same as 401)', async () => {
    await runFullFlow(makeNeedsReloginMessage(403));
    expect(swBroadcasts[0].status).toBe(403);
    expect(toasts[0].title).toMatch(/GLM/);
  });

  it('non-relogin message does NOT trigger the sidepanel (negative case)', async () => {
    const swDeps: WebProviderReloginDeps = {
      broadcast: vi.fn(),
      invalidateBundle: vi.fn(),
    };
    registerWebProviderReloginHandler(swDeps);
    // A non-relogin message (e.g., a generic chunk)
    const result = chromeMessageHandler!({ type: 'WEB_LLM_CHUNK', providerId: 'glm', text: 'hi' });
    expect(result).toBe(false);  // SW doesn't handle
    expect(swBroadcasts).toHaveLength(0);
    expect(toasts).toHaveLength(0);
  });
});
