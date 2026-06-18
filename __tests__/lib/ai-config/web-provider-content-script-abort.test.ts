/**
 * ⑭: Unit tests for the port-based abort channel in the content script.
 *
 * Two test suites:
 *
 * 1. `installIsolatedBridge` (ISOLATED world):
 *      - Registers a `chrome.runtime.onConnect` listener for `abort-*` ports
 *      - Forwards `{type:'abort'}` port messages to the MAIN world via a
 *        `ceb-web-provider-message` CustomEvent with `{type:'WEB_LLM_ABORT'}`
 *      - Ignores ports that don't start with `abort-`
 *      - Ignores port messages that aren't `{type:'abort'}`
 *
 * 2. `runDomRelayMainWorld` (MAIN world, DOM-injection path):
 *      - Initializes `window.__webProviderAbortFlag = false` on start
 *      - Listens for `WEB_LLM_ABORT` events and sets the flag to `true`
 *      - Breaks the DOM polling loop early when the flag is set mid-poll,
 *        posting `WEB_LLM_DONE` (no residual chunks after abort)
 *      - Cleans up the abort listener after completion (no leak)
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installIsolatedBridge, runDomRelayMainWorld, type DomRelayRequest } from '@/lib/ai-config/web-provider-content-script';
import type { WebProviderDomStrategy } from '@/lib/ai-config/web-provider-dom-strategy';

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

// ====================================================================
// runDomRelayMainWorld: DOM-injection path abort behavior
// ====================================================================

/**
 * Simulate the ISOLATED bridge forwarding a `WEB_LLM_ABORT` signal from
 * the SW to the MAIN world. This dispatches the same CustomEvent the
 * bridge would dispatch when it receives `{type:'abort'}` on the port.
 */
function sendAbortSignal(): void {
  document.dispatchEvent(new CustomEvent('ceb-web-provider-message', {
    detail: { type: 'WEB_LLM_ABORT' },
  }));
}

const mockDomStrategy: WebProviderDomStrategy = {
  input: {
    selector: '#chat-input',
    setMethod: 'textarea-setter',
    sendMethod: 'enter',
    settleDelayMs: 0,
  },
  reader: {
    assistantMessageSelector: '.assistant-msg',
    // Streaming indicator serves two purposes:
    //   1. Makes `waitForStreamingEvidence` resolve quickly (~80ms) so
    //      the function enters the polling loop fast.
    //   2. Keeps `isStillStreaming()` returning true so the stable check
    //      never fires — only abort or timeout can end the loop.
    thinkingIndicatorSelector: '.streaming-indicator',
    pollIntervalMs: 50,
    // Very high stable threshold so the reader never auto-completes
    stableThresholdMs: 100_000,
    maxTotalMs: 60_000,
    textMode: 'textContent',
  },
};

function makeDomRelayRequest(overrides: Partial<DomRelayRequest> = {}): DomRelayRequest {
  return {
    providerId: 'glm',
    modelId: 'glm-4.6',
    message: 'hello',
    domStrategy: mockDomStrategy,
    ...overrides,
  };
}

/**
 * Set up the DOM with an input element, an (empty) assistant message
 * element, and a streaming indicator.
 */
function setupDomForRelay(): { setAssistantText: (text: string) => void } {
  document.body.innerHTML = '';
  const input = document.createElement('textarea');
  input.id = 'chat-input';
  document.body.appendChild(input);

  const msg = document.createElement('div');
  msg.className = 'assistant-msg';
  msg.textContent = '';
  document.body.appendChild(msg);

  const indicator = document.createElement('div');
  indicator.className = 'streaming-indicator';
  document.body.appendChild(indicator);

  return {
    setAssistantText: (text: string) => { msg.textContent = text; },
  };
}

