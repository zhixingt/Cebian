import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getModelIdForProvider,
  resolveWebModel,
  getAvailableWebModels,
  resolveSelectedWebModel,
  WEB_SESSION_API,
} from '@/lib/ai-config/web-provider-models';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import type { WebProvider } from '@/lib/types';

describe('getModelIdForProvider (T5: ③+④ model lookup)', () => {
  it('returns the preset defaultModelId for GLM (sole built-in provider)', () => {
    expect(getModelIdForProvider('glm')).toBe('glm-4.6');
  });

  it('returns null for unknown presetId', () => {
    // @ts-expect-error - intentional bad input
    expect(getModelIdForProvider('unknown')).toBeNull();
  });
});

describe('resolveWebModel (T5: pi-ai Model<web-session> shape)', () => {
  it('returns a Model for GLM with reasoning=false (per preset)', () => {
    const model = resolveWebModel('glm', 'glm-4.6');
    expect(model.api).toBe(WEB_SESSION_API);
    expect(model.id).toBe('web:glm:glm-4.6');
    expect(model.name).toContain('glm-4.6');
    expect(model.provider).toBeTruthy();
    expect(model.baseUrl).toBe('https://chatglm.cn');
    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(['text']);  // MVP: no images
    expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(model.contextWindow).toBeGreaterThan(0);
    expect(model.maxTokens).toBeGreaterThan(0);
  });

  it('throws on unknown providerId', () => {
    // @ts-expect-error - intentional bad input
    expect(() => resolveWebModel('unknown', 'x')).toThrow();
  });
});

describe('getAvailableWebModels (T5: filter logged-in providers)', () => {
  beforeEach(async () => {
    const { getDb } = await import('@/lib/db');
    await getDb().webProviders.clear();
  });

  function makeProvider(overrides: Partial<WebProvider> = {}): WebProvider {
    return {
      presetId: 'glm',
      enabled: true,
      loginStatus: 'loggedIn',
      modelId: 'GLM-4.6',
      supportsToolCalls: true,
      supportsReasoning: false,
      lastCheckedAt: null,
      encryptedCookieBundle: null,
      userOverrides: null,
      loginAuditLog: [],
      createdAt: '2026-06-04T00:00:00Z',
      updatedAt: '2026-06-04T00:00:00Z',
      ...overrides,
    } as WebProvider;
  }

  it('returns empty array for empty providers list', () => {
    expect(getAvailableWebModels([])).toEqual([]);
  });

  it('returns one Model per logged-in + enabled provider', () => {
    const providers = [
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.6', loginStatus: 'loggedIn' }),
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.5', loginStatus: 'loggedOut' }),
      makeProvider({ presetId: 'glm', modelId: 'GLM-5', loginStatus: 'unknown' }),
    ];
    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(1);
    expect(models.map(m => m.id).sort()).toEqual([
      'web:glm:GLM-4.6',
    ]);
  });

  it('filters out non-logged-in providers', () => {
    const providers = [
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.6', loginStatus: 'loggedIn' }),
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.5', loginStatus: 'loggedOut' }),
      makeProvider({ presetId: 'glm', modelId: 'GLM-5', loginStatus: 'unknown' }),
    ];
    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('web:glm:GLM-4.6');
  });

  it('filters out disabled providers', () => {
    const providers = [
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.6', loginStatus: 'loggedIn', enabled: true }),
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.5', loginStatus: 'loggedIn', enabled: false }),
    ];
    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('web:glm:GLM-4.6');
  });

  it('uses provider.modelId (not preset default) when set', () => {
    const providers = [
      makeProvider({ presetId: 'glm', loginStatus: 'loggedIn', modelId: 'GLM-4.5' }),
    ];
    const models = getAvailableWebModels(providers);
    expect(models[0].id).toBe('web:glm:GLM-4.5');
  });

  // Regression: a row from a preset that was removed from WEB_PROVIDER_PRESETS
  // (e.g. user previously logged into a now-removed provider) can linger in
  // IndexedDB. list() does not delete stale rows, so getAvailableWebModels
  // must defensively skip them — otherwise resolveWebModel throws inside the
  // .map() callback, which crashes the React tree at render time.
  it('silently skips providers whose presetId is no longer registered', () => {
    const stale = makeProvider({
      // @ts-expect-error - simulating a leftover row from a removed preset
      presetId: 'deepseek',
      modelId: 'deepseek-chat',
      loginStatus: 'loggedIn',
      enabled: true,
    });
    const live = makeProvider({ presetId: 'glm', modelId: 'GLM-4.6' });
    const models = getAvailableWebModels([stale, live]);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('web:glm:GLM-4.6');
  });
});

