import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import { getDb } from '@/lib/db';
import type { WebProvider } from '@/lib/types';

describe('WebProviderRepository', () => {
  beforeEach(async () => {
    // Reset webProviders table to clean state for each test
    await getDb().webProviders.clear();
  });

  describe('list()', () => {
    it('seeds 3 presets on empty DB', async () => {
      const providers = await getWebProviderRepository().list();
      expect(providers).toHaveLength(3);
      expect(providers.map((p) => p.presetId).sort()).toEqual([
        'deepseek',
        'glm',
        'kimi',
      ]);
    });

    it('all seeded providers have encryptedCookieBundle === null', async () => {
      const providers = await getWebProviderRepository().list();
      expect(providers.every((p) => p.encryptedCookieBundle === null)).toBe(
        true,
      );
    });

    it('does not re-seed if presets already exist', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      // Manually update one provider
      await repo.setEnabled('glm', false);
      const second = await repo.list();
      const glm = second.find((p) => p.presetId === 'glm');
      expect(glm?.enabled).toBe(false); // update preserved, not overwritten
    });
  });

  describe('get()', () => {
    it('returns the provider for a known presetId', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      const glm = await repo.get('glm');
      expect(glm?.presetId).toBe('glm');
    });

    it('returns undefined for unknown presetId', async () => {
      const repo = getWebProviderRepository();
      // Cast: testing runtime behavior for a value TypeScript would normally
      // reject at the call site. The repository should handle it gracefully
      // without crashing.
      const result = await repo.get('nonexistent' as WebProvider['presetId']);
      expect(result).toBeUndefined();
    });
  });

  describe('setEnabled', () => {
    it('persists enabled state and updates updatedAt', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      const before = await repo.get('glm');
      // Sleep 5ms so updatedAt changes observably
      await new Promise((r) => setTimeout(r, 5));
      await repo.setEnabled('glm', false);
      const after = await repo.get('glm');
      expect(after?.enabled).toBe(false);
      expect(after?.updatedAt).not.toBe(before?.updatedAt);
    });
  });

  describe('setLoginStatus', () => {
    it('persists loggedIn and updates lastCheckedAt', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setLoginStatus('kimi', 'loggedIn');
      const result = await repo.get('kimi');
      expect(result?.loginStatus).toBe('loggedIn');
      expect(result?.lastCheckedAt).not.toBeNull();
    });

    it('persists loggedOut', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setLoginStatus('deepseek', 'loggedOut');
      const result = await repo.get('deepseek');
      expect(result?.loginStatus).toBe('loggedOut');
    });
  });

  describe('setModelId', () => {
    it('updates modelId and updatedAt', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setModelId('glm', 'GLM-4.6-custom');
      const result = await repo.get('glm');
      expect(result?.modelId).toBe('GLM-4.6-custom');
    });
  });

  describe('setCapability', () => {
    it('updates supportsToolCalls', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setCapability('kimi', 'supportsToolCalls', false);
      const result = await repo.get('kimi');
      expect(result?.supportsToolCalls).toBe(false);
    });

    it('updates supportsReasoning', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setCapability('deepseek', 'supportsReasoning', false);
      const result = await repo.get('deepseek');
      expect(result?.supportsReasoning).toBe(false);
    });
  });

  // ===== ② additions: encrypted bundle + A2 overrides + A4 audit =====
  describe('setEncryptedCookieBundle / clearEncryptedCookieBundle', () => {
    it('setEncryptedCookieBundle persists the ciphertext', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setEncryptedCookieBundle('glm', 'base64ciphertext123');
      const result = await repo.get('glm');
      expect(result?.encryptedCookieBundle).toBe('base64ciphertext123');
    });

    it('clearEncryptedCookieBundle sets back to null', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setEncryptedCookieBundle('glm', 'base64ciphertext123');
      await repo.clearEncryptedCookieBundle('glm');
      const result = await repo.get('glm');
      expect(result?.encryptedCookieBundle).toBeNull();
    });
  });

  describe('setUserOverrides (A2)', () => {
    it('persists user overrides', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setUserOverrides('kimi', {
        sessionIndicators: ['kimi-auth-v2'],
        useLocalStorageFallback: false,
      });
      const result = await repo.get('kimi');
      expect(result?.userOverrides).toEqual({
        sessionIndicators: ['kimi-auth-v2'],
        useLocalStorageFallback: false,
      });
    });

    it('null clears overrides', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setUserOverrides('kimi', { sessionIndicators: ['x'] });
      await repo.setUserOverrides('kimi', null);
      const result = await repo.get('kimi');
      expect(result?.userOverrides).toBeNull();
    });
  });

  describe('appendAuditEntry (A4)', () => {
    it('appends entry to empty log', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.appendAuditEntry('glm', {
        timestamp: '2026-06-03T00:00:00.000Z',
        result: 'success',
        source: 'cookie',
        cookiesCaptured: 2,
      });
      const result = await repo.get('glm');
      expect(result?.loginAuditLog).toHaveLength(1);
      expect(result?.loginAuditLog[0].result).toBe('success');
    });

    it('keeps most recent first (newest entry at index 0)', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.appendAuditEntry('glm', { timestamp: '2026-06-03T00:00:00.000Z', result: 'success' });
      await repo.appendAuditEntry('glm', { timestamp: '2026-06-03T00:01:00.000Z', result: 'timeout' });
      const result = await repo.get('glm');
      expect(result?.loginAuditLog).toHaveLength(2);
      expect(result?.loginAuditLog[0].result).toBe('timeout');  // newer first
      expect(result?.loginAuditLog[1].result).toBe('success');
    });

    it('evicts oldest when count exceeds 5 (FIFO)', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      for (let i = 0; i < 7; i++) {
        await repo.appendAuditEntry('glm', {
          timestamp: `2026-06-03T00:0${i}:00.000Z`,
          result: 'success',
        });
      }
      const result = await repo.get('glm');
      expect(result?.loginAuditLog).toHaveLength(5);
      // Newest first; oldest 2 evicted
      expect(result?.loginAuditLog[0].timestamp).toBe('2026-06-03T00:06:00.000Z');
      expect(result?.loginAuditLog[4].timestamp).toBe('2026-06-03T00:02:00.000Z');
    });
  });
});
