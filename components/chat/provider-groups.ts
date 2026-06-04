/**
 * Pure helper for ModelSelector — extracted for unit testability (the
 * ModelSelector React component imports i18n via a WXT alias that doesn't
 * resolve under vitest).
 *
 * Order: Web (Logged in) first (most prominent — free, already-authenticated),
 * then custom providers, then built-in pi-ai providers.
 */

import { getModels, type KnownProvider, type Api, type Model } from '@earendil-works/pi-ai';
import type { ActiveModel, ProviderCredentials, CustomProviderConfig } from '@/lib/storage';
import { isCustomProvider, getCustomModels, customProviderKey } from '@/lib/custom-models';
import { getAvailableWebModels } from '@/lib/ai-config/web-provider-models';
import type { WebProvider } from '@/lib/types';

/** Shape of one provider group in the selector dropdown. */
export interface ProviderGroup {
  provider: string;
  label: string;
  models: Model<Api>[];
}

/**
 * Build the list of provider groups shown in the selector.
 *
 * Web group: appears at TOP when ≥1 web provider is logged in & enabled.
 *            Label is an i18n key ('webProviders.selector.groupLabel');
 *            the React component resolves it via t().
 *
 * @param configuredProviders - built-in pi-ai providers (verified only)
 * @param customProviders     - user-defined custom providers
 * @param webProviders        - web (browser session) providers from Dexie
 */
export function buildProviderGroups(
  configuredProviders: ProviderCredentials,
  customProviders: CustomProviderConfig[],
  webProviders: WebProvider[],
): ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  const seen = new Set<string>();

  // 1. Web (Browser Session) — first, if any provider is logged in
  const webModels = getAvailableWebModels(webProviders);
  if (webModels.length > 0) {
    groups.push({
      provider: 'web',
      label: 'webProviders.selector.groupLabel',  // resolved by Component via t()
      models: webModels as unknown as Model<Api>[],
    });
    seen.add('web');
  }

  // 2. Custom providers: shown regardless of API key config (issue #3 fix)
  for (const config of customProviders) {
    const providerKey = customProviderKey(config.id);
    const models = getCustomModels(config);
    if (models.length > 0) {
      groups.push({ provider: providerKey, label: config.name, models });
      seen.add(providerKey);
    }
  }

  // 3. Built-in pi-ai providers: gated by verified credentials
  for (const [provider, cred] of Object.entries(configuredProviders)) {
    if (!cred.verified) continue;
    if (isCustomProvider(provider)) continue;
    if (seen.has(provider)) continue;
    try {
      const models = getModels(provider as KnownProvider) as Model<Api>[];
      if (models.length > 0) {
        groups.push({ provider, label: provider, models });
      }
    } catch {
      // Unknown provider, skip
    }
  }

  return groups;
}

// Re-export for backward compat with ModelSelector
export type { ActiveModel };
