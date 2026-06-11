import type { WebProvider, WebProviderUserOverrides } from '../types';
import {
  DOM_STRATEGIES,
  type WebProviderDomStrategy,
} from './web-provider-dom-strategy';

/**
 * ⑧: per-preset DOM strategy. Tells the relay how to inject the message into
 * the provider's chat input and how to read the AI's reply from the DOM.
 *
 * Why DOM (not HTTP replay) — see web-provider-dom-strategy.ts header.
 * Required for all built-in presets; if a preset is missing this, it cannot
 * be used for chat. User-defined presets are a future feature.
 */
export type { WebProviderDomStrategy } from './web-provider-dom-strategy';

/**
 * Per-model configuration within a preset.
 * Each model maps to a provider-specific internal ID (e.g. GLM's assistant_id).
 */
export interface WebProviderModel {
  /** Display name shown in the model selector (e.g. "GLM-5.1") */
  label: string;
  /** Stable ID used as the activeModel key (e.g. "glm-5.1") */
  id: string;
  /** Provider-specific internal model identifier (e.g. GLM assistant_id) */
  assistantId: string;
  /** Whether this model supports tool/function calling */
  supportsToolCalls: boolean;
  /** Whether this model exposes a reasoning / thinking process */
  supportsReasoning: boolean;
}

/**
 * Built-in web AI provider presets.
 * Adding a new preset = append an entry here + add 3 i18n keys.
 * User-defined presets are a future feature; not supported in MVP.
 */
export interface WebProviderPreset {
  /** Unique id, matches WebProvider['presetId'] */
  id: WebProvider['presetId'];

  /** Display name (i18n key, resolved at render time) */
  displayNameKey: string;

  /** Short description (i18n key). Omit to render no description line. */
  descriptionKey?: string;

  /** Official website URL (target of the "Open" button) */
  loginUrl: string;

  /** Available models for this provider. Ordered by recommended first. */
  models: readonly WebProviderModel[];

  /** Default model id when the user has no preference. */
  defaultModelId: string;

  /** ⭐ ②: cookie domain for `chrome.cookies.getAll({ domain })` */
  cookieDomain: string;

  /** ⭐ ②: cookie names whose presence indicates a logged-in session. ANY name match → has session. */
  sessionIndicators: string[];

  /** ⭐ ②: also check localStorage (for providers like Kimi that store tokens there) */
  useLocalStorageFallback: boolean;

  /** ⭐ ②: optional URL to exchange refresh_token for access_token (GLM only) */
  refreshUrl?: string;

  /** ⭐ ⑧: per-preset DOM strategy. Replaces the old chatApi (HTTP replay)
   *  approach which cannot work for any of the 3 built-in providers (T1). */
  domStrategy: WebProviderDomStrategy;
}

export const WEB_PROVIDER_PRESETS: readonly WebProviderPreset[] = [
  {
    id: 'glm',
    displayNameKey: 'webProviders.presets.glm.name',
    // 2026-06-11: removed descriptionKey — was empty and triggered
    // `[i18n] Message not found` warnings on every settings render.
    // The card now renders without a description line.
    // 2026-06-07: was 'https://chatglm.cn' (root). After login the root
    // URL redirects to /main/alltoolsdetail (the tool description page),
    // NOT the chat interface. The DOM reader on the wrong page finds
    // a stale .markdown-body describing tools, gets it filtered as
    // noise by minChunkLength:2, and burns the full 60s maxTotalMs
    // before timing out. Sidepanel then shows the RotateCcw retry
    // icon with empty text — looks like "single refresh symbol". Best-
    // effort fix: open /main/chat/new (the "new conversation" entry
    // point) so the user lands on a real chat surface. If the path
    // changes, only this constant needs updating.
    loginUrl: 'https://chatglm.cn/main/chat/new',
    models: [
      {
        id: 'glm-5.1',
        label: 'GLM-5.1',
        // 2026-06-10: captured from chatglm.cn DevTools — GLM-5.1 reuses the same
        // assistant_id as GLM-4.6. Model differentiation is server-side; the client
        // only needs to pass a valid assistant_id. Both models use 65940acff94777010aa6b796.
        assistantId: '65940acff94777010aa6b796',
        supportsToolCalls: true,
        supportsReasoning: false,
      },
      {
        id: 'glm-4.6',
        label: 'GLM-4.6',
        assistantId: '65940acff94777010aa6b796',
        supportsToolCalls: true,
        supportsReasoning: false,
      },
    ],
    defaultModelId: 'glm-5.1',
    cookieDomain: 'chatglm.cn',
    sessionIndicators: ['chatglm_refresh_token', 'chatglm_token'],
    useLocalStorageFallback: false,
    refreshUrl: 'https://chatglm.cn/api/v1/auth/refresh',
    // ⭐ ⑧: DOM strategy. Verified 2026-06-04 via T1 DevTools research.
    //   - chat input: <textarea data-testid="chat-input">
    //   - assistant message: .message-content.assistant-message-content
    // GLM's HTTP API requires HMAC X-Sign (reverse-engineer JS) + 9
    // per-request headers from localStorage. DOM injection bypasses all of that.
    domStrategy: DOM_STRATEGIES.glm,
  },
] as const;

/**
 * A2 KEY ONE: merge preset values with user's overrides.
 * User wins on every field that has an override; others fall through to preset.
 * The returned `source` object indicates which fields came from where.
 *
 * Usage:
 *   const effective = resolveEffectiveConfig(provider, preset);
 *   chrome.cookies.getAll({ domain: effective.cookieDomain });
 *   effective.sessionIndicators.some(name => cookieMap[name]);
 */
export function resolveEffectiveConfig(
  provider: WebProvider,
  preset: WebProviderPreset,
): WebProviderPreset & { source: Record<keyof WebProviderUserOverrides, 'preset' | 'user'> } {
  const u = provider.userOverrides ?? {};
  return {
    ...preset,
    cookieDomain: u.cookieDomain ?? preset.cookieDomain,
    sessionIndicators: u.sessionIndicators ?? preset.sessionIndicators,
    useLocalStorageFallback: u.useLocalStorageFallback ?? preset.useLocalStorageFallback,
    refreshUrl: u.refreshUrl ?? preset.refreshUrl,
    source: {
      cookieDomain: u.cookieDomain !== undefined ? 'user' : 'preset',
      sessionIndicators: u.sessionIndicators !== undefined ? 'user' : 'preset',
      useLocalStorageFallback: u.useLocalStorageFallback !== undefined ? 'user' : 'preset',
      refreshUrl: u.refreshUrl !== undefined ? 'user' : 'preset',
    },
  };
}
