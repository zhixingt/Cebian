import type { WebProvider, WebProviderUserOverrides } from '../types';

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
}

export const WEB_PROVIDER_PRESETS: readonly WebProviderPreset[] = [
  {
    id: 'glm',
    displayNameKey: 'webProviders.presets.glm.name',
    descriptionKey: 'webProviders.presets.glm.description',
    loginUrl: 'https://chatglm.cn',
    defaultModelId: 'GLM-4.6',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
    cookieDomain: 'chatglm.cn',
    // Unverified guesses. User can override via A2 if wrong.
    sessionIndicators: ['chatglm_refresh_token', 'chatglm_token'],
    useLocalStorageFallback: false,
    // GLM requires token exchange (chromeclaw confirms).
    refreshUrl: 'https://chatglm.cn/api/v1/auth/refresh',
  },
  {
    id: 'kimi',
    displayNameKey: 'webProviders.presets.kimi.name',
    descriptionKey: 'webProviders.presets.kimi.description',
    loginUrl: 'https://kimi.com',
    defaultModelId: 'kimi-k2-0905-preview',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
    cookieDomain: 'kimi.moonshot.cn',
    // Unverified; kimi uses localStorage per chromeclaw
    sessionIndicators: ['kimi-auth'],
    useLocalStorageFallback: true,
    // No refresh exchange for Kimi
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
    // Django-style sessionid guess; user can override via A2
    sessionIndicators: ['sessionid'],
    useLocalStorageFallback: false,
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
