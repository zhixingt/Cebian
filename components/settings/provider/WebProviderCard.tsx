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
  onEnabledChange: (enabled: boolean) => void;
  onModelIdChange: (modelId: string) => void;
  onCapabilityChange: (
    capability: 'supportsToolCalls' | 'supportsReasoning',
    value: boolean,
  ) => void;
  onRecheck: () => void;

  /** ⭐ ②: Login callback for the new "Login" button (opens tab + polls). */
  onLogin?: () => void;

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

export function WebProviderCard({
  provider,
  preset,
  isChecking,
  onEnabledChange,
  onModelIdChange,
  onCapabilityChange,
  onRecheck,
  onLogin,
  isLoginLoading = false,
  lastCaptureInfo = null,
  effectiveConfig: providedEffectiveConfig,
  onUserOverrideChange,
  onResetOverrides,
}: WebProviderCardProps) {
  // A2: compute effective config if not provided (for tests that don't pass it)
  const effective = providedEffectiveConfig ?? resolveEffectiveConfig(provider, preset);

  // A1: parse capturedAt as relative time (use Intl.RelativeTimeFormat if available)
  const captureTimeText = lastCaptureInfo
    ? new Date(lastCaptureInfo.capturedAt).toLocaleString()
    : null;

  // A4: most recent audit entry
  const latestAudit = provider.loginAuditLog[0];

  return (
    <div
      data-testid={`web-provider-card-${provider.presetId}`}
      className="rounded-lg border p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {provider.loginStatus === 'loggedIn' && (
            <Badge variant="default" data-testid="status-logged-in">
              Logged in
            </Badge>
          )}
          {provider.loginStatus === 'loggedOut' && (
            <Badge variant="destructive" data-testid="status-logged-out">
              Not logged in
            </Badge>
          )}
          {provider.loginStatus === 'unknown' && (
            <Badge variant="secondary" data-testid="status-unknown">
              Never checked
            </Badge>
          )}
          <span className="font-semibold">
            {preset.id.toUpperCase()} — {preset.loginUrl}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Enabled</span>
          <Switch
            checked={provider.enabled}
            onCheckedChange={onEnabledChange}
            aria-label={`Enable ${preset.id}`}
          />
          <Button variant="link" asChild>
            <a href={preset.loginUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          </Button>
        </div>
      </div>

      <div>
        <label htmlFor={`model-${provider.presetId}`} className="text-sm">
          Model ID
        </label>
        <Input
          id={`model-${provider.presetId}`}
          value={provider.modelId}
          onChange={(e) => onModelIdChange(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-6">
        <span className="text-sm">Capabilities:</span>
        <label className="flex items-center gap-2">
          <Switch
            checked={provider.supportsToolCalls}
            onCheckedChange={(v) => onCapabilityChange('supportsToolCalls', v)}
            aria-label="Tool calls"
          />
          <span>Tool calls</span>
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={provider.supportsReasoning}
            onCheckedChange={(v) => onCapabilityChange('supportsReasoning', v)}
            aria-label="Reasoning"
          />
          <span>Reasoning</span>
        </label>
      </div>

      <div className="flex items-center gap-2">
        {onLogin && (
          <Button
            variant="default"
            size="sm"
            onClick={onLogin}
            disabled={isLoginLoading}
            data-testid="login-button"
          >
            {isLoginLoading ? 'Logging in…' : 'Login'}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onRecheck}
          disabled={isChecking}
          data-testid="recheck-button"
        >
          {isChecking ? 'Checking…' : 'Re-check login status'}
        </Button>
      </div>

      {/* A1: Transparency — show what was captured */}
      {lastCaptureInfo && lastCaptureInfo.cookieNames.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="capture-info">
          Captured {lastCaptureInfo.cookieNames.length} cookie(s):{' '}
          {lastCaptureInfo.cookieNames.slice(0, 3).join(', ')}
          {lastCaptureInfo.cookieNames.length > 3
            ? `, +${lastCaptureInfo.cookieNames.length - 3} more`
            : ''}
          {captureTimeText && ` (${captureTimeText})`}
        </p>
      )}

      {/* A4: Audit log — most recent attempt */}
      {latestAudit && (
        <p className="text-xs text-muted-foreground" data-testid="audit-info">
          Last attempt: {new Date(latestAudit.timestamp).toLocaleString()} —{' '}
          <Badge
            variant={latestAudit.result === 'success' ? 'default' : 'destructive'}
          >
            {latestAudit.result}
          </Badge>
        </p>
      )}

      {/* A2: Advanced collapsible — per-provider config overrides */}
      {onUserOverrideChange && (
        <details className="text-sm" data-testid="advanced-section">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Advanced: session detection config
          </summary>
          <div className="mt-2 space-y-2 pl-4">
            <FieldRow label="Cookie domain" source={effective.source.cookieDomain}>
              <Input
                value={effective.cookieDomain}
                onChange={(e) => onUserOverrideChange('cookieDomain', e.target.value)}
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
              />
            </FieldRow>
            <FieldRow
              label="Use localStorage fallback"
              source={effective.source.useLocalStorageFallback}
            >
              <Switch
                checked={effective.useLocalStorageFallback}
                onCheckedChange={(v) =>
                  onUserOverrideChange('useLocalStorageFallback', v)
                }
              />
            </FieldRow>
            <FieldRow label="Refresh URL (GLM only)" source={effective.source.refreshUrl}>
              <Input
                value={effective.refreshUrl ?? ''}
                onChange={(e) =>
                  onUserOverrideChange('refreshUrl', e.target.value || undefined)
                }
              />
            </FieldRow>
            {onResetOverrides && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onResetOverrides}
                data-testid="reset-overrides-button"
              >
                Reset to preset default
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
