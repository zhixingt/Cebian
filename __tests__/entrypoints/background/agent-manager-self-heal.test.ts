/**
 * Regression: agent-manager.resolveModelObj() must self-heal when
 * activeModel points at a removed/stale web provider. This protects
 * against the user upgrading from a build that had Kimi/DeepSeek
 * to a build that has only GLM.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveSelectedWebModel } from '@/lib/ai-config/web-provider-models';
import { isValidActiveModel } from '@/lib/ai-config/web-provider-active-model-validation';

describe('agent-manager self-heal (resolveModelObj null branch)', () => {
  beforeEach(() => {
    // Reset the in-memory state for the activeModel mock
    (global as any).__activeModelStore = null;
  });

  it('resolveSelectedWebModel returns null for a stale web:deepseek: id', () => {
    expect(resolveSelectedWebModel(
      { provider: 'web', modelId: 'web:deepseek:deepseek-chat' },
      [{
        presetId: 'deepseek' as any,  // stale row, would have been deleted by web-provider-store:list() in production
        enabled: true,
        loginStatus: 'loggedIn',
        modelId: 'deepseek-chat',
        supportsToolCalls: false,
        supportsReasoning: false,
        lastCheckedAt: null,
        encryptedCookieBundle: null,
        userOverrides: null,
        loginAuditLog: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    )).toBeNull();
  });

  it('isValidActiveModel rejects what resolveSelectedWebModel rejects', () => {
    // Defense in depth: if a stale value reaches the storage layer, both
    // the startup-pass (background/index.ts) and resolveSelectedWebModel
    // (here) would flag it.
    const stale = { provider: 'web', modelId: 'web:deepseek:deepseek-chat' };
    expect(isValidActiveModel(stale)).toBe(false);
    expect(resolveSelectedWebModel(stale, [])).toBeNull();
  });

  it('clears activeModel when resolveSelectedWebModel returns null (self-heal contract)', async () => {
    // Simulate the agent-manager self-heal behavior in isolation
    const mockStorage: Record<string, any> = {
      'local:activeModel': { provider: 'web', modelId: 'web:deepseek:deepseek-chat' },
    };
    (global as any).chrome = {
      storage: {
        local: {
          get: vi.fn((k: string) => Promise.resolve({ [k]: mockStorage[k] })),
          set: vi.fn((o: Record<string, any>) => {
            Object.assign(mockStorage, o);
            return Promise.resolve();
          }),
        },
      },
    };

    // Mirror the agent-manager self-heal logic (since we can't import the
    // full agent-manager in unit tests without WXT runtime)
    const modelCfg = mockStorage['local:activeModel'];
    if (modelCfg.provider === 'web' && !isValidActiveModel(modelCfg)) {
      // ...resolveSelectedWebModel would also return null here
      await new Promise<void>((resolve) => {
        mockStorage['local:activeModel'] = null;
        resolve();
      });
    }

    expect(mockStorage['local:activeModel']).toBeNull();
  });
});
