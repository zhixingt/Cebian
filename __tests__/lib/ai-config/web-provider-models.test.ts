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
  it('returns the preset defaultModelId for each built-in provider', () => {
    expect(getModelIdForProvider('kimi')).toBe('kimi-k2-0711-preview');
    expect(getModelIdForProvider('glm')).toBe('glm-4.6');
    expect(getModelIdForProvider('deepseek')).toBe('deepseek-chat');
  });

  it('returns null for unknown presetId', () => {
    // @ts-expect-error - intentional bad input
    expect(getModelIdForProvider('unknown')).toBeNull();
  });
});

describe('resolveWebModel (T5: pi-ai Model<web-session> shape)', () => {
  it('returns a Model with api=WEB_SESSION_API for Kimi', () => {
    const model = resolveWebModel('kimi', 'kimi-k2-0905-preview');
    expect(model.api).toBe(WEB_SESSION_API);
    expect(model.id).toBe('web:kimi:kimi-k2-0905-preview');
    expect(model.name).toContain('kimi-k2-0905-preview');
    expect(model.provider).toBeTruthy();
    expect(model.baseUrl).toMatch(/^https:\/\//);
    expect(model.input).toEqual(['text']);  // MVP: no images
    expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(model.contextWindow).toBeGreaterThan(0);
    expect(model.maxTokens).toBeGreaterThan(0);
  });

  it('returns a Model for GLM with reasoning=false (per preset)', () => {
    const model = resolveWebModel('glm', 'glm-4.6');
    expect(model.reasoning).toBe(false);
    expect(model.api).toBe(WEB_SESSION_API);
    // ⑧: baseUrl is the provider's login page (informational; no HTTP fetch)
    expect(model.baseUrl).toBe('https://chatglm.cn');
  });

  it('returns a Model for DeepSeek with reasoning=true (per preset)', () => {
    const model = resolveWebModel('deepseek', 'deepseek-chat');
    expect(model.reasoning).toBe(true);
    expect(model.api).toBe(WEB_SESSION_API);
    expect(model.baseUrl).toBe('https://chat.deepseek.com');
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
      makeProvider({ presetId: 'kimi', modelId: 'kimi-k2-0905-preview', loginStatus: 'loggedIn' }),
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.6', loginStatus: 'loggedIn' }),
      makeProvider({ presetId: 'deepseek', modelId: 'deepseek-chat', loginStatus: 'loggedIn' }),
    ];
    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(3);
    expect(models.map(m => m.id).sort()).toEqual([
      'web:deepseek:deepseek-chat',
      'web:glm:GLM-4.6',
      'web:kimi:kimi-k2-0905-preview',
    ]);
  });

  it('filters out non-logged-in providers', () => {
    const providers = [
      makeProvider({ presetId: 'kimi', modelId: 'kimi-k2-0905-preview', loginStatus: 'loggedIn' }),
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.6', loginStatus: 'loggedOut' }),
      makeProvider({ presetId: 'deepseek', modelId: 'deepseek-chat', loginStatus: 'unknown' }),
    ];
    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('web:kimi:kimi-k2-0905-preview');
  });

  it('filters out disabled providers', () => {
    const providers = [
      makeProvider({ presetId: 'kimi', modelId: 'kimi-k2-0905-preview', loginStatus: 'loggedIn', enabled: true }),
      makeProvider({ presetId: 'glm', modelId: 'GLM-4.6', loginStatus: 'loggedIn', enabled: false }),
    ];
    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('web:kimi:kimi-k2-0905-preview');
  });

  it('uses provider.modelId (not preset default) when set', () => {
    const providers = [
      makeProvider({ presetId: 'glm', loginStatus: 'loggedIn', modelId: 'GLM-4.5' }),
    ];
    const models = getAvailableWebModels(providers);
    expect(models[0].id).toBe('web:glm:GLM-4.5');
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
      makeProvider({ presetId: 'kimi', loginStatus: 'loggedIn', enabled: true }),
    ];

    const resolved = resolveSelectedWebModel(
      { provider: 'web', modelId: 'web:kimi:kimi-k2-0905-preview' },
      providers,
    );

    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe('web:kimi:kimi-k2-0905-preview');
    expect(resolved!.api).toBe(WEB_SESSION_API);
  });

  it('returns null for non-web activeModel provider', () => {
    const providers = [makeProvider({ presetId: 'kimi' })];
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
    const providers = [
      makeProvider({ presetId: 'deepseek', loginStatus: 'loggedOut' }),
      makeProvider({ presetId: 'kimi', enabled: false, loginStatus: 'loggedIn' }),
    ];

    const deepseek = resolveSelectedWebModel(
      { provider: 'web', modelId: 'web:deepseek:deepseek-chat' },
      providers,
    );
    const kimi = resolveSelectedWebModel(
      { provider: 'web', modelId: 'web:kimi:kimi-k2-0905-preview' },
      providers,
    );

    expect(deepseek).toBeNull();
    expect(kimi).toBeNull();
  });
});
