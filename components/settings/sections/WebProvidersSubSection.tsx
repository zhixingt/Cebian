import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useWebProviders } from '@/hooks/useWebProviders';
import { useWebProviderWebLogin, type LastCaptureInfo } from '@/hooks/useWebProviderWebLogin';
import {
  WEB_PROVIDER_PRESETS,
  resolveEffectiveConfig,
} from '@/lib/ai-config/web-provider-presets';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import { invalidateBundle } from '@/lib/ai-config/web-provider-bundle';
import type { WebProvider, WebProviderUserOverrides } from '@/lib/types';
import { t } from '@/lib/i18n';
import { WebProviderCard } from '../provider/WebProviderCard';
import { EmptyWebProvidersState } from '../provider/EmptyWebProvidersState';

/**
 * Container that wires the two hooks to a list of WebProviderCard.
 * No local state of its own (except A1 capture cache), the two hooks own all behavior.
 *
 * ② updates:
 *   - useWebProviderSimulatedLogin replaced with useWebProviderWebLogin
 *   - Pass Login button + A1 transparency + A2 Advanced + A4 audit to card
 *   - setUserOverrides wired through useWebProviders (A2)
 *   - Per-provider captureInfo cache (A1: persists past checkingId=null)
 */
export function WebProvidersSubSection() {
  const { providers, update, isLoading, error } = useWebProviders();
  const {
    login,
    recheck,
    checkingId,
    loginLoading,
  } = useWebProviderWebLogin({
    onSuccess: (id) => update.setLoginStatus(id, 'loggedIn'),
    onFailure: (id, err) => {
      void update.setLoginStatus(id, 'loggedOut');
      toast.error(t('webProviders.messages.recheckFailed'), {
        description: err,
      });
    },
    // A1: per-provider cache of the most recent successful capture.
    onCapture: (id, info) => {
      setCaptureByProvider(prev => ({ ...prev, [id]: info }));
    },
  });

  // A1: per-provider cache of the most recent successful capture.
  // Persists past the checkingId window so users can verify what was captured
  // even after the tab auto-closes. Keyed by presetId.
  const [captureByProvider, setCaptureByProvider] = useState<
    Partial<Record<WebProvider['presetId'], LastCaptureInfo>>
  >({});

  const onLogin = useCallback(
    (id: WebProvider['presetId']) => {
      // Optimistically clear the old capture for this provider before starting
      // a new login; the new capture will replace it on success.
      setCaptureByProvider(prev => ({ ...prev, [id]: undefined }));
      void login(id);
    },
    [login],
  );

  // ⑤.3: clear stored cookies + set loggedOut + invalidate bundle cache.
  // Direct repo call (not via the hook) because the hook only exposes the
  // common setters; clearEncryptedCookieBundle is a ⑤ addition. Invalidate
  // the bundle cache so the next chat attempt re-reads from DB and sees
  // loginStatus=loggedOut (not the stale decrypted cookies).
  const onLogout = useCallback(
    async (id: WebProvider['presetId']) => {
      try {
        const repo = getWebProviderRepository();
        await repo.clearEncryptedCookieBundle(id);
        await update.setLoginStatus(id, 'loggedOut');
        invalidateBundle(id);
        // Clear the A1 capture display for this provider.
        setCaptureByProvider(prev => ({ ...prev, [id]: undefined }));
        toast.success(t('webProviders.messages.logoutSuccess'));
      } catch (err) {
        console.warn('[web-providers] logout failed:', err);
        toast.error(t('webProviders.messages.logoutFailed'));
      }
    },
    [update],
  );

  // Re-check should NOT clear capture — it just verifies the stored bundle.
  // Capture info shown is the most recent successful login.

  if (error) {
    return (
      <EmptyWebProvidersState message={t('webProviders.messages.loadFailed')} />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-lg font-semibold">
          {t('webProviders.sectionTitle')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('webProviders.sectionDescription')}
        </p>
      </header>

      <div className="space-y-3">
        {providers.map((provider) => {
          const preset = WEB_PROVIDER_PRESETS.find(
            (p) => p.id === provider.presetId,
          );
          if (!preset) return null;

          return (
            <WebProviderCard
              key={provider.presetId}
              provider={provider}
              preset={preset}
              isChecking={checkingId === provider.presetId}
              onEnabledChange={(v) => update.setEnabled(provider.presetId, v)}
              onModelIdChange={(v) => update.setModelId(provider.presetId, v)}
              onCapabilityChange={(cap, v) =>
                update.setCapability(provider.presetId, cap, v)
              }
              onRecheck={() => recheck(provider.presetId)}
              onLogin={() => onLogin(provider.presetId)}
              onLogout={() => { void onLogout(provider.presetId); }}
              isLoginLoading={loginLoading && checkingId === provider.presetId}
              lastCaptureInfo={captureByProvider[provider.presetId] ?? null}
              effectiveConfig={resolveEffectiveConfig(provider, preset)}
              onUserOverrideChange={(
                field: keyof WebProviderUserOverrides,
                value: string | string[] | boolean | undefined,
              ) => {
                const current = provider.userOverrides ?? {};
                const next: WebProviderUserOverrides =
                  value === undefined ? { ...current } : { ...current, [field]: value };
                // Strip undefined / empty-string values
                const cleaned = Object.fromEntries(
                  Object.entries(next).filter(
                    ([, v]) => v !== undefined && v !== '',
                  ),
                ) as WebProviderUserOverrides;
                const hasAny = Object.keys(cleaned).length > 0;
                void update.setUserOverrides(provider.presetId, hasAny ? cleaned : null);
              }}
              onResetOverrides={() =>
                update.setUserOverrides(provider.presetId, null)
              }
            />
          );
        })}
      </div>
    </div>
  );
}
