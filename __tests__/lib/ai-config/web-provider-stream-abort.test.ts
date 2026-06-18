/**
 * ⑭: Unit tests for the SW-side abort port management in orchestrateStream.
 *
 * Tests that when the AbortSignal fires (user clicked Stop):
 *   1. The SW opens a port via `chrome.tabs.connect(tabId, {name:'abort-...'}`
 *   2. The SW posts `{type:'abort'}` on that port
 *   3. The SW disconnects the port in the finally block
 *   4. If the signal is already aborted before the port opens, abort fires immediately
 *   5. If chrome.tabs.connect throws, the orchestrator continues (non-fatal)
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildWebSessionStream,
  type WebSessionStreamDeps,
} from '@/lib/ai-config/web-provider-stream';
import { WEB_PROVIDER_PRESETS } from '@/lib/ai-config/web-provider-presets';
import type { Model, AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { WebProvider } from '@/lib/types';

interface MockPort {
  name: string;
  postMessage: ReturnType<typeof vi.fn<(msg: unknown) => void>>;
  disconnect: ReturnType<typeof vi.fn<() => void>>;
  onMessage: { addListener: ReturnType<typeof vi.fn<(fn: (msg: unknown) => void) => void>> };
  onDisconnect: { addListener: ReturnType<typeof vi.fn<(fn: () => void) => void>> };
}

function makeModel(providerId: WebProvider['presetId'], modelId: string): Model<'web-session'> {
  return {
    id: `web:${providerId}:${modelId}`,
    name: `${providerId} ${modelId}`,
    api: 'web-session',
    provider: 'web-session',
    baseUrl: 'https://example.com',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

describe('orchestrateStream (⑭: SW-side abort port management)', () => {
  let mockPort: MockPort;
  let connectCalls: Array<{ tabId: number; name: string }>;
  let deps: WebSessionStreamDeps;
  let messageHandler: ((msg: unknown) => void) | undefined;
  let injectResolve: (() => void) | null;

  beforeEach(() => {
    mockPort = {
      name: '',
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };
    connectCalls = [];
    injectResolve = null;
    messageHandler = undefined;

    (globalThis as unknown as { chrome: unknown }).chrome = {
      tabs: {
        connect: vi.fn((tabId: number, opts: { name: string }) => {
          connectCalls.push({ tabId, name: opts.name });
          mockPort.name = opts.name;
          return mockPort;
        }),
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    };

    deps = {
      openTab: vi.fn(() => Promise.resolve(42)),
      // No mainWorldFetchByProvider → takes the DOM relay path
      injectScripts: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            // Hold the inject open so the orchestrator doesn't reach
            // the finally block before we abort. The test resolves
            // this via `injectResolve()` when ready.
            injectResolve = resolve;
          }),
      ),
      onMessage: vi.fn((handler) => {
        messageHandler = handler;
        return () => {
          messageHandler = undefined;
        };
      }),
      resolveBundle: vi.fn(() => Promise.resolve({ sessionid: 'abc' })),
      getAuthHeaders: vi.fn(() => Promise.resolve(null)),
      presets: WEB_PROVIDER_PRESETS,
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.restoreAllMocks();
  });

  /**
   * Cleanly end the stream by sending WEB_LLM_DONE via the message
   * handler, then resolving injectScripts so the orchestrator's
   * finally block runs. Waits for the finally block to complete.
   */
  async function cleanupStream(out: AssistantMessageEventStream): Promise<void> {
    void out;
    if (messageHandler) {
      messageHandler({ type: 'WEB_LLM_DONE', providerId: 'glm' });
    }
    if (injectResolve) injectResolve();
    // Wait for the orchestrator's finally block to run (it has a
    // setTimeout(unregisterMsg, 100) but the port disconnect + signal
    // listener removal happen synchronously in the finally block).
    await new Promise((r) => setTimeout(r, 150));
  }

  it('opens an abort port via chrome.tabs.connect after openTab returns', async () => {
    const stream = buildWebSessionStream(deps);
    const out = stream(makeModel('glm', 'GLM-4.6'), {
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    }, { apiKey: 'web:glm' });

    // Let the orchestrator proceed past openTab + chrome.tabs.connect
    await new Promise((r) => setTimeout(r, 50));

    expect(connectCalls.length).toBe(1);
    expect(connectCalls[0].tabId).toBe(42);
    expect(connectCalls[0].name.startsWith('abort-')).toBe(true);

    await cleanupStream(out);
  });

  it('posts {type:"abort"} on the port when the AbortSignal fires', async () => {
    const controller = new AbortController();
    const stream = buildWebSessionStream(deps);
    const out = stream(makeModel('glm', 'GLM-4.6'), {
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    }, { apiKey: 'web:glm', signal: controller.signal });

    // Wait for the orchestrator to open the port + add the signal listener
    await new Promise((r) => setTimeout(r, 50));
    expect(connectCalls.length).toBe(1);
    expect(mockPort.postMessage).not.toHaveBeenCalled();

    // Abort!
    controller.abort();

    // Wait a tick for the abort handler to fire
    await new Promise((r) => setTimeout(r, 20));
    expect(mockPort.postMessage).toHaveBeenCalledTimes(1);
    expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'abort' });

    await cleanupStream(out);
  });

  it('disconnects the abort port in the finally block', async () => {
    const controller = new AbortController();
    const stream = buildWebSessionStream(deps);
    const out = stream(makeModel('glm', 'GLM-4.6'), {
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    }, { apiKey: 'web:glm', signal: controller.signal });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockPort.disconnect).not.toHaveBeenCalled();

    await cleanupStream(out);

    // The finally block should have disconnected the port
    expect(mockPort.disconnect).toHaveBeenCalledTimes(1);
  });

  it('aborts immediately if the signal is already aborted before the port opens', async () => {
    const controller = new AbortController();
    controller.abort(); // Pre-abort

    const stream = buildWebSessionStream(deps);
    const out = stream(makeModel('glm', 'GLM-4.6'), {
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    }, { apiKey: 'web:glm', signal: controller.signal });

    await new Promise((r) => setTimeout(r, 50));

    // The port should have been opened and postMessage called immediately
    expect(connectCalls.length).toBe(1);
    expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'abort' });

    await cleanupStream(out);
  });

  it('does not throw when chrome.tabs.connect fails (non-fatal)', async () => {
    // Make chrome.tabs.connect throw
    (globalThis as unknown as { chrome: { tabs: { connect: unknown } } }).chrome.tabs.connect = vi.fn(() => {
      throw new Error('Tab not found');
    });

    const controller = new AbortController();
    const stream = buildWebSessionStream(deps);
    const out = stream(makeModel('glm', 'GLM-4.6'), {
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    }, { apiKey: 'web:glm', signal: controller.signal });

    await new Promise((r) => setTimeout(r, 50));

    // The orchestrator should still be running (didn't throw)
    // Aborting should be a no-op (no port to post to)
    controller.abort();
    await new Promise((r) => setTimeout(r, 20));
    // postMessage was never called because the port was never opened
    expect(mockPort.postMessage).not.toHaveBeenCalled();

    await cleanupStream(out);
  });
});
