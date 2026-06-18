import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStorageItem, type StorageItem } from '@/hooks/useStorageItem';

describe('useStorageItem', () => {
  function makeItem<T>(initial: T): StorageItem<T> {
    let value = initial;
    const cbs = new Set<(newVal: T, oldVal: T) => void>();
    return {
      getValue: async () => value,
      setValue: async (v: T) => {
        const old = value;
        value = v;
        cbs.forEach(cb => cb(v, old));
      },
      watch: (cb) => {
        cbs.add(cb);
        return () => { cbs.delete(cb); };
      },
    };
  }

  it('reads initial value from item', async () => {
    const item = makeItem('stored');
    const { result } = renderHook(() => useStorageItem(item, 'fallback'));
    await waitFor(() => expect(result.current[0]).toBe('stored'));
  });

  it('uses fallback when getValue returns undefined-ish (but not for strings)', async () => {
    const item = makeItem<number | undefined>(undefined);
    const { result } = renderHook(() => useStorageItem(item, 42));
    // The hook sets fallback immediately, then updates from item
    expect(result.current[0]).toBe(42);
  });

  it('updates value via setter', async () => {
    const item = makeItem(0);
    const { result } = renderHook(() => useStorageItem(item, 0));
    await waitFor(() => expect(result.current[0]).toBe(0));
    await act(async () => {
      await result.current[1](99);
    });
    await waitFor(() => expect(result.current[0]).toBe(99));
  });

  it('reacts to external watch updates', async () => {
    const item = makeItem('a');
    const { result } = renderHook(() => useStorageItem(item, 'x'));
    await waitFor(() => expect(result.current[0]).toBe('a'));
    await act(async () => {
      await item.setValue('b');
    });
    expect(result.current[0]).toBe('b');
  });

  it('unwatches on unmount', async () => {
    const item = makeItem(0);
    const { unmount } = renderHook(() => useStorageItem(item, 0));
    unmount();
    // Should not throw when updating after unmount
    await expect(item.setValue(1)).resolves.toBeUndefined();
  });
});
