/**
 * ⑭: Unit tests for the port-based abort channel in the GLM adapter.
 *
 * Tests that `glmMainWorldFetch`:
 *   1. Initializes `window.__webProviderAbortFlag = false` on start
 *   2. Listens for `WEB_LLM_ABORT` events and sets the flag to `true`
 *   3. Breaks the SSE reading loop early when the flag is set mid-stream,
 *      posting `WEB_LLM_DONE` with truncated text (no residual chunks)
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { glmMainWorldFetch } from '@/lib/ai-config/web-provider-content-fetch-glm';
import type { ContentFetchRequest } from '@/lib/ai-config/web-provider-content-fetch-main';

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

/**
 * Build a minimal ContentFetchRequest for the GLM adapter.
 */
function makeRequest(overrides: Partial<ContentFetchRequest> = {}): ContentFetchRequest {
  return {
    type: 'WEB_LLM_FETCH',
    requestId: 'test-req-' + Math.random().toString(36).slice(2),
    providerId: 'glm',
    modelId: 'glm-4.6',
    init: {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'hello',
        chatId: '',
        assistantId: '65940acff94777010aa6b796',
      }),
    },
    ...overrides,
  };
}

/**
 * Set up a mock fetch that returns a ReadableStream we control.
 */
function setupControllableStream(): {
  request: ContentFetchRequest;
  push: (chunk: string) => void;
  close: () => void;
} {
  const request = makeRequest();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  const push = (chunk: string) => {
    controller?.enqueue(new TextEncoder().encode(chunk));
  };
  const close = () => {
    controller?.close();
  };

  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: stream,
      text: () => Promise.resolve(''),
    } as unknown as Response),
  );

  Object.defineProperty(document, 'cookie', {
    get: vi.fn(() => 'chatglm_token=fake-token; chatglm_refresh_token=fake-refresh'),
    configurable: true,
  });

  return { request, push, close };
}

describe('glmMainWorldFetch (⑭: port-based abort channel)', () => {
  let capture: { events: Array<{ type: string; [k: string]: unknown }> };
  let captureFn: (event: Event) => void;

  beforeEach(() => {
    capture = { events: [] };
    captureFn = (event: Event) => {
      const ce = event as CustomEvent<Record<string, unknown>>;
      if (ce.detail && typeof ce.detail === 'object' && typeof ce.detail.type === 'string') {
        capture.events.push(ce.detail as { type: string; [k: string]: unknown });
      }
    };
    document.addEventListener('ceb-web-provider-message', captureFn);
    (window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag = undefined;
    // ⑭: jsdom defaults to `http://localhost`, but the GLM adapter
    // early-returns when `window.location.origin` doesn't include
    // `chatglm.cn`. Override `location` so the adapter proceeds past
    // the origin check and actually enters the SSE reading loop.
    const fakeLocation = {
      origin: 'https://chatglm.cn',
      href: 'https://chatglm.cn/main/chat/new',
      host: 'chatglm.cn',
      hostname: 'chatglm.cn',
      protocol: 'https:',
      port: '',
      pathname: '/main/chat/new',
      search: '',
      hash: '',
    };
    Object.defineProperty(window, 'location', {
      value: fakeLocation,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    document.removeEventListener('ceb-web-provider-message', captureFn);
    vi.restoreAllMocks();
    (window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag = undefined;
  });

  it('initializes __webProviderAbortFlag to false on start', async () => {
    const { request, close } = setupControllableStream();
    const promise = glmMainWorldFetch(request);
    await new Promise((r) => setTimeout(r, 50));
    expect((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag).toBe(false);
    sendAbortSignal();
    close();
    await promise;
  });

  it('sets __webProviderAbortFlag to true when WEB_LLM_ABORT event is received', async () => {
    const { request, close } = setupControllableStream();
    const promise = glmMainWorldFetch(request);
    await new Promise((r) => setTimeout(r, 50));
    expect((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag).toBe(false);
    sendAbortSignal();
    await new Promise((r) => setTimeout(r, 50));
    expect((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag).toBe(true);
    close();
    await promise;
  });

  it('breaks the SSE loop early when abort flag is set mid-stream (no residual chunks after abort)', async () => {
    const { request, push, close } = setupControllableStream();

    // Push an initial chunk BEFORE abort so the adapter has something
    const sseChunk1 = `data: ${JSON.stringify({
      parts: [{ logic_id: 'l1', content: [{ type: 'text', text: 'Hello' }] }],
    })}\n\n`;
    push(sseChunk1);

    const promise = glmMainWorldFetch(request);
    // Wait for the first chunk to be processed
    await new Promise((r) => setTimeout(r, 150));

    // Now send the abort signal
    sendAbortSignal();
    await new Promise((r) => setTimeout(r, 50));

    // Push more data AFTER abort — these should NOT produce chunks
    const sseChunk2 = `data: ${JSON.stringify({
      parts: [{ logic_id: 'l1', content: [{ type: 'text', text: 'Hello world this should not appear' }] }],
    })}\n\n`;
    push(sseChunk2);

    // Wait a bit to see if any post-abort chunks are emitted
    await new Promise((r) => setTimeout(r, 100));
    close();

    await promise;

    const chunks = capture.events.filter((e) => e.type === 'WEB_LLM_CHUNK');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const allChunkText = chunks.map((c) => (c.chunk as string) ?? '').join('');
    expect(allChunkText).not.toContain('should not appear');
    const dones = capture.events.filter((e) => e.type === 'WEB_LLM_DONE');
    expect(dones.length).toBeGreaterThanOrEqual(1);
  });

  it('cleans up the abort listener after completion (no leak)', async () => {
    const { request, close } = setupControllableStream();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const promise = glmMainWorldFetch(request);
    await new Promise((r) => setTimeout(r, 50));
    sendAbortSignal();
    close();
    await promise;

    const removedForCeb = removeSpy.mock.calls.filter((c) => c[0] === 'ceb-web-provider-message');
    expect(removedForCeb.length).toBeGreaterThanOrEqual(1);
  });
});
