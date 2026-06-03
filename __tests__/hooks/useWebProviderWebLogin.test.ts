import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebProviderWebLogin } from '@/hooks/useWebProviderWebLogin';

// Mock chrome.runtime.sendMessage
let mockResponse: any = { success: true, status: 'loggedIn' };

beforeEach(() => {
  mockResponse = { success: true, status: 'loggedIn' };
  (global as any).chrome = {
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve(mockResponse)),
    },
  };
});

describe('useWebProviderWebLogin', () => {
  it('login sends WEB_PROVIDER_LOGIN message', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderWebLogin({ onSuccess, onFailure: vi.fn() }),
    );
    await act(async () => {
      await result.current.login('glm');
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'WEB_PROVIDER_LOGIN',
      presetId: 'glm',
    });
  });

  it('recheck sends WEB_PROVIDER_RECHECK message', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderWebLogin({ onSuccess, onFailure: vi.fn() }),
    );
    await act(async () => {
      await result.current.recheck('glm');
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'WEB_PROVIDER_RECHECK',
      presetId: 'glm',
    });
  });

  it('calls onSuccess on success response', async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderWebLogin({ onSuccess, onFailure }),
    );
    await act(async () => {
      await result.current.login('glm');
    });
    expect(onSuccess).toHaveBeenCalledWith('glm');
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('calls onFailure with error message on failure response', async () => {
    mockResponse = { success: false, error: 'Login timed out after 300s' };
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderWebLogin({ onSuccess, onFailure }),
    );
    await act(async () => {
      await result.current.login('glm');
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith('glm', 'Login timed out after 300s');
  });

  it('inFlight lock: only one login at a time, second call is ignored', async () => {
    // Make the first call pending (never resolves)
    let resolveFirst: (value: unknown) => void = () => {};
    (global as any).chrome.runtime.sendMessage = vi.fn(
      () => new Promise(r => { resolveFirst = r; }),
    );
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderWebLogin({ onSuccess, onFailure }),
    );

    // First login call (synchronously returns a pending Promise)
    act(() => {
      result.current.login('glm');
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

    // Second login call should be ignored (inFlight lock)
    act(() => {
      result.current.login('kimi');
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);  // still 1

    // Resolve the first one
    await act(async () => {
      resolveFirst({ success: true, status: 'loggedIn' });
      // wait for promise chain
      await new Promise(r => setTimeout(r, 10));
    });
    expect(onSuccess).toHaveBeenCalledWith('glm');
  });

  it('loginLoading toggles true → false across login flow', async () => {
    const { result } = renderHook(() =>
      useWebProviderWebLogin({ onSuccess: vi.fn(), onFailure: vi.fn() }),
    );
    expect(result.current.loginLoading).toBe(false);
    let resolveLogin: (value: unknown) => void = () => {};
    (global as any).chrome.runtime.sendMessage = vi.fn(
      () => new Promise(r => { resolveLogin = r; }),
    );

    act(() => {
      result.current.login('glm');
    });
    // After sync call, loading should be true
    expect(result.current.loginLoading).toBe(true);

    await act(async () => {
      resolveLogin({ success: true, status: 'loggedIn' });
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.current.loginLoading).toBe(false);
  });

  it('A1: lastCaptureInfo populated after successful login', async () => {
    mockResponse = {
      success: true,
      status: 'loggedIn',
      capturedCookieNames: ['chatglm_token', 'chatglm_refresh_token'],
      capturedTokenSources: ['cookie'],
    };
    const { result } = renderHook(() =>
      useWebProviderWebLogin({ onSuccess: vi.fn(), onFailure: vi.fn() }),
    );
    await act(async () => {
      await result.current.login('glm');
    });
    expect(result.current.lastCaptureInfo).toEqual({
      cookieNames: ['chatglm_token', 'chatglm_refresh_token'],
      tokenSources: ['cookie'],
      capturedAt: expect.any(String),
    });
  });

  it('never auto-checks on mount (status is not queried)', () => {
    const { result } = renderHook(() =>
      useWebProviderWebLogin({ onSuccess: vi.fn(), onFailure: vi.fn() }),
    );
    // chrome.runtime.sendMessage should NOT have been called
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(result.current.checkingId).toBeNull();
  });
});