describe('runDomRelayMainWorld (⑭: port-based abort channel)', () => {
  let capture: { messages: Array<{ type: string; [k: string]: unknown }> };
  let captureFn: (event: MessageEvent) => void;

  beforeEach(() => {
    capture = { messages: [] };
    // Note: `runDomRelayMainWorld` uses `window.postMessage` for `postToBridge`
    // (unlike `glmMainWorldFetch` which uses `document.dispatchEvent`), so we
    // capture messages via `window.addEventListener('message', ...)`. The abort
    // signal itself uses the same `ceb-web-provider-message` CustomEvent channel.
    captureFn = (event: MessageEvent) => {
      const data = event.data as { source?: string; payload?: unknown } | null;
      if (data && typeof data === 'object' && data.source === 'ceb-web-provider-main') {
        const payload = data.payload as { type?: string } | null;
        if (payload && typeof payload === 'object' && typeof payload.type === 'string') {
          capture.messages.push(payload as { type: string; [k: string]: unknown });
        }
      }
    };
    window.addEventListener('message', captureFn);
    (window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag = undefined;
  });

  afterEach(() => {
    window.removeEventListener('message', captureFn);
    vi.restoreAllMocks();
    (window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag = undefined;
  });

  it('initializes __webProviderAbortFlag to false on start', async () => {
    setupDomForRelay();
    const request = makeDomRelayRequest();
    const promise = runDomRelayMainWorld(request);
    // Wait for the function to initialize the flag and enter the polling loop
    await new Promise((r) => setTimeout(r, 200));
    expect((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag).toBe(false);
    sendAbortSignal();
    await promise;
  });

  it('sets __webProviderAbortFlag to true when WEB_LLM_ABORT event is received', async () => {
    setupDomForRelay();
    const request = makeDomRelayRequest();
    const promise = runDomRelayMainWorld(request);
    await new Promise((r) => setTimeout(r, 200));
    expect((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag).toBe(false);
    sendAbortSignal();
    await new Promise((r) => setTimeout(r, 100));
    expect((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag).toBe(true);
    await promise;
  });

  it('breaks the polling loop early when abort flag is set mid-poll (no residual chunks after abort)', async () => {
    const { setAssistantText } = setupDomForRelay();
    const request = makeDomRelayRequest();

    const promise = runDomRelayMainWorld(request);
    // Wait for the function to enter the polling loop
    await new Promise((r) => setTimeout(r, 300));

    // Push initial text — should produce a WEB_LLM_CHUNK
    setAssistantText('Hello');
    await new Promise((r) => setTimeout(r, 200));

    const chunksBeforeAbort = capture.messages.filter((m) => m.type === 'WEB_LLM_CHUNK');
    expect(chunksBeforeAbort.length).toBeGreaterThanOrEqual(1);

    // Send the abort signal — the flag is set synchronously by the listener
    sendAbortSignal();
    // Wait for the function to check the flag and break (within pollMs + buffer)
    await new Promise((r) => setTimeout(r, 200));

    // Change text AFTER abort — should NOT produce a chunk
    setAssistantText('Hello world this should not appear');
    await new Promise((r) => setTimeout(r, 150));

    await promise;
    // Allow any pending postMessage events to flush
    await new Promise((r) => setTimeout(r, 50));

    const chunks = capture.messages.filter((m) => m.type === 'WEB_LLM_CHUNK');
    const allChunkText = chunks.map((c) => (c.text as string) ?? '').join('');
    expect(allChunkText).not.toContain('should not appear');
    const dones = capture.messages.filter((m) => m.type === 'WEB_LLM_DONE');
    expect(dones.length).toBeGreaterThanOrEqual(1);
  });

  it('cleans up the abort listener after completion (no leak)', async () => {
    setupDomForRelay();
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const request = makeDomRelayRequest();
    const promise = runDomRelayMainWorld(request);
    await new Promise((r) => setTimeout(r, 200));
    sendAbortSignal();
    await promise;

    const removedForCeb = removeSpy.mock.calls.filter((c) => c[0] === 'ceb-web-provider-message');
    expect(removedForCeb.length).toBeGreaterThanOrEqual(1);
  });
});
