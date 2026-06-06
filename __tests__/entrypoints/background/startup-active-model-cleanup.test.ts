import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// Mock chrome.storage.local so we don't depend on WXT runtime
let mockStorage: Record<string, any> = {};
beforeEach(() => {
  mockStorage = {};
  (global as any).chrome = {
    storage: {
      local: {
        get: vi.fn((keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, any> = {};
          for (const k of arr) result[k] = mockStorage[k];
          return Promise.resolve(result);
        }),
        set: vi.fn((items: Record<string, any>) => {
          Object.assign(mockStorage, items);
          return Promise.resolve();
        }),
        remove: vi.fn((k: string) => {
          delete mockStorage[k];
          return Promise.resolve();
        }),
      },
    },
  };
});

/**
 * Simulates the SW startup-pass in `entrypoints/background/index.ts`.
 * We re-implement the logic here because the real `index.ts` uses
 * `defineBackground` from WXT which isn't available in unit tests.
 */
async function runStartupCleanup(): Promise<void> {
  // Re-create the import after chrome.storage.local is mocked
  const { isValidActiveModel } = await import(
    '@/lib/ai-config/web-provider-active-model-validation'
  );
  const current = mockStorage['local:activeModel'] ?? null;
  if (current !== null && !isValidActiveModel(current)) {
    delete mockStorage['local:activeModel'];
  }
}

describe('SW startup cleanup of activeModel', () => {
  it('clears an empty-object value (corrupted state)', async () => {
    mockStorage['local:activeModel'] = {};
    await runStartupCleanup();
    expect(mockStorage['local:activeModel']).toBeUndefined();
  });

  it('clears a stale web:deepseek: value', async () => {
    mockStorage['local:activeModel'] = {
      provider: 'web',
      modelId: 'web:deepseek:deepseek-chat',
    };
    await runStartupCleanup();
    expect(mockStorage['local:activeModel']).toBeUndefined();
  });

  it('clears a stale web:kimi: value', async () => {
    mockStorage['local:activeModel'] = {
      provider: 'web',
      modelId: 'web:kimi:moonshot-v1',
    };
    await runStartupCleanup();
    expect(mockStorage['local:activeModel']).toBeUndefined();
  });

  it('preserves a valid GLM web: value', async () => {
    mockStorage['local:activeModel'] = {
      provider: 'web',
      modelId: 'web:glm:GLM-4.6',
    };
    await runStartupCleanup();
    expect(mockStorage['local:activeModel']).toEqual({
      provider: 'web',
      modelId: 'web:glm:GLM-4.6',
    });
  });

  it('preserves a null value (no-op)', async () => {
    await runStartupCleanup();
    expect(mockStorage['local:activeModel']).toBeUndefined();
  });

  it('preserves a non-web provider (e.g. anthropic)', async () => {
    mockStorage['local:activeModel'] = {
      provider: 'anthropic',
      modelId: 'claude-3-7-sonnet',
    };
    await runStartupCleanup();
    expect(mockStorage['local:activeModel']).toEqual({
      provider: 'anthropic',
      modelId: 'claude-3-7-sonnet',
    });
  });
});
