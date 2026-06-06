import { describe, it, expect } from 'vitest';
// Import the pure function (not the React component, which pulls in i18n
// via a WXT alias that doesn't resolve under vitest).
import { buildProviderGroups, type ProviderGroup } from '@/components/chat/provider-groups';
import type { WebProvider } from '@/lib/types';
import { getModels } from '@earendil-works/pi-ai';

function makeWebProvider(overrides: Partial<WebProvider> = {}): WebProvider {
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

describe('buildProviderGroups (T12: ③+④ Web (Logged in) group)', () => {
  it('returns empty array when no providers configured', () => {
    const groups = buildProviderGroups({}, [], []);
    expect(groups).toEqual([]);
  });

  it('includes Web group at TOP when GLM provider is logged in', () => {
    const webProviders = [
      makeWebProvider({ presetId: 'glm', modelId: 'GLM-4.6' }),
    ];
    const groups = buildProviderGroups({}, [], webProviders);
    expect(groups[0].provider).toBe('web');
    expect(groups[0].label).toMatch(/web/i);
    expect(groups[0].models).toHaveLength(1);
    // Verify model ids are web-session format
    expect(groups[0].models.map(m => m.id)).toEqual([
      'web:glm:GLM-4.6',
    ]);
  });

  it('does NOT include Web group when no providers are logged in', () => {
    const webProviders = [
      makeWebProvider({ presetId: 'glm', loginStatus: 'loggedOut' }),
    ];
    const groups = buildProviderGroups({}, [], webProviders);
    expect(groups.find(g => g.provider === 'web')).toBeUndefined();
  });

  it('does NOT include Web group when webProviders is empty', () => {
    const groups = buildProviderGroups({}, [], []);
    expect(groups.find(g => g.provider === 'web')).toBeUndefined();
  });

  it('Web group uses resolveWebModel (api=WEB_SESSION_API) for each model', () => {
    const webProviders = [makeWebProvider({ presetId: 'glm', modelId: 'GLM-4.6' })];
    const groups = buildProviderGroups({}, [], webProviders);
    expect(groups[0].models[0].api).toBe('web-session');
    expect(groups[0].models[0].name).toContain('GLM-4.6');
  });

  it('Web group is positioned BEFORE custom providers and built-in pi-ai providers', () => {
    // Mock a built-in provider as configured + verified
    const configured = {
      anthropic: { verified: true, key: 'x' },  // any built-in
    } as any;
    const customProviders = [
      { id: 'custom-1', name: 'Custom 1', baseUrl: 'https://x', models: [{ modelId: 'm', name: 'M' }] } as any,
    ];
    const webProviders = [makeWebProvider({ presetId: 'glm' })];

    const groups = buildProviderGroups(configured, customProviders, webProviders);
    expect(groups[0].provider).toBe('web');
    // The remaining groups (custom + built-in) come after
    expect(groups.length).toBeGreaterThan(1);
  });

  it('Web group is hidden when all web providers are disabled (even if logged in)', () => {
    const webProviders = [
      makeWebProvider({ presetId: 'glm', enabled: false, loginStatus: 'loggedIn' }),
    ];
    const groups = buildProviderGroups({}, [], webProviders);
    expect(groups.find(g => g.provider === 'web')).toBeUndefined();
  });

  it('Web group renders i18n label key (resolved by Component, not buildProviderGroups)', () => {
    // The function returns a label KEY; the Component resolves via t().
    const webProviders = [makeWebProvider({ presetId: 'glm' })];
    const groups = buildProviderGroups({}, [], webProviders);
    expect(groups[0].label).toMatch(/^webProviders\./);
  });
});
