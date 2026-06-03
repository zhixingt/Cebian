import type { WebProvider } from '../types';

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
  },
  {
    id: 'kimi',
    displayNameKey: 'webProviders.presets.kimi.name',
    descriptionKey: 'webProviders.presets.kimi.description',
    loginUrl: 'https://kimi.com',
    defaultModelId: 'kimi-k2-0905-preview',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
  },
  {
    id: 'deepseek',
    displayNameKey: 'webProviders.presets.deepseek.name',
    descriptionKey: 'webProviders.presets.deepseek.description',
    loginUrl: 'https://chat.deepseek.com',
    defaultModelId: 'deepseek-chat',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: true,
  },
] as const;
