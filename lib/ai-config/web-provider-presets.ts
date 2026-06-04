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
 * Built-in web AI provider presets.
 * Adding a new preset = append an entry here + add 3 i18n keys.
 * User-defined presets are a future feature; not supported in MVP.
 */
export interface WebProviderPreset {
  /** Unique id, matches WebProvider['presetId'] */
  id: WebProvider['presetId'];

  /** Display name (i18n key, resolved at render time) */
  displayNameKey: string;

  /** Short description (i18n key) */
  descriptionKey: string;

  /** Official website URL (target of the "Open" button) */
  loginUrl: string;

  /** Default Model ID */
  defaultModelId: string;

  /** Recommended capability flags; user can override */
  defaultSupportsToolCalls: boolean;
  defaultSupportsReasoning: boolean;

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
    descriptionKey: 'webProviders.presets.glm.description',
    loginUrl: 'https://chatglm.cn',
    defaultModelId: 'glm-4.6',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
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
  {
    id: 'kimi',
    displayNameKey: 'webProviders.presets.kimi.name',
    descriptionKey: 'webProviders.presets.kimi.description',
    loginUrl: 'https://kimi.com',
    defaultModelId: 'kimi-k2-0711-preview',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
    cookieDomain: 'kimi.moonshot.cn',
    sessionIndicators: ['kimi-auth'],
    useLocalStorageFallback: true,
    // ⭐ ⑧: DOM strategy. Verified 2026-06-04.
    //   - chat input: <div class="chat-input-editor" contenteditable="true"> (Lexical editor)
    //   - send: Enter key
    //   - assistant message: last .markdown-body in chat content
    // Kimi's HTTP API is gRPC-web binary protocol. Not feasible for relay.
    domStrategy: DOM_STRATEGIES.kimi,
  },
  {
    id: 'deepseek',
    displayNameKey: 'webProviders.presets.deepseek.name',
    descriptionKey: 'webProviders.presets.deepseek.description',
    loginUrl: 'https://chat.deepseek.com',
    defaultModelId: 'deepseek-chat',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: true,
    cookieDomain: 'chat.deepseek.com',
    // DeepSeek login signals may appear in either cookie or localStorage
    // depending on rollout/region. Keep both to reduce false "Logging in...".
    sessionIndicators: ['sessionid', 'userToken'],
    useLocalStorageFallback: true,
    // ⭐ ⑧: DOM strategy. Verified 2026-06-04.
    //   - chat input: <textarea> (placeholder: "给 DeepSeek 发送消息")
    //   - send: Enter key
    //   - assistant message: last .ds-markdown
    // DeepSeek's HTTP API requires PoW challenge (WebAssembly solver) + Bearer
    // from localStorage. DOM injection bypasses both.
    domStrategy: DOM_STRATEGIES.deepseek,
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
