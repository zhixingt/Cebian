import { describe, it, expect } from 'vitest';
import { WEB_PROVIDER_PRESETS, resolveEffectiveConfig } from '@/lib/ai-config/web-provider-presets';
import type { WebProviderDomStrategy } from '@/lib/ai-config/web-provider-presets';
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

  it('only GLM is in the preset list (DeepSeek and Kimi removed)', () => {
    expect(WEB_PROVIDER_PRESETS).toHaveLength(1);
    expect(WEB_PROVIDER_PRESETS[0].id).toBe('glm');
  });

  it('GLM has refreshUrl set', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    expect(glm.refreshUrl).toBeDefined();
    expect(glm.refreshUrl).toMatch(/^https:\/\//);
  });

  it('GLM does NOT use localStorage fallback (cookie-backed token)', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    expect(glm.useLocalStorageFallback).toBe(false);
  });

  it('T2: WebProviderDomStrategy interface has input + reader (TDD: compile-time check)', () => {
    // Compile-time: if interface is missing or has wrong shape, this line fails TS.
    const sample: WebProviderDomStrategy = {
      input: {
        selector: 'textarea',
        setMethod: 'textarea-setter',
        sendMethod: 'enter',
      },
      reader: {
        assistantMessageSelector: '.message',
        pollIntervalMs: 100,
        stableThresholdMs: 800,
      },
    };
    expect(sample.input.selector).toBeTruthy();
    expect(sample.reader.assistantMessageSelector).toBeTruthy();
  });

  it('T2: presets have domStrategy field (replaces old chatApi from ③+④)', () => {
    for (const p of WEB_PROVIDER_PRESETS) {
      const dom: WebProviderDomStrategy = p.domStrategy;
      expect(dom, `${p.id} should have domStrategy defined`).toBeDefined();
    }
  });

  it('T2: each preset domStrategy has input + reader', () => {
    for (const p of WEB_PROVIDER_PRESETS) {
      const dom = p.domStrategy;
      expect(dom.input.selector.length, `${p.id} input selector`).toBeGreaterThan(0);
      expect(['textarea-setter', 'contenteditable-setter', 'execCommand']).toContain(dom.input.setMethod);
      expect(['enter', 'ctrl-enter', 'click-send-button']).toContain(dom.input.sendMethod);
      expect(dom.reader.assistantMessageSelector.length, `${p.id} reader selector`).toBeGreaterThan(0);
    }
  });

  it('T2: 3 preset input selectors are appropriate (textarea-setter OR contenteditable-setter)', () => {
    // Selectors don't need to be unique (GLM and DeepSeek both correctly use
    // 'textarea' because they don't add a data-testid); but each preset's
    // selector+setMethod combination should be sensible.
    for (const p of WEB_PROVIDER_PRESETS) {
      const sel = p.domStrategy.input.selector;
      const setMethod = p.domStrategy.input.setMethod;
      if (setMethod === 'textarea-setter') {
        // textarea-setter needs a textarea (or input) element
        expect(sel.toLowerCase()).toMatch(/textarea|input/);
      } else if (setMethod === 'contenteditable-setter') {
        // contenteditable-setter targets a contenteditable div (class hint)
        expect(sel).toBeTruthy();
      }
    }
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

  it('user can override refreshUrl for GLM (custom token exchange endpoint)', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const provider = baseProvider({});
    const withRefresh = {
      ...provider,
      userOverrides: { refreshUrl: 'https://custom.chatglm.cn/api/refresh' },
    };
    const effective = resolveEffectiveConfig(withRefresh, glm);
    expect(effective.refreshUrl).toBe('https://custom.chatglm.cn/api/refresh');
    expect(effective.source.refreshUrl).toBe('user');
  });
});
