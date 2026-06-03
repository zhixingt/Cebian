import { useCallback, useEffect, useState } from 'react';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import type { LoginStatus, WebProvider } from '@/lib/types';

export interface UseWebProvidersResult {
  providers: WebProvider[];
  isLoading: boolean;
  error: Error | null;
  update: {
    setEnabled: (
      id: WebProvider['presetId'],
      enabled: boolean,
    ) => Promise<void>;
    setLoginStatus: (
      id: WebProvider['presetId'],
      status: Exclude<LoginStatus, 'checking'>,
    ) => Promise<void>;
    setModelId: (
      id: WebProvider['presetId'],
      modelId: string,
    ) => Promise<void>;
    setCapability: (
      id: WebProvider['presetId'],
      cap: 'supportsToolCalls' | 'supportsReasoning',
      value: boolean,
    ) => Promise<void>;
  };
}

/**
 * CRUD + persistence hook for the Web (Browser Session) provider config.
 *
 * Write-then-refresh pattern: every update method calls the repository,
 * then re-fetches the full list. The UI always renders from a single
 * source of truth. The 'cancelled' flag prevents setState after unmount.
 */
export function useWebProviders(): UseWebProvidersResult {
  const [providers, setProviders] = useState<WebProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const repo = getWebProviderRepository();

  const refresh = useCallback(async () => {
    try {
      const list = await repo.list();
      setProviders(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [repo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      await refresh();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const setEnabled = useCallback(
    async (id: WebProvider['presetId'], enabled: boolean) => {
      try {
        await repo.setEnabled(id, enabled);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [repo, refresh],
  );

  const setLoginStatus = useCallback(
    async (
      id: WebProvider['presetId'],
      status: Exclude<LoginStatus, 'checking'>,
    ) => {
      try {
        await repo.setLoginStatus(id, status);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [repo, refresh],
  );

  const setModelId = useCallback(
    async (id: WebProvider['presetId'], modelId: string) => {
      try {
        await repo.setModelId(id, modelId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [repo, refresh],
  );

  const setCapability = useCallback(
    async (
      id: WebProvider['presetId'],
      cap: 'supportsToolCalls' | 'supportsReasoning',
      value: boolean,
    ) => {
      try {
        await repo.setCapability(id, cap, value);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [repo, refresh],
  );

  return {
    providers,
    isLoading,
    error,
    update: { setEnabled, setLoginStatus, setModelId, setCapability },
  };
}
