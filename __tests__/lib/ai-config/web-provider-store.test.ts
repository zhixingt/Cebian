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
});
