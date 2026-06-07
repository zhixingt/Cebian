import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  shouldClearActiveModel,
  shouldAutoSelectOnLogin,
} from '@/lib/ai-config/web-provider-active-model';

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

describe('shouldAutoSelectOnLogin (2026-06-07: post-login auto-pick default model)', () => {
  it('returns true when activeModel is null (fresh install / post-logout state)', () => {
    // 2026-06-07 real-E2E: after successful login, the user got
    // "No model selected or model not found" because activeModel was
    // null. Auto-select the default model so the chat is usable
    // immediately.
    expect(shouldAutoSelectOnLogin(null)).toBe(true);
  });

  it('returns false when activeModel is already a web model (user re-logged in, model survived)', () => {
    expect(shouldAutoSelectOnLogin({
      provider: 'web',
      modelId: 'web:glm:glm-4.6',
    })).toBe(false);
  });

  it('returns false when activeModel is a non-web provider (user explicitly chose anthropic)', () => {
    // We do NOT auto-select over a non-null model. If the user chose
    // anthropic and then happens to log in to a web provider, we
    // don't silently switch their model.
    expect(shouldAutoSelectOnLogin({
      provider: 'anthropic',
      modelId: 'claude-3-7-sonnet',
    })).toBe(false);
  });

  it('returns false for any non-null activeModel (regardless of provider)', () => {
    expect(shouldAutoSelectOnLogin({
      provider: 'openai',
      modelId: 'gpt-4o',
    })).toBe(false);
    expect(shouldAutoSelectOnLogin({
      provider: 'custom',
      modelId: 'custom:my-endpoint:my-model',
    })).toBe(false);
  });
});
