import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { shouldClearActiveModel } from '@/lib/ai-config/web-provider-active-model';

describe('shouldClearActiveModel', () => {
  it('returns true when activeModel points at a web:<loggedOutId>:* model', () => {
    expect(shouldClearActiveModel(
      { provider: 'web', modelId: 'web:glm:glm-4.6' },
      'glm',
    )).toBe(true);
  });

  it('returns false when activeModel points at a different web provider', () => {
    expect(shouldClearActiveModel(
      { provider: 'web', modelId: 'web:kimi:moonshot-v1' },
      'glm',
    )).toBe(false);
  });

  it('returns false when activeModel is a non-web provider', () => {
    expect(shouldClearActiveModel(
      { provider: 'anthropic', modelId: 'claude-3-7-sonnet' },
      'glm',
    )).toBe(false);
    expect(shouldClearActiveModel(
      { provider: 'openai', modelId: 'gpt-4o' },
      'glm',
    )).toBe(false);
  });

  it('returns false when activeModel is null', () => {
    expect(shouldClearActiveModel(null, 'glm')).toBe(false);
  });

  it('returns false when activeModel.modelId has wrong prefix', () => {
    // Edge: modelId doesn't start with `web:<id>:` (e.g. user manually edited storage)
    expect(shouldClearActiveModel(
      { provider: 'web', modelId: 'glm-4.6' },
      'glm',
    )).toBe(false);
  });

  it('returns false when prefix matches only a superstring (e.g. glm-2 vs glm)', () => {
    // Edge: 'glm-2' should NOT match 'glm' — the colon separator prevents this
    expect(shouldClearActiveModel(
      { provider: 'web', modelId: 'web:glm-2:model' },
      'glm',
    )).toBe(false);
  });
});
