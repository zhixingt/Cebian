/**
 * ③+④ T5 — pi-ai Model lookup layer for web providers.
 *
 * Bridges WebProvider (Dexie record) → pi-ai Model<'web-session'>.
 * Used by the model selector (T12) and the stream registration (T10).
 *
 * Why a separate module:
 *   - Centralizes the Model<WEB_SESSION_API> shape construction
 *   - One place to add a provider: just add to WEB_PROVIDER_PRESETS
 *   - The 3 callers (selector, stream, agent-manager) all need the same shape
 *
 * Out of scope:
 *   - Per-provider cost (all free; user is using their own session)
 *   - Image input (MVP: text only; `input: ['text']`)
 *   - Tool support metadata (T10 stream fn will handle that)
 */

import type { Model } from '@earendil-works/pi-ai';
import type { WebProvider } from '../types';
import { WEB_PROVIDER_PRESETS } from './web-provider-presets';

/** ③+④: custom pi-ai API kind for web session chat. Registered in T10. */
export const WEB_SESSION_API = 'web-session' as const;

/** pi-ai Model shape with our custom 'web-session' api. */
export type WebProviderModel = Model<typeof WEB_SESSION_API>;

/** Default context window for web providers (128K — conservative; covers most chat models). */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Default max tokens per response. */
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * Get the default model id for a built-in preset.
 * @returns the preset's defaultModelId, or null if preset not found.
 */
export function getModelIdForProvider(
  presetId: WebProvider['presetId'],
): string | null {
  const preset = WEB_PROVIDER_PRESETS.find(p => p.id === presetId);
  return preset?.defaultModelId ?? null;
}

/**
 * Build a pi-ai Model<WEB_SESSION_API> for a web provider.
 * Throws if the provider is unknown.
 *
 * Note: `compat` is NOT set. For api='web-session' (not openai-completions/responses/anthropic-messages),
 * the compat field resolves to `never`, so omitting it is correct.
 */
export function resolveWebModel(
  providerId: WebProvider['presetId'],
  modelId: string,
): WebProviderModel {
  const preset = WEB_PROVIDER_PRESETS.find(p => p.id === providerId);
  if (!preset) {
    throw new Error(`Unknown web provider: ${providerId}`);
  }
  return {
    id: `web:${providerId}:${modelId}`,
    name: `${preset.displayNameKey} ${modelId}`,
    api: WEB_SESSION_API,
    provider: WEB_SESSION_API,  // Provider = KnownProvider | string; any string is allowed
    // ⑧: baseUrl is the provider's login page (informational only; actual
    // chat goes through the DOM in the tab, not via HTTP to this URL).
    baseUrl: preset.loginUrl,
    reasoning: preset.defaultSupportsReasoning,
    input: ['text'],  // MVP: no images (text-only for web session)
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },  // free (user's own session)
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

/**
 * Filter a providers list to those available for chat (logged in + enabled).
 * Returns pi-ai Model<web-session> objects ready for the model registry.
 *
 * Caller is responsible for fetching providers (e.g., from useWebProviders hook
 * or getWebProviderRepository().list()). Keeping this pure for testability.
 */
export function getAvailableWebModels(providers: WebProvider[]): WebProviderModel[] {
  return providers
    .filter(p => p.enabled && p.loginStatus === 'loggedIn')
    .map(p => resolveWebModel(p.presetId, p.modelId));
}
