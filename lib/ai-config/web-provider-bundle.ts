/**
 * ③+④ T4 — Decrypted cookie bundle cache layer.
 *
 * Sits between the network relay (T6) and the encrypted Dexie storage.
 * Why a separate module:
 *   - Bundle decrypt is expensive (AES-GCM + base64)
 *   - Network relay may call resolveBundle() many times per second
 *     (once per stream chunk for cookie rotation, though we don't
 *     do that yet — but 5min cache is cheap insurance)
 *   - 7d stale detection: a soft warning is more pragmatic than a hard
 *     reject; the bundle might still work
 *
 * Cache contract:
 *   - In-memory Map<presetId, {bundle, cachedAt, lastCheckedAt}>
 *   - 5-minute TTL → re-decrypt on expiry
 *   - 7d staleness → console.warn (non-blocking)
 *   - invalidate on login / logout / refresh (callers do this)
 *
 * Test-only export: _resetBundleCacheForTesting (vitest beforeEach).
 */

import type { WebProvider } from '../types';
import { getWebProviderRepository } from './web-provider-store';
import { decryptCookieBundle } from './web-provider-crypto';

const CACHE_TTL_MS = 5 * 60 * 1000;          // 5 minutes
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

interface CachedBundle {
  /** Decrypted cookie map (mutable; cache returns same reference on hit) */
  bundle: Record<string, string>;
  /** Date.now() when this entry was written */
  cachedAt: number;
  /** Provider.lastCheckedAt at write time (for staleness check) */
  lastCheckedAt: string;
}

const _cache = new Map<WebProvider['presetId'], CachedBundle>();

/**
 * Resolve the decrypted cookie bundle for a provider.
 *
 * @param providerId preset id (glm | kimi | deepseek)
 * @returns decrypted cookie map, or null if not logged in / no bundle / decrypt failed
 */
export async function resolveBundle(
  providerId: WebProvider['presetId'],
): Promise<Record<string, string> | null> {
  // 1. Cache hit?
  const cached = _cache.get(providerId);
  const now = Date.now();
  if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
    // 7d stale soft warning (non-blocking)
    if (cached.lastCheckedAt) {
      const ageMs = now - new Date(cached.lastCheckedAt).getTime();
      if (ageMs > STALE_THRESHOLD_MS) {
        const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        console.warn(
          `[web-provider-bundle] ${providerId} bundle is ${days}d old ` +
          `(lastCheckedAt=${cached.lastCheckedAt}); consider re-login to refresh`,
        );
      }
    }
    return cached.bundle;
  }

  // 2. Cache miss / expired → fetch from DB
  const repo = getWebProviderRepository();
  const provider = await repo.get(providerId);
  if (!provider || !provider.encryptedCookieBundle) {
    _cache.delete(providerId);
    return null;
  }
  if (provider.loginStatus !== 'loggedIn') {
    _cache.delete(providerId);
    return null;
  }

  // 3. Decrypt
  let plaintext: string;
  try {
    plaintext = await decryptCookieBundle(provider.encryptedCookieBundle);
  } catch (err) {
    console.warn(
      `[web-provider-bundle] failed to decrypt ${providerId} bundle:`,
      err instanceof Error ? err.message : err,
    );
    _cache.delete(providerId);
    return null;
  }

  // 4. Parse JSON
  let bundle: Record<string, string>;
  try {
    const parsed = JSON.parse(plaintext);
    // Defensive: ensure shape
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Bundle is not a plain object');
    }
    bundle = parsed as Record<string, string>;
  } catch (err) {
    console.warn(
      `[web-provider-bundle] failed to parse ${providerId} bundle JSON:`,
      err instanceof Error ? err.message : err,
    );
    _cache.delete(providerId);
    return null;
  }

  // 5. Cache and return
  _cache.set(providerId, {
    bundle,
    cachedAt: now,
    lastCheckedAt: provider.lastCheckedAt ?? new Date(0).toISOString(),
  });
  return bundle;
}

/**
 * Clear the cache entry for a single provider.
 * Call after login success, logout, or refresh so the next resolveBundle
 * re-reads from DB.
 */
export function invalidateBundle(providerId: WebProvider['presetId']): void {
  _cache.delete(providerId);
}

/**
 * Clear all cached bundles. Useful on SW startup or when Dexie is reset.
 */
export function invalidateAllBundles(): void {
  _cache.clear();
}

/**
 * Test-only: reset the in-memory cache. Use in vitest beforeEach.
 * NOT for production code — callers should use invalidateBundle/invalidateAllBundles.
 */
export function _resetBundleCacheForTesting(): void {
  _cache.clear();
}

/**
 * Test-only: simulate a stale cache entry by rewinding cachedAt to N ms ago.
 * Optionally also override lastCheckedAt to test the 7d stale warning.
 * Avoids vi.useFakeTimers() (which can leak across tests in some vitest versions).
 */
export function _setBundleCacheAgeForTesting(
  providerId: WebProvider['presetId'],
  ageMs: number,
  lastCheckedAtOverride?: string,
): void {
  const entry = _cache.get(providerId);
  if (!entry) return;  // no-op if cache empty
  entry.cachedAt = Date.now() - ageMs;
  if (lastCheckedAtOverride !== undefined) {
    entry.lastCheckedAt = lastCheckedAtOverride;
  }
}