describe('resolveSelectedWebModel (web activeModel resolution)', () => {
  function makeProvider(overrides: Partial<WebProvider> = {}): WebProvider {
    return {
      presetId: 'glm',
      enabled: true,
      loginStatus: 'loggedIn',
      modelId: 'GLM-4.6',
      supportsToolCalls: true,
      supportsReasoning: false,
      lastCheckedAt: null,
      encryptedCookieBundle: null,
      userOverrides: null,
      loginAuditLog: [],
      createdAt: '2026-06-04T00:00:00Z',
      updatedAt: '2026-06-04T00:00:00Z',
      ...overrides,
    } as WebProvider;
  }

  it('resolves selected web model when provider is enabled + loggedIn', () => {
    const providers = [
      makeProvider({ presetId: 'glm', loginStatus: 'loggedIn', enabled: true }),
    ];

    const resolved = resolveSelectedWebModel(
      { provider: 'web', modelId: 'web:glm:GLM-4.6' },
      providers,
    );

    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe('web:glm:GLM-4.6');
    expect(resolved!.api).toBe(WEB_SESSION_API);
  });

  it('returns null for non-web activeModel provider', () => {
    const providers = [makeProvider({ presetId: 'glm' })];
    const resolved = resolveSelectedWebModel(
      { provider: 'anthropic', modelId: 'claude-3-7-sonnet' },
      providers,
    );
    expect(resolved).toBeNull();
  });

  it('returns null for invalid web model id format', () => {
    const providers = [makeProvider({ presetId: 'glm' })];
    expect(resolveSelectedWebModel({ provider: 'web', modelId: 'glm-4.6' }, providers)).toBeNull();
    expect(resolveSelectedWebModel({ provider: 'web', modelId: 'web:glm' }, providers)).toBeNull();
  });

  it('returns null when target provider is loggedOut or disabled', () => {
    // Only GLM available; loggedOut + disabled entries should not resolve.
    const providers = [
      makeProvider({ presetId: 'glm', loginStatus: 'loggedOut' }),
      makeProvider({ presetId: 'glm', enabled: false, loginStatus: 'loggedIn' }),
    ];

    const loggedOut = resolveSelectedWebModel(
      { provider: 'web', modelId: 'web:glm:GLM-4.6' },
      providers,
    );
    expect(loggedOut).toBeNull();

    // Make GLM enabled+loggedIn via overrides and verify it resolves
    const providers2 = [
      makeProvider({ presetId: 'glm', loginStatus: 'loggedIn', enabled: true }),
    ];
    const glm = resolveSelectedWebModel(
      { provider: 'web', modelId: 'web:glm:GLM-4.6' },
      providers2,
    );
    expect(glm).not.toBeNull();
    expect(glm?.id).toBe('web:glm:GLM-4.6');
  });

  // Regression: a stale Dexie row (presetId no longer in WEB_PROVIDER_PRESETS)
  // must not propagate to resolveWebModel. Returns null so the agent falls
  // back to its "no model" / re-select path instead of throwing.
  it('returns null when activeModel points at a removed preset', () => {
    const stale = makeProvider({
      // @ts-expect-error - simulating a leftover row from a removed preset
      presetId: 'deepseek',
      modelId: 'deepseek-chat',
      loginStatus: 'loggedIn',
      enabled: true,
    });
    const resolved = resolveSelectedWebModel(
      { provider: 'web', modelId: 'web:deepseek:deepseek-chat' },
      [stale],
    );
    expect(resolved).toBeNull();
  });
});
