import { describe, it, expect } from 'vitest';
import { WEB_PROVIDER_PRESETS, resolveEffectiveConfig } from '@/lib/ai-config/web-provider-presets';
import type { WebProvider } from '@/lib/types';

describe('WEB_PROVIDER_PRESETS', () => {
  it('all 3 presets have valid cookieDomain', () => {
    for (const p of WEB_PROVIDER_PRESETS) {
      expect(p.cookieDomain).toMatch(/^[a-z0-9.-]+$/);
      expect(p.cookieDomain.length).toBeGreaterThan(0);
    }
  });

  it('all 3 presets have at least 1 sessionIndicator', () => {
    for (const p of WEB_PROVIDER_PRESETS) {
      expect(p.sessionIndicators.length).toBeGreaterThanOrEqual(1);
      // All indicators should be non-empty strings
      for (const indicator of p.sessionIndicators) {
        expect(indicator.length).toBeGreaterThan(0);
      }
    }
  });

  it('only GLM has refreshUrl set (others do not need token exchange)', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const kimi = WEB_PROVIDER_PRESETS.find(p => p.id === 'kimi')!;
    const ds = WEB_PROVIDER_PRESETS.find(p => p.id === 'deepseek')!;
    expect(glm.refreshUrl).toBeDefined();
    expect(glm.refreshUrl).toMatch(/^https:\/\//);
    expect(kimi.refreshUrl).toBeUndefined();
    expect(ds.refreshUrl).toBeUndefined();
  });

  it('Kimi uses localStorage fallback (chromeclaw confirms localStorage path)', () => {
    const kimi = WEB_PROVIDER_PRESETS.find(p => p.id === 'kimi')!;
    expect(kimi.useLocalStorageFallback).toBe(true);
    // GLM and DeepSeek should NOT use localStorage fallback
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const ds = WEB_PROVIDER_PRESETS.find(p => p.id === 'deepseek')!;
    expect(glm.useLocalStorageFallback).toBe(false);
    expect(ds.useLocalStorageFallback).toBe(false);
  });
});

describe('resolveEffectiveConfig', () => {
  const baseProvider = (overrides: WebProvider['userOverrides']): WebProvider => ({
    presetId: 'glm',
    enabled: true,
    loginStatus: 'unknown',
    modelId: 'GLM-4.6',
    supportsToolCalls: true,
    supportsReasoning: false,
    lastCheckedAt: null,
    encryptedCookieBundle: null,
    userOverrides: overrides,
    loginAuditLog: [],
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
  });

  it('returns preset values when no user overrides', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const provider = baseProvider(null);
    const effective = resolveEffectiveConfig(provider, glm);
    expect(effective.cookieDomain).toBe(glm.cookieDomain);
    expect(effective.sessionIndicators).toEqual(glm.sessionIndicators);
    expect(effective.useLocalStorageFallback).toBe(glm.useLocalStorageFallback);
    expect(effective.refreshUrl).toBe(glm.refreshUrl);
    expect(effective.source.cookieDomain).toBe('preset');
    expect(effective.source.sessionIndicators).toBe('preset');
    expect(effective.source.useLocalStorageFallback).toBe('preset');
    expect(effective.source.refreshUrl).toBe('preset');
  });

  it('returns user values when overrides present (A2 KEY ONE)', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const provider = baseProvider({
      cookieDomain: 'custom.example.com',
      sessionIndicators: ['custom-cookie-name'],
    });
    const effective = resolveEffectiveConfig(provider, glm);
    expect(effective.cookieDomain).toBe('custom.example.com');
    expect(effective.source.cookieDomain).toBe('user');
    expect(effective.sessionIndicators).toEqual(['custom-cookie-name']);
    expect(effective.source.sessionIndicators).toBe('user');
    // Other fields still from preset
    expect(effective.useLocalStorageFallback).toBe(glm.useLocalStorageFallback);
    expect(effective.source.useLocalStorageFallback).toBe('preset');
    expect(effective.refreshUrl).toBe(glm.refreshUrl);
    expect(effective.source.refreshUrl).toBe('preset');
  });

  it('source tracking is correct: per-field independent (preset OR user)', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const provider = baseProvider({
      // only override useLocalStorageFallback
      useLocalStorageFallback: true,
    });
    const effective = resolveEffectiveConfig(provider, glm);
    expect(effective.source.cookieDomain).toBe('preset');
    expect(effective.source.sessionIndicators).toBe('preset');
    expect(effective.source.useLocalStorageFallback).toBe('user');
    expect(effective.source.refreshUrl).toBe('preset');
  });

  it('user can override refreshUrl (e.g. Kimi to enable GLM-like token exchange)', () => {
    const kimi = WEB_PROVIDER_PRESETS.find(p => p.id === 'kimi')!;
    const provider = baseProvider({
      // (type-cast: provider is glm in helper, but preset can be kimi)
    } as any);
    // Re-cast to kimi
    const kimiProvider = { ...provider, presetId: 'kimi' as const } as WebProvider;
    const withRefresh = {
      ...kimiProvider,
      userOverrides: { refreshUrl: 'https://kimi.com/api/refresh' },
    };
    const effective = resolveEffectiveConfig(withRefresh, kimi);
    expect(effective.refreshUrl).toBe('https://kimi.com/api/refresh');
    expect(effective.source.refreshUrl).toBe('user');
  });
});
