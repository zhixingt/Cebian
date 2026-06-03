import { useCallback, useRef, useState } from 'react';
import type { WebProvider } from '@/lib/types';

export interface SimulatedLoginConfig {
  onSuccess: (id: WebProvider['presetId']) => void;
  onFailure: (id: WebProvider['presetId']) => void;
}

export interface SimulatedLoginResult {
  recheck: (id: WebProvider['presetId']) => void;
  checkingId: WebProvider['presetId'] | null;
}

/**
 * MVP mock for the "re-check login" flow.
 *   - 1-2 second random delay (looks like a real network call)
 *   - 70% probability of success → calls onSuccess
 *   - 30% probability of failure → calls onFailure
 *   - Only one provider can be "checking" at a time
 *
 * ② will replace this hook's internals with real chrome.cookies.getAll.
 * Callers are unaffected.
 */
export function useWebProviderSimulatedLogin(
  config: SimulatedLoginConfig,
): SimulatedLoginResult {
  const [checkingId, setCheckingId] = useState<WebProvider['presetId'] | null>(
    null,
  );
  const inFlightRef = useRef<WebProvider['presetId'] | null>(null);

  const recheck = useCallback(
    (id: WebProvider['presetId']) => {
      if (inFlightRef.current !== null) return;
      inFlightRef.current = id;
      setCheckingId(id);

      const delay = 1000 + Math.random() * 1000;
      setTimeout(() => {
        const success = Math.random() < 0.7;
        try {
          if (success) config.onSuccess(id);
          else config.onFailure(id);
        } finally {
          inFlightRef.current = null;
          setCheckingId(null);
        }
      }, delay);
    },
    [config],
  );

  return { recheck, checkingId };
}
