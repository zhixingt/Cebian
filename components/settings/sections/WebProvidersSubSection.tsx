import { useWebProviders } from '@/hooks/useWebProviders';
import { useWebProviderSimulatedLogin } from '@/hooks/useWebProviderSimulatedLogin';
import { WEB_PROVIDER_PRESETS } from '@/lib/ai-config/web-provider-presets';
import { t } from '@/lib/i18n';
import { WebProviderCard } from '../provider/WebProviderCard';
import { EmptyWebProvidersState } from '../provider/EmptyWebProvidersState';

/**
 * Container that wires the two hooks to a list of WebProviderCard.
 * No local state of its own; the two hooks own all behavior.
 */
export function WebProvidersSubSection() {
  const { providers, update, isLoading, error } = useWebProviders();
  const { recheck, checkingId } = useWebProviderSimulatedLogin({
    onSuccess: (id) => update.setLoginStatus(id, 'loggedIn'),
    onFailure: (id) => update.setLoginStatus(id, 'loggedOut'),
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
            />
          );
        })}
      </div>
    </div>
  );
}
