import { ExternalLink, LogIn, LogOut, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { WebProviderPreset, resolveEffectiveConfig as ResolveEffectiveConfigType } from '@/lib/ai-config/web-provider-presets';
import type { WebProvider, WebProviderUserOverrides } from '@/lib/types';
import { resolveEffectiveConfig } from '@/lib/ai-config/web-provider-presets';
import { t } from '@/lib/i18n';

export interface WebProviderCardProps {
  provider: WebProvider;
  preset: WebProviderPreset;
  isChecking: boolean;

  /**
   * 2026-06-08: Enabled toggle was temporarily removed, then re-added
   * on user request. The toggle hides the provider from the model
   * selector without unlogging.
   */
  onEnabledChange: (enabled: boolean) => void;
  onModelIdChange: (modelId: string) => void;
  /**
   * 2026-06-08: 'supportsReasoning' is no longer exposed in the UI
   * (GLM doesn't surface reasoning to the user). The prop is still
   * accepted for forward-compat with future providers that DO expose
   * reasoning; the implementation is now no-op for glm.
   */
  onCapabilityChange: (
    capability: 'supportsToolCalls' | 'supportsReasoning',
    value: boolean,
  ) => void;
  /**
   * Kept for SubSection wiring compat. Login button already re-verifies
   * the session, so this is unused in the UI.
   */
  onRecheck: () => void;

  /** ⭐ ②: Login callback for the new "Login" button (opens tab + polls). */
  onLogin?: () => void;

  /** ⭐ ⑤.3: Logout callback — parent should clear the bundle + set loggedOut. */
  onLogout?: () => void;

  /** ⭐ ②: whether the login flow is currently running. */
  isLoginLoading?: boolean;

  /** ⭐ ② A1: last capture metadata for transparency display. */
  lastCaptureInfo?: {
    cookieNames: string[];
    capturedAt: string;
  } | null;

  /** ⭐ ② A2: precomputed effective config (preset merged with user overrides). */
  effectiveConfig?: ReturnType<typeof ResolveEffectiveConfigType>;

  /** ⭐ ② A2: update a single user override field. */
  onUserOverrideChange?: (
    field: keyof WebProviderUserOverrides,
    value: string | string[] | boolean | undefined,
  ) => void;

  /** ⭐ ② A2: clear all overrides and revert to preset defaults. */
  onResetOverrides?: () => void;
}

/**
 * 2026-06-08: Redesigned to align with cebian's neutral compact style
 * (see `components/settings/provider/ProviderOAuthItem.tsx`):
 *   - Removed controls that have no useful effect: Enabled toggle
 *     (only 1 built-in provider, login/logout already gates model
 *     selector visibility), Reasoning toggle (GLM doesn't expose
 *     reasoning to users), Recheck button (Login already verifies
 *     session as part of its flow).
 *   - Layout: header row with status badge + actions, then compact
 *     rows for Model ID / Capabilities / last-attempt footer. Matches
 *     the `space-y-2` + `flex items-center justify-between` pattern
 *     used by ProviderOAuthItem.
 *   - Buttons use lucide icons (LogIn/LogOut/ExternalLink/RotateCw)
 *     sized at 3.5 to match cebian's icon button convention.
 *   - All visible strings route through t() — Chinese is now the
 *     primary language, English is the fallback.
 */
export function WebProviderCard({
  provider,
  preset,
  // Kept for SubSection wiring compat but currently unused in the UI:
  onEnabledChange,
  onModelIdChange,
  onCapabilityChange,
  onRecheck,
  onLogin,
  onLogout,
  isLoginLoading = false,
  lastCaptureInfo = null,
  effectiveConfig: providedEffectiveConfig,
  onUserOverrideChange,
  onResetOverrides,
}: WebProviderCardProps) {
  // A2: compute effective config if not provided (for tests that don't pass it)
  const effective = providedEffectiveConfig ?? resolveEffectiveConfig(provider, preset);

  // Suppress unused-param lint without breaking the contract.
  void onEnabledChange;
  void onRecheck;

  const isLoggedIn = provider.loginStatus === 'loggedIn';
  const isLoggedOut = provider.loginStatus === 'loggedOut';
  const isUnknown = provider.loginStatus === 'unknown';

  // A4: most recent audit entry
  const latestAudit = provider.loginAuditLog[0];

  return (
    <div
      data-testid={`web-provider-card-${provider.presetId}`}
      className="space-y-2"
    >
      {/* Header row: status badge + name + description / actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium" data-testid="provider-name">
              {/* preset.displayNameKey is dynamic per-preset, so the WXT
                  i18n literal-type doesn't accept it. Cast is required. */}
              {t(preset.displayNameKey as any)}
            </p>
            {isLoggedIn && (
              <Badge
                variant="outline"
                className="text-success border-success/20 bg-success/5 text-[0.65rem] h-4 px-1.5"
                data-testid="status-logged-in"
              >
                {t('webProviders.status.loggedIn')}
              </Badge>
            )}
            {isLoggedOut && (
              <Badge
                variant="outline"
                className="text-muted-foreground border-border text-[0.65rem] h-4 px-1.5"
                data-testid="status-logged-out"
              >
                {t('webProviders.status.loggedOut')}
              </Badge>
            )}
            {isUnknown && (
              <Badge
                variant="outline"
                className="text-muted-foreground border-border text-[0.65rem] h-4 px-1.5"
                data-testid="status-unknown"
              >
                {t('webProviders.status.neverChecked')}
              </Badge>
            )}
          </div>
          {preset.descriptionKey ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(preset.descriptionKey as any)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 2026-06-08: re-added Enabled toggle (kept on user request).
              Renamed from "Enabled" to "启用" to match cebian's zh-CN
              convention. The toggle hides the provider from the model
              selector without unlogging — useful when you have the
              session but don't want this model selectable right now. */}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Switch
              checked={provider.enabled}
              onCheckedChange={onEnabledChange}
              aria-label={t('webProviders.fields.enabled')}
            />
            <span className="text-xs text-muted-foreground">
              {t('webProviders.fields.enabled')}
            </span>
          </label>
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-7 w-7"
            aria-label={t('webProviders.fields.openWebsite')}
          >
            <a href={preset.loginUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
          {isLoggedIn ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onLogout}
              data-testid="logout-button"
            >
              <LogOut className="size-3.5" />
              {t('webProviders.fields.logout')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onLogin}
              disabled={isLoginLoading}
              data-testid="login-button"
            >
              {isLoginLoading ? (
                <RotateCw className="size-3.5 animate-spin" />
              ) : (
                <LogIn className="size-3.5" />
              )}
              {isLoginLoading
                ? t('webProviders.fields.loggingIn')
                : t('webProviders.fields.login')}
            </Button>
          )}
        </div>
      </div>

      {/* Model selector row with reset (only show reset when user has overridden) */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label
            htmlFor={`model-${provider.presetId}`}
            className="text-xs font-medium"
          >
            {t('webProviders.fields.modelIdLabel')}
          </label>
          {provider.modelId !== preset.defaultModelId && onResetOverrides && (
            <button
              type="button"
              onClick={onResetOverrides}
              className="text-xs text-muted-foreground hover:text-foreground"
              data-testid="reset-model-button"
            >
              {t('webProviders.fields.resetOverrides')}
            </button>
          )}
        </div>
        <select
          id={`model-${provider.presetId}`}
          value={provider.modelId}
          onChange={(e) => onModelIdChange(e.target.value)}
          className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`model-select-${provider.presetId}`}
        >
          {preset.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Capabilities row — Tool calls only (Reasoning removed 2026-06-08) */}
      <div className="flex items-center gap-6">
        <span className="text-xs font-medium">
          {t('webProviders.fields.capabilities')}
        </span>
        <label className="flex items-center gap-2">
          <Switch
            checked={provider.supportsToolCalls}
            onCheckedChange={(v) => onCapabilityChange('supportsToolCalls', v)}
            aria-label={t('webProviders.fields.toolCalls')}
          />
          <span className="text-sm">{t('webProviders.fields.toolCalls')}</span>
        </label>
      </div>

      {/* Footer: last attempt + captured (A1) — muted, single line each */}
      {(latestAudit || lastCaptureInfo) && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground pt-1">
          {latestAudit && (
            <p data-testid="audit-info" className="flex items-center gap-1.5">
              <span>{t('webProviders.fields.lastAttempt')}:</span>
              <span>{new Date(latestAudit.timestamp).toLocaleString()}</span>
              <Badge
                variant={latestAudit.result === 'success' ? 'outline' : 'destructive'}
                className="text-[0.65rem] h-4 px-1.5"
              >
                {latestAudit.result}
              </Badge>
            </p>
          )}
          {lastCaptureInfo && lastCaptureInfo.cookieNames.length > 0 && (
            <p data-testid="capture-info">
              {t('webProviders.fields.captured', [
                String(lastCaptureInfo.cookieNames.length),
              ])}
              : {lastCaptureInfo.cookieNames.slice(0, 3).join(', ')}
              {lastCaptureInfo.cookieNames.length > 3
                ? `, +${lastCaptureInfo.cookieNames.length - 3} more`
                : ''}
            </p>
          )}
        </div>
      )}

      {/* A2: Advanced collapsible — per-provider config overrides */}
      {onUserOverrideChange && (
        <details className="text-sm pt-1" data-testid="advanced-section">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground text-xs">
            {t('webProviders.fields.advancedTitle')}
          </summary>
          <div className="mt-2 space-y-2 pl-3 border-l-2 border-border">
            <FieldRow label="Cookie domain" source={effective.source.cookieDomain}>
              <Input
                value={effective.cookieDomain}
                onChange={(e) => onUserOverrideChange('cookieDomain', e.target.value)}
                className="h-8 text-sm"
              />
            </FieldRow>
            <FieldRow
              label="Session indicators (comma-separated)"
              source={effective.source.sessionIndicators}
            >
              <Input
                value={effective.sessionIndicators.join(',')}
                onChange={(e) =>
                  onUserOverrideChange(
                    'sessionIndicators',
                    e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
                className="h-8 text-sm"
              />
            </FieldRow>
            {/* 2026-06-08: removed "Use localStorage fallback" — was for
                providers that store tokens in localStorage (Kimi, DeepSeek).
                Both are removed. GLM uses cookies exclusively. Leaving
                the toggle would just confuse the user. */}
            <FieldRow label="Refresh URL (GLM only)" source={effective.source.refreshUrl}>
              <Input
                value={effective.refreshUrl ?? ''}
                onChange={(e) =>
                  onUserOverrideChange('refreshUrl', e.target.value || undefined)
                }
                className="h-8 text-sm"
              />
            </FieldRow>
            {onResetOverrides && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onResetOverrides}
                data-testid="reset-overrides-button"
              >
                {t('webProviders.fields.resetOverrides')}
              </Button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function FieldRow({
  label,
  source,
  children,
}: {
  label: string;
  source: 'preset' | 'user';
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{label}</span>
        {source === 'user' && (
          <Badge variant="secondary" className="text-xs">
            user override
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}
