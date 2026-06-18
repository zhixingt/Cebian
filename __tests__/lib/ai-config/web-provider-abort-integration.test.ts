/**
 * ⑭: Integration test for the full port-based abort flow.
 *
 * Verifies the end-to-end wiring:
 *   SW: signal.abort() → port.postMessage({type:'abort'})
 *   → ISOLATED bridge: onConnect listener → document CustomEvent {type:'WEB_LLM_ABORT'}
 *   → MAIN world: __webProviderAbortFlag = true → SSE loop breaks early
 *   → no residual text after abort
 *
 * This test wires `chrome.tabs.connect` (SW side) to
 * `chrome.runtime.onConnect` (ISOLATED bridge side) so the port
 * messages actually flow through the bridge's listener, just like
 * in production. The GLM adapter runs with a controllable SSE stream
 * so we can push chunks before and after abort.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildWebSessionStream,
  type WebSessionStreamDeps,
} from '@/lib/ai-config/web-provider-stream';
import { installIsolatedBridge } from '@/lib/ai-config/web-provider-content-script';
import { glmMainWorldFetch } from '@/lib/ai-config/web-provider-content-fetch-glm';
import { WEB_PROVIDER_PRESETS } from '@/lib/ai-config/web-provider-presets';
import type { Model } from '@earendil-works/pi-ai';
import type { WebProvider } from '@/lib/types';
import type { ContentFetchRequest } from '@/lib/ai-config/web-provider-content-fetch-main';

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

describe('⑭: full abort flow integration (SW → bridge → MAIN world)', () => {
  let connectListeners: Array<(port: unknown) => void>;
  let messageHandler: ((msg: unknown) => void) | undefined;
  let injectResolve: (() => void) | null;
  let deps: WebSessionStreamDeps;
  let capturedEvents: Array<{ type: string; [k: string]: unknown }>;
  let captureFn: (event: Event) => void;

  beforeEach(() => {
    connectListeners = [];
    messageHandler = undefined;
    injectResolve = null;
    capturedEvents = [];

    // Wire chrome.tabs.connect (SW side) → chrome.runtime.onConnect (bridge side)
    // so port messages actually flow through the bridge's listener.
    (globalThis as unknown as { chrome: unknown }).chrome = {
      tabs: {
        connect: vi.fn((_tabId: number, opts: { name: string }) => {
          const portMessageHandlers: Array<(msg: unknown) => void> = [];
          const mockPort = {
            name: opts.name,
            onMessage: {
              addListener: vi.fn((fn: (msg: unknown) => void) => {
                portMessageHandlers.push(fn);
              }),
            },
            onDisconnect: { addListener: vi.fn() },
            postMessage: vi.fn((msg: unknown) => {
              // Forward to all registered port message handlers
              for (const handler of portMessageHandlers) handler(msg);
            }),
            disconnect: vi.fn(),
          };
          // Trigger onConnect listeners (the bridge's listener)
          for (const listener of connectListeners) listener(mockPort);
          return mockPort;
        }),
      },
      runtime: {
        onConnect: {
          addListener: vi.fn((fn: (port: unknown) => void) => {
            connectListeners.push(fn);
          }),
          removeListener: vi.fn(),
        },
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(() => Promise.resolve()),
      },
    };

    // Capture CustomEvents dispatched on document (what the bridge forwards)
    captureFn = (event: Event) => {
      const ce = event as CustomEvent<Record<string, unknown>>;
      if (ce.detail && typeof ce.detail === 'object' && typeof ce.detail.type === 'string') {
        capturedEvents.push(ce.detail as { type: string; [k: string]: unknown });
      }
    };
    document.addEventListener('ceb-web-provider-message', captureFn);

    // Mock window.location to chatglm.cn so the GLM adapter doesn't early-return
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://chatglm.cn',
        href: 'https://chatglm.cn/main/chat/new',
        host: 'chatglm.cn',
        hostname: 'chatglm.cn',
        protocol: 'https:',
        port: '',
        pathname: '/main/chat/new',
        search: '',
        hash: '',
      },
      writable: true,
      configurable: true,
    });

    // Mock cookie + fetch for the GLM adapter
    Object.defineProperty(document, 'cookie', {
      get: vi.fn(() => 'chatglm_token=fake-token; chatglm_refresh_token=fake-refresh'),
      configurable: true,
    });

    deps = {
      openTab: vi.fn(() => Promise.resolve(42)),
      injectScripts: vi.fn(
        () =>
          new Promise<void>((resolve) => {
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

    // Clear bridge guard
    (window as unknown as { __cebWebProviderBridge?: unknown }).__cebWebProviderBridge = undefined;
    (window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag = undefined;
  });

  afterEach(() => {
    document.removeEventListener('ceb-web-provider-message', captureFn);
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.restoreAllMocks();
    (window as unknown as { __cebWebProviderBridge?: unknown }).__cebWebProviderBridge = undefined;
    (window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag = undefined;
  });

  it('SW abort → bridge forwards → MAIN world breaks early (no residual text)', async () => {
    // 1. Install the ISOLATED bridge (sets up onConnect listener)
    installIsolatedBridge('glm');

    // 2. Set up a controllable SSE stream for the GLM adapter
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const sseStream = new ReadableStream<Uint8Array>({
      start(c) { streamController = c; },
    });
    const pushSse = (chunk: string) => {
      streamController?.enqueue(new TextEncoder().encode(chunk));
    };
    const closeSse = () => { streamController?.close(); };

    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: sseStream,
        text: () => Promise.resolve(''),
      } as unknown as Response),
    );

    // 3. Start the SW stream (orchestrator opens tab, port, injects)
    const controller = new AbortController();
    const streamFn = buildWebSessionStream(deps);
    const out = streamFn(makeModel('glm', 'GLM-4.6'), {
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    }, { apiKey: 'web:glm', signal: controller.signal });

    // Wait for the orchestrator to open the port + set up the signal listener
    await new Promise((r) => setTimeout(r, 50));

    // 4. Simulate the MAIN-world IIFE running (in production this is injected
    //    via chrome.scripting.executeScript; here we call it directly).
    //    Push an initial chunk BEFORE abort so the adapter has something.
    const fetchRequest: ContentFetchRequest = {
      type: 'WEB_LLM_FETCH',
      requestId: 'integration-test-req',
      providerId: 'glm',
      modelId: 'GLM-4.6',
      init: {
        method: 'POST',
        body: JSON.stringify({ prompt: 'hi', chatId: '', assistantId: '65940acff94777010aa6b796' }),
      },
    };
    pushSse(`data: ${JSON.stringify({
      parts: [{ logic_id: 'l1', content: [{ type: 'text', text: 'Hello' }] }],
    })}\n\n`);

    const adapterPromise = glmMainWorldFetch(fetchRequest);
    // Let the adapter process the first chunk
    await new Promise((r) => setTimeout(r, 100));

    // 5. User clicks Stop → AbortSignal fires
    controller.abort();
    // Wait for: SW posts {type:'abort'} on port → bridge forwards as
    // CustomEvent → adapter sets flag
    await new Promise((r) => setTimeout(r, 50));

    // 6. Push MORE data AFTER abort — this should NOT produce chunks
    pushSse(`data: ${JSON.stringify({
      parts: [{ logic_id: 'l1', content: [{ type: 'text', text: 'Hello world this should not appear' }] }],
    })}\n\n`);
    await new Promise((r) => setTimeout(r, 100));
    closeSse();
    await adapterPromise;

    // 7. Verify: no residual text after abort
    const chunks = capturedEvents.filter((e) => e.type === 'WEB_LLM_CHUNK');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const allChunkText = chunks.map((c) => (c.chunk as string) ?? '').join('');
    expect(allChunkText).not.toContain('should not appear');

    // The adapter should have dispatched WEB_LLM_DONE (early break)
    const dones = capturedEvents.filter((e) => e.type === 'WEB_LLM_DONE');
    expect(dones.length).toBeGreaterThanOrEqual(1);

    // The abort flag should be true
    expect((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag).toBe(true);

    // Cleanup: end the SW stream
    if (messageHandler) {
      messageHandler({ type: 'WEB_LLM_DONE', providerId: 'glm' });
    }
    if (injectResolve) injectResolve();
    await new Promise((r) => setTimeout(r, 150));
    void out;
  });
});
