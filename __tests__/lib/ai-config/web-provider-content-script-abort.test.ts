/**
 * ⑭: Unit tests for the ISOLATED bridge's port-based abort forwarding.
 *
 * Tests that `installIsolatedBridge`:
 *   1. Registers a `chrome.runtime.onConnect` listener for `abort-*` ports
 *   2. Forwards `{type:'abort'}` port messages to the MAIN world via a
 *      `ceb-web-provider-message` CustomEvent with `{type:'WEB_LLM_ABORT'}`
 *   3. Ignores ports that don't start with `abort-`
 *   4. Ignores port messages that aren't `{type:'abort'}`
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installIsolatedBridge } from '@/lib/ai-config/web-provider-content-script';

type PortMessageHandler = (msg: unknown) => void;
type ConnectHandler = (port: {
  name: string;
  onMessage: { addListener: (fn: PortMessageHandler) => void };
}) => void;

interface MockChrome {
  runtime: {
    onConnect: {
      addListener: ReturnType<typeof vi.fn<(fn: ConnectHandler) => void>>;
      removeListener: ReturnType<typeof vi.fn<(fn: ConnectHandler) => void>>;
    };
    sendMessage: ReturnType<typeof vi.fn<(msg: unknown) => Promise<void>>>;
  };
}

describe('installIsolatedBridge (⑭: port-based abort forwarding)', () => {
  let mockChrome: MockChrome;
  let connectListeners: ConnectHandler[];
  let capturedEvents: Array<{ type: string; [k: string]: unknown }>;
  let captureFn: (event: Event) => void;

  beforeEach(() => {
    connectListeners = [];
    capturedEvents = [];
    mockChrome = {
      runtime: {
        onConnect: {
          addListener: vi.fn((fn: ConnectHandler) => {
            connectListeners.push(fn);
          }),
          removeListener: vi.fn((fn: ConnectHandler) => {
            const i = connectListeners.indexOf(fn);
            if (i >= 0) connectListeners.splice(i, 1);
          }),
        },
        sendMessage: vi.fn(() => Promise.resolve()),
      },
    };
    (globalThis as unknown as { chrome: unknown }).chrome = mockChrome;

    capturedEvents = [];
    captureFn = (event: Event) => {
      const ce = event as CustomEvent<Record<string, unknown>>;
      if (ce.detail && typeof ce.detail === 'object' && typeof ce.detail.type === 'string') {
        capturedEvents.push(ce.detail as { type: string; [k: string]: unknown });
      }
    };
    document.addEventListener('ceb-web-provider-message', captureFn);

    // Clear the bridge guard so each test starts fresh
    (window as unknown as { __cebWebProviderBridge?: unknown }).__cebWebProviderBridge = undefined;
  });

  afterEach(() => {
    document.removeEventListener('ceb-web-provider-message', captureFn);
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.restoreAllMocks();
    (window as unknown as { __cebWebProviderBridge?: unknown }).__cebWebProviderBridge = undefined;
  });

  /**
   * Simulate the SW opening an `abort-*` port and posting `{type:'abort'}`.
   * Returns the abort CustomEvents that were dispatched on document.
   */
  function simulateAbortPortMessage(portName: string, msg: unknown): void {
    expect(connectListeners.length).toBeGreaterThanOrEqual(1);
    const portMessageHandlers: PortMessageHandler[] = [];
    const mockPort = {
      name: portName,
      onMessage: {
        addListener: vi.fn((fn: PortMessageHandler) => {
          portMessageHandlers.push(fn);
        }),
      },
    };
    // Call every registered connect listener with the mock port
    for (const listener of connectListeners) {
      listener(mockPort);
    }
    // Call every port message handler with the message
    for (const handler of portMessageHandlers) {
      handler(msg);
    }
  }

  it('registers a chrome.runtime.onConnect listener', () => {
    installIsolatedBridge('glm');
    expect(mockChrome.runtime.onConnect.addListener).toHaveBeenCalledTimes(1);
  });

  it('forwards {type:"abort"} on an abort-* port as a WEB_LLM_ABORT CustomEvent', () => {
    installIsolatedBridge('glm');
    simulateAbortPortMessage('abort-test-req-1', { type: 'abort' });

    const aborts = capturedEvents.filter((e) => e.type === 'WEB_LLM_ABORT');
    expect(aborts.length).toBe(1);
    expect(aborts[0].providerId).toBe('glm');
  });

  it('ignores ports that do not start with "abort-"', () => {
    installIsolatedBridge('glm');
    simulateAbortPortMessage('agent-session-1', { type: 'abort' });

    const aborts = capturedEvents.filter((e) => e.type === 'WEB_LLM_ABORT');
    expect(aborts.length).toBe(0);
  });

  it('ignores port messages that are not {type:"abort"}', () => {
    installIsolatedBridge('glm');
    simulateAbortPortMessage('abort-test-req-2', { type: 'something_else' });
    simulateAbortPortMessage('abort-test-req-3', 'not-an-object');
    simulateAbortPortMessage('abort-test-req-4', { type: 'abort', extra: true });

    // The {type:'abort', extra:true} should still forward (only type is checked)
    const aborts = capturedEvents.filter((e) => e.type === 'WEB_LLM_ABORT');
    expect(aborts.length).toBe(1);
  });

  it('removes the old connect listener when re-installed (reload survival)', () => {
    installIsolatedBridge('glm');
    expect(mockChrome.runtime.onConnect.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onConnect.removeListener).not.toHaveBeenCalled();

    // Simulate a stale bridge state from a previous SW generation
    // (different providerId + a stale connectListener). The re-install
    // should remove the old connectListener before adding a new one.
    const staleConnectListener = (() => undefined) as ConnectHandler;
    (window as unknown as {
      __cebWebProviderBridge?: { providerId: string; listener?: EventListener; connectListener?: ConnectHandler };
    }).__cebWebProviderBridge = {
      providerId: 'kimi', // different providerId → triggers cleanup path
      listener: (() => undefined) as EventListener,
      connectListener: staleConnectListener,
    };
    installIsolatedBridge('glm');
    expect(mockChrome.runtime.onConnect.removeListener).toHaveBeenCalledWith(staleConnectListener);
  });
});
