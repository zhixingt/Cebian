import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebProviderSimulatedLogin } from '@/hooks/useWebProviderSimulatedLogin';

describe('useWebProviderSimulatedLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with checkingId === null', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      }),
    );
    expect(result.current.checkingId).toBeNull();
  });

  it('recheck() sets checkingId', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      }),
    );
    act(() => result.current.recheck('glm'));
    expect(result.current.checkingId).toBe('glm');
  });

  it('only one recheck at a time is allowed', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      }),
    );
    act(() => result.current.recheck('glm'));
    act(() => result.current.recheck('kimi')); // ignored
    expect(result.current.checkingId).toBe('glm');
  });

  it('calls onSuccess after 1-2s when Math.random < 0.7', () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({ onSuccess, onFailure }),
    );
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5) // delay 1.5s
      .mockReturnValueOnce(0.3); // success (< 0.7)
    act(() => result.current.recheck('glm'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onSuccess).toHaveBeenCalledWith('glm');
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('calls onFailure after 1-2s when Math.random >= 0.7', () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({ onSuccess, onFailure }),
    );
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.9); // failure
    act(() => result.current.recheck('kimi'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onFailure).toHaveBeenCalledWith('kimi');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('resets checkingId to null after completion', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      }),
    );
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    act(() => result.current.recheck('deepseek'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.checkingId).toBeNull();
  });
});
