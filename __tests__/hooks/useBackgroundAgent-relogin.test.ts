import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBackgroundAgent, type AgentPortCallbacks } from '@/hooks/useBackgroundAgent';
import type { WebProvider } from '@/lib/types';

// Mock sonner toast so we don't actually toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  }),
}));

// Mock the recorder + mcp channels (the hook imports them)
vi.mock('@/lib/recorder/sidepanel-channel', () => ({
  recorderChannel: {
    setPort: vi.fn(),
    publishSession: vi.fn(),
    publishRejection: vi.fn(),
    publishStatus: vi.fn(),
  },
}));
vi.mock('@/lib/mcp/sidepanel-channel', () => ({
  mcpAppResourceChannel: { setPort: vi.fn(), handleResult: vi.fn() },
}));

let mockPort: any;
let chromeListeners: Array<(...args: any[]) => any> = [];

beforeEach(() => {
  mockPort = {
    name: 'cebian-agent',
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((cb: any) => { chromeListeners.push(cb); }),
    },
    onDisconnect: {
      addListener: vi.fn(),
    },
  };
  chromeListeners = [];
  (global as any).chrome = {
    runtime: {
      connect: vi.fn(() => mockPort),
      Port: class {},
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper: trigger the registered port.onMessage listener with a message.
 * Returns the captured listener (the first one registered).
 */
function deliverMessage(msg: unknown) {
  // The hook registers its own listener. Find it.
  // The hook also registers the re-login handler from web-provider-relogin.ts
  // (called once at module load), so we need to find the LAST listener.
  const listener = chromeListeners[chromeListeners.length - 1];
  if (!listener) throw new Error('no listener registered');
  return listener(msg, { name: 'cebian-agent' });
}

describe('useBackgroundAgent ⑤.4.followup — web_provider_needs_relogin', () => {
  it('calls onOpenSettings when receiving web_provider_needs_relogin', () => {
    const onOpenSettings = vi.fn();
    const callbacks: AgentPortCallbacks = { onOpenSettings };
    renderHook(() => useBackgroundAgent(callbacks));
    // First deliver a 'connected' so the hook considers the port active
    act(() => { deliverMessage({ type: 'connected' }); });
    // Now deliver the re-login message
    act(() => {
      deliverMessage({
        type: 'web_provider_needs_relogin',
        providerId: 'glm',
        status: 401,
        message: 'Please re-login to glm',
      });
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onOpenSettings is not provided (optional callback)', () => {
    renderHook(() => useBackgroundAgent({}));
    act(() => { deliverMessage({ type: 'connected' }); });
    expect(() => {
      act(() => {
        deliverMessage({
          type: 'web_provider_needs_relogin',
          providerId: 'kimi',
          status: 403,
          message: 'x',
        });
      });
    }).not.toThrow();
  });

  it('toast.error is called for 401 re-login (destructive variant → sonner error)', async () => {
    const { toast } = await import('sonner');
    renderHook(() => useBackgroundAgent({ onOpenSettings: vi.fn() }));
    act(() => { deliverMessage({ type: 'connected' }); });
    act(() => {
      deliverMessage({
        type: 'web_provider_needs_relogin',
        providerId: 'deepseek',
        status: 401,
        message: 'x',
      });
    });
    expect(toast.error).toHaveBeenCalled();
  });

  it('ignores non-relogin messages (does not call onOpenSettings)', () => {
    const onOpenSettings = vi.fn();
    renderHook(() => useBackgroundAgent({ onOpenSettings }));
    act(() => { deliverMessage({ type: 'connected' }); });
    act(() => { deliverMessage({ type: 'error', sessionId: null, error: 'unrelated' }); });
    expect(onOpenSettings).not.toHaveBeenCalled();
  });
});
