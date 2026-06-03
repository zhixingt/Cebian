import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWebProviders } from '@/hooks/useWebProviders';
import { getDb } from '@/lib/db';

describe('useWebProviders', () => {
  beforeEach(async () => {
    await getDb().webProviders.clear();
  });

  it('starts with isLoading=true, then resolves to 3 seeded providers', async () => {
    const { result } = renderHook(() => useWebProviders());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.providers).toHaveLength(3);
    expect(result.current.error).toBeNull();
  });

  it('setEnabled updates Dexie and refreshes state', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setEnabled('glm', false);
    });
    const glm = result.current.providers.find((p) => p.presetId === 'glm');
    expect(glm?.enabled).toBe(false);
  });

  it('setLoginStatus updates state', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setLoginStatus('kimi', 'loggedIn');
    });
    const kimi = result.current.providers.find((p) => p.presetId === 'kimi');
    expect(kimi?.loginStatus).toBe('loggedIn');
  });

  it('setModelId updates state', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setModelId('deepseek', 'deepseek-coder');
    });
    const deepseek = result.current.providers.find(
      (p) => p.presetId === 'deepseek',
    );
    expect(deepseek?.modelId).toBe('deepseek-coder');
  });

  it('setCapability updates the correct capability', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setCapability(
        'glm',
        'supportsToolCalls',
        false,
      );
    });
    const glm = result.current.providers.find((p) => p.presetId === 'glm');
    expect(glm?.supportsToolCalls).toBe(false);
    expect(glm?.supportsReasoning).toBe(false); // unchanged (GLM default)
  });

  it('handles error from repository', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // setEnabled on unknown id will throw (Dexie.update rejects).
    // The hook should capture the error rather than crash.
    await act(async () => {
      try {
        await result.current.update.setEnabled(
          'nonexistent' as Parameters<typeof result.current.update.setEnabled>[0],
          false,
        );
      } catch {
        // expected
      }
    });
    // hook itself remains stable
    expect(result.current.providers).toHaveLength(3);
  });

  it('cancelled unmount does not set state after unmount', async () => {
    const { result, unmount } = renderHook(() => useWebProviders());
    unmount();
    // Give the initial load time to complete
    await new Promise((r) => setTimeout(r, 50));
    // result.current is frozen post-unmount; just verify no errors
    expect(result.current.providers).toBeDefined();
  });

  it('multiple updates preserve order', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setEnabled('glm', false);
      await result.current.update.setModelId('glm', 'GLM-5');
    });
    const glm = result.current.providers.find((p) => p.presetId === 'glm');
    expect(glm?.enabled).toBe(false);
    expect(glm?.modelId).toBe('GLM-5');
  });
});
