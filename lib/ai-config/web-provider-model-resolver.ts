/**
 * ⑨.4: Resolve which model + assistantId to use for a Web Provider chat request.
 *
 * Resolution order:
 *   1. provider.modelId if it matches a known model in the preset
 *   2. preset.defaultModelId as fallback
 *   3. First entry in preset.models (last-resort)
 *
 * Throws if the preset has no models configured (caller bug).
 */
import type { WebProviderPreset, WebProviderModel } from './web-provider-presets';
import type { WebProvider } from '../types';

export interface ResolvedModel {
  id: string;
  label: string;
  assistantId: string;
  supportsToolCalls: boolean;
}

/**
 * Find a model entry in a preset by id. Returns undefined if not found.
 */
export function findModel(
  preset: WebProviderPreset,
  modelId: string,
): WebProviderModel | undefined {
  return preset.models.find(m => m.id === modelId);
}

/**
 * Resolve which model + assistantId to use for a chat request.
 *
 * Resolution order:
 *   1. provider.modelId if it matches a known model in the preset
 *   2. preset.defaultModelId as fallback
 *   3. First entry in preset.models (last-resort)
 *
 * Throws if the preset has no models configured (caller bug).
 */
export function resolveWebProviderModel(
  provider: WebProvider,
  preset: WebProviderPreset,
): ResolvedModel {
  if (preset.models.length === 0) {
    throw new Error(`Preset "${preset.id}" has no models configured.`);
  }

  const model =
    findModel(preset, provider.modelId) ??
    findModel(preset, preset.defaultModelId) ??
    preset.models[0];

  return {
    id: model.id,
    label: model.label,
    assistantId: model.assistantId,
    supportsToolCalls: model.supportsToolCalls,
  };
}
