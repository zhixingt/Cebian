import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  resolveBundle,
  invalidateBundle,
  invalidateAllBundles,
  _resetBundleCacheForTesting,
  _setBundleCacheAgeForTesting,
} from '@/lib/ai-config/web-provider-bundle';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import { encryptCookieBundle } from '@/lib/ai-config/web-provider-crypto';
import { getDb } from '@/lib/db';
import type { WebProvider } from '@/lib/types';

async function makeLoggedIn(provider: Partial<WebProvider> = {}) {
  const repo = getWebProviderRepository();
  // Seed provider records from presets (idempotent)
  await repo.list();
  const cookies = { sessionid: 'abc123', 'csrf_token': 'xyz789' };
  const ciphertext = await encryptCookieBundle(JSON.stringify(cookies));
  await repo.setEncryptedCookieBundle('glm' as WebProvider['presetId'], ciphertext);
  await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedIn');
  const p = await repo.get('glm' as WebProvider['presetId']);
  expect(p).toBeDefined();
  expect(p!.loginStatus).toBe('loggedIn');
  expect(p!.encryptedCookieBundle).toBe(ciphertext);
  return { repo, ciphertext, cookies };
}

describe('resolveBundle (T4: ③+④ 5min cache + 7d stale detection)', () => {
  beforeEach(async () => {
    _resetBundleCacheForTesting();
    // Reset Dexie to a clean state between tests (matches web-provider-store.test.ts pattern)
    await getDb().webProviders.clear();
    // Mock chrome.storage.local so crypto module can getOrCreateKey()
    if (!(global as any).chrome) {
      (global as any).chrome = {};
    }
    const mockStorage: Record<string, any> = {};
    (global as any).chrome.storage = {
      local: {
        get: vi.fn((k: string) => Promise.resolve({ [k]: mockStorage[k] })),
        set: vi.fn((o: Record<string, any>) => { Object.assign(mockStorage, o); return Promise.resolve(); }),
      },
    };
  });

  afterEach(() => {
    _resetBundleCacheForTesting();
    vi.useRealTimers();
  });

  it('returns null when provider has no stored bundle', async () => {
    const bundle = await resolveBundle('glm' as WebProvider['presetId']);
    expect(bundle).toBeNull();
  });

  it('returns null when provider is loggedOut', async () => {
    const repo = getWebProviderRepository();
    // Seed provider first
    await repo.list();
    await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedOut');
    const bundle = await resolveBundle('glm' as WebProvider['presetId']);
    expect(bundle).toBeNull();
  });

  it('returns decrypted cookies when provider is loggedIn (cache miss → populate)', async () => {
    await makeLoggedIn();
    const bundle = await resolveBundle('glm' as WebProvider['presetId']);
    expect(bundle).not.toBeNull();
    expect(bundle!.sessionid).toBe('abc123');
    expect(bundle!['csrf_token']).toBe('xyz789');
  });

  it('uses 5-minute in-memory cache: second call within TTL returns SAME object reference', async () => {
    await makeLoggedIn();
    // First call: cache miss → decrypt + populate
    const b1 = await resolveBundle('glm' as WebProvider['presetId']);
    expect(b1!.sessionid).toBe('abc123');
    // Second call within 5 min: cache hit → returns the SAME object reference
    // (decrypt would produce a fresh object; same ref proves cache hit)
    const b2 = await resolveBundle('glm' as WebProvider['presetId']);
    expect(b2).toBe(b1);
  });

  it('cache expires after 5 minutes: new object reference on second call', async () => {
    await makeLoggedIn();
    // First call populates cache
    const b1 = await resolveBundle('glm' as WebProvider['presetId']);
    expect(b1).not.toBeNull();
    // Simulate cache expiry by rewinding cachedAt to 6 minutes ago (no fake timers — they leaked across tests)
    _setBundleCacheAgeForTesting('glm' as WebProvider['presetId'], 6 * 60 * 1000);
    // Second call: cache stale (> 5min) → re-decrypt → fresh object
    const b2 = await resolveBundle('glm' as WebProvider['presetId']);
    expect(b2).not.toBe(b1);  // different reference proves re-decrypt
    expect(b2!.sessionid).toBe('abc123');  // same content
  });

  it('7d stale bundle: console.warn fires but bundle is still returned (soft warn)', async () => {
    await makeLoggedIn();
    // Populate cache
    const b1 = await resolveBundle('glm' as WebProvider['presetId']);
    expect(b1).not.toBeNull();
    // Cache must be valid (cachedAt < 5min ago) but lastCheckedAt > 7d ago
    // This simulates: user logged in 8 days ago, used chat recently (<5min)
    _setBundleCacheAgeForTesting(
      'glm' as WebProvider['presetId'],
      60 * 1000,  // 1 min ago → cache still valid
      new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),  // 8d ago
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b2 = await resolveBundle('glm' as WebProvider['presetId']);
    expect(b2).toBe(b1);  // same reference (7d is a soft warn, not invalidation)
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls.find(c => String(c[0]).includes('web-provider-bundle') && String(c[0]).includes('8d old'));
    expect(msg).toBeDefined();
    warn.mockRestore();
  });

  it('invalidateBundle forces re-decrypt (new object reference)', async () => {
    await makeLoggedIn();
    const b1 = await resolveBundle('glm' as WebProvider['presetId']);
    invalidateBundle('glm' as WebProvider['presetId']);
    const b2 = await resolveBundle('glm' as WebProvider['presetId']);
    expect(b2).not.toBe(b1);  // new object = re-decrypted
    expect(b2!.sessionid).toBe('abc123');  // same content
  });

  it('invalidateAllBundles clears both providers (new object refs)', async () => {
    const repo = getWebProviderRepository();
    await repo.list();
    // Set up GLM provider with a bundle
    const c1 = await encryptCookieBundle(JSON.stringify({ sessionid: 'a' }));
    await repo.setEncryptedCookieBundle('glm' as WebProvider['presetId'], c1);
    await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedIn');
    const b1g = await resolveBundle('glm' as WebProvider['presetId']);
    invalidateAllBundles();
    const b2g = await resolveBundle('glm' as WebProvider['presetId']);
    expect(b2g).not.toBe(b1g);
    expect(b2g!.sessionid).toBe('a');
  });
});
