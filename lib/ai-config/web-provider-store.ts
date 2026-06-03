import type { WebProvider, LoginStatus } from '../types';
import { getDb } from '../db';
import { WEB_PROVIDER_PRESETS } from './web-provider-presets';

/** Inferred type of the Dexie database instance. */
type CebianDB = ReturnType<typeof getDb>;

export class WebProviderRepository {
  constructor(private db: CebianDB) {}

  async list(): Promise<WebProvider[]> {
    const existing = await this.db.webProviders.toArray();
    const existingIds = new Set(existing.map((p) => p.presetId));
    const missing = WEB_PROVIDER_PRESETS
      .filter((p) => !existingIds.has(p.id))
      .map((p) => this.createFromPreset(p));
    if (missing.length > 0) {
      await this.db.webProviders.bulkAdd(missing);
    }
    return this.db.webProviders.orderBy('updatedAt').reverse().toArray();
  }

  async get(presetId: WebProvider['presetId']): Promise<WebProvider | undefined> {
    return this.db.webProviders.get(presetId);
  }

  async setEnabled(presetId: WebProvider['presetId'], enabled: boolean): Promise<void> {
    await this.db.webProviders.update(presetId, {
      enabled,
      updatedAt: new Date().toISOString(),
    });
  }

  async setLoginStatus(
    presetId: WebProvider['presetId'],
    status: Exclude<LoginStatus, 'checking'>,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      loginStatus: status,
      lastCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async setModelId(presetId: WebProvider['presetId'], modelId: string): Promise<void> {
    await this.db.webProviders.update(presetId, {
      modelId,
      updatedAt: new Date().toISOString(),
    });
  }

  async setCapability(
    presetId: WebProvider['presetId'],
    capability: 'supportsToolCalls' | 'supportsReasoning',
    value: boolean,
  ): Promise<void> {
    // Use Dexie's function form to avoid TS issues with computed-key updates
    // colliding with UpdateSpec<InsertType<WebProvider>> array element index types.
    await this.db.webProviders.update(presetId, (provider) => {
      if (capability === 'supportsToolCalls') provider.supportsToolCalls = value;
      else provider.supportsReasoning = value;
      provider.updatedAt = new Date().toISOString();
      return true;
    });
  }

  private createFromPreset(preset: typeof WEB_PROVIDER_PRESETS[number]): WebProvider {
    const now = new Date().toISOString();
    return {
      presetId: preset.id,
      enabled: true,
      loginStatus: 'unknown',
      modelId: preset.defaultModelId,
      supportsToolCalls: preset.defaultSupportsToolCalls,
      supportsReasoning: preset.defaultSupportsReasoning,
      lastCheckedAt: null,
      encryptedCookieBundle: null,
      userOverrides: null,        // ⭐ ② A2: no user overrides initially
      loginAuditLog: [],          // ⭐ ② A4: empty audit log initially
      createdAt: now,
      updatedAt: now,
    };
  }
}

let _instance: WebProviderRepository | null = null;
export function getWebProviderRepository(): WebProviderRepository {
  if (!_instance) {
    _instance = new WebProviderRepository(getDb());
  }
  return _instance;
}
