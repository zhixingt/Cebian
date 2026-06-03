import { toast } from 'sonner';

import { useWebProviders } from '@/hooks/useWebProviders';
import { useWebProviderWebLogin } from '@/hooks/useWebProviderWebLogin';
import {
  WEB_PROVIDER_PRESETS,
  resolveEffectiveConfig,
} from '@/lib/ai-config/web-provider-presets';
import type { WebProviderUserOverrides } from '@/lib/types';
import { t } from '@/lib/i18n';
import { WebProviderCard } from '../provider/WebProviderCard';
import { EmptyWebProvidersState } from '../provider/EmptyWebProvidersState';

/**
 * Container that wires the two hooks to a list of WebProviderCard.
 * No local state of its own; the two hooks own all behavior.
 *
 * ② updates:
 *   - useWebProviderSimulatedLogin replaced with useWebProviderWebLogin
 *   - Pass Login button + A1 transparency + A2 Advanced + A4 audit to card
 *   - setUserOverrides wired through useWebProviders (A2)
 */
export function WebProvidersSubSection() {
  const { providers, update, isLoading, error } = useWebProviders();
  const {
    login,
    recheck,
    checkingId,
    loginLoading,
    lastCaptureInfo,
  } = useWebProviderWebLogin({
    onSuccess: (id) => update.setLoginStatus(id, 'loggedIn'),
    onFailure: (id, err) => {
      void update.setLoginStatus(id, 'loggedOut');
      toast.error(t('webProviders.messages.recheckFailed'), {
        description: err,
      });
    },
  });

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
              onLogin={() => login(provider.presetId)}
              isLoginLoading={loginLoading && checkingId === provider.presetId}
              lastCaptureInfo={
                lastCaptureInfo && checkingId === provider.presetId
                  ? lastCaptureInfo
                  : null
              }
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
