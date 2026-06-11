import { describe, it, expect } from 'vitest';
import { resolveWebProviderModel, findModel } from '@/lib/ai-config/web-provider-model-resolver';
import type { WebProviderPreset } from '@/lib/ai-config/web-provider-presets';
import type { WebProvider } from '@/lib/types';

const makePreset = (overrides?: Partial<WebProviderPreset>): WebProviderPreset => ({
  id: 'glm',
  displayNameKey: 'webProviders.presets.glm.name',
  descriptionKey: 'webProviders.presets.glm.description',
  loginUrl: 'https://chatglm.cn/main/chat/new',
  models: [
    { id: 'glm-5.1', label: 'GLM-5.1', assistantId: 'id-51', supportsToolCalls: true, supportsReasoning: false },
    { id: 'glm-4.6', label: 'GLM-4.6', assistantId: 'id-46', supportsToolCalls: true, supportsReasoning: false },
  ],
  defaultModelId: 'glm-5.1',
  cookieDomain: 'chatglm.cn',
  sessionIndicators: ['chatglm_token'],
  useLocalStorageFallback: false,
  domStrategy: 'glm',
  ...overrides,
} as WebProviderPreset);

const makeProvider = (modelId: string): WebProvider => ({
  presetId: 'glm',
  enabled: true,
  loginStatus: 'loggedIn',
  modelId,
  supportsToolCalls: true,
  supportsReasoning: false,
  lastCheckedAt: null,
  encryptedCookieBundle: null,
  userOverrides: null,
  loginAuditLog: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('findModel', () => {
  it('returns the model entry when id matches', () => {
    const preset = makePreset();
    const model = findModel(preset, 'glm-5.1');
    expect(model).toBeDefined();
    expect(model!.id).toBe('glm-5.1');
    expect(model!.assistantId).toBe('id-51');
  });

  it('returns undefined when id does not match any model', () => {
    const preset = makePreset();
    expect(findModel(preset, 'glm-99')).toBeUndefined();
  });
});

describe('resolveWebProviderModel', () => {
  it('returns the model matching provider.modelId', () => {
    const preset = makePreset();
    const provider = makeProvider('glm-4.6');
    const resolved = resolveWebProviderModel(provider, preset);
    expect(resolved.id).toBe('glm-4.6');
    expect(resolved.label).toBe('GLM-4.6');
    expect(resolved.assistantId).toBe('id-46');
    expect(resolved.supportsToolCalls).toBe(true);
  });

  it('falls back to preset.defaultModelId when provider.modelId is unknown', () => {
    const preset = makePreset();
    const provider = makeProvider('unknown');
    const resolved = resolveWebProviderModel(provider, preset);
    expect(resolved.id).toBe('glm-5.1');
    expect(resolved.assistantId).toBe('id-51');
  });

  it('falls back to first model when provider.modelId is unknown AND defaultModelId is also unknown', () => {
    const preset = makePreset({ defaultModelId: 'non-existent' });
    const provider = makeProvider('unknown');
    const resolved = resolveWebProviderModel(provider, preset);
    expect(resolved.id).toBe('glm-5.1');
  });

  it('throws when preset.models is empty', () => {
    const preset = makePreset({ models: [] });
    const provider = makeProvider('glm-5.1');
    expect(() => resolveWebProviderModel(provider, preset)).toThrow('no models');
  });

  it('propagates per-model supportsToolCalls correctly', () => {
    const preset = makePreset({
      models: [
        { id: 'glm-5.1', label: 'GLM-5.1', assistantId: 'id-51', supportsToolCalls: true, supportsReasoning: false },
        { id: 'glm-4.6', label: 'GLM-4.6', assistantId: 'id-46', supportsToolCalls: false, supportsReasoning: false },
      ],
    });
    const providerWithTools = makeProvider('glm-5.1');
    const providerNoTools = makeProvider('glm-4.6');
    expect(resolveWebProviderModel(providerWithTools, preset).supportsToolCalls).toBe(true);
    expect(resolveWebProviderModel(providerNoTools, preset).supportsToolCalls).toBe(false);
  });
});
