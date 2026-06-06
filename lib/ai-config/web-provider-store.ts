import type { WebProvider, LoginStatus, LoginAuditEntry, WebProviderUserOverrides } from '../types';
import { getDb } from '../db';
import { WEB_PROVIDER_PRESETS } from './web-provider-presets';

/** Inferred type of the Dexie database instance. */
type CebianDB = ReturnType<typeof getDb>;

const MAX_AUDIT_LOG_ENTRIES = 5;

export class WebProviderRepository {
  constructor(private db: CebianDB) {}

  async list(): Promise<WebProvider[]> {
    // ② startup cleanup: delete rows whose presetId is no longer registered.
    // This handles the case where a user previously logged in to a provider
    // that was later removed from WEB_PROVIDER_PRESETS (e.g. Kimi / DeepSeek
    // removal in 2026-06). Without this, the stale row would survive
    // indefinitely and any caller that doesn't defensively filter would
    // throw on resolveWebModel (e.g. agent-manager.resolveModelObj).
    const all = await this.db.webProviders.toArray();
    const validIds = new Set(WEB_PROVIDER_PRESETS.map((p) => p.id));
    const staleIds = all
      .map((p) => p.presetId)
      .filter((id) => !validIds.has(id));
    if (staleIds.length > 0) {
      console.warn('[web-provider-stale-cleanup] deleting rows for removed presets', {
        deletedPresetIds: staleIds,
      });
      await this.db.webProviders.bulkDelete(staleIds);
    }

    // Continue with the original seed-if-missing logic.
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

  // ===== ② additions: encrypted bundle + A2 overrides + A4 audit =====

  /**
   * Store the encrypted cookie bundle. Overwrites any previous value.
   * Used after successful login.
   */
  async setEncryptedCookieBundle(
    presetId: WebProvider['presetId'],
    ciphertext: string,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      encryptedCookieBundle: ciphertext,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Clear the encrypted cookie bundle (e.g. user logged out or session invalidated).
   * Does NOT change loginStatus; caller decides whether to set loggedOut.
   */
  async clearEncryptedCookieBundle(
    presetId: WebProvider['presetId'],
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      encryptedCookieBundle: null,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Persist per-provider user overrides (A2 KEY ONE).
   * Pass null to clear all overrides (reset to preset defaults).
   */
  async setUserOverrides(
    presetId: WebProvider['presetId'],
    overrides: WebProviderUserOverrides | null,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      userOverrides: overrides,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Append an entry to the login audit log (A4).
   * Newest entry at index 0; FIFO eviction at MAX_AUDIT_LOG_ENTRIES.
   */
  async appendAuditEntry(
    presetId: WebProvider['presetId'],
    entry: LoginAuditEntry,
  ): Promise<void> {
    const existing = await this.db.webProviders.get(presetId);
    const log = existing?.loginAuditLog ?? [];
    log.unshift(entry);
    while (log.length > MAX_AUDIT_LOG_ENTRIES) log.pop();
    await this.db.webProviders.update(presetId, {
      loginAuditLog: log,
      updatedAt: new Date().toISOString(),
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
