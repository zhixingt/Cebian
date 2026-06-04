import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TabRegistry,
  getTabRegistry,
  _resetTabRegistryForTesting,
  _getTabEntryForTesting,
  injectRelayScripts,
  WEB_LLM_RELAY_READY,
  WEB_LLM_CHUNK,
  WEB_LLM_DONE,
  WEB_LLM_ERROR,
  parseSseFrames,
  parseDelta,
  type SseEvent,
  processChatStream,
  WEB_SESSION_TIMEOUT_MS,
  executeChatRequest,
  WEB_LLM_NEEDS_RELOGIN,
  type WebProviderRelayMessage,
} from '@/lib/ai-config/web-provider-relay';
import type { WebProvider } from '@/lib/types';

let mockExistingChromeTabs: Array<{ id: number; windowId: number; url: string }> = [];
let mockCreatedTabId = 1000;

beforeEach(() => {
  _resetTabRegistryForTesting();
  mockExistingChromeTabs = [];
  mockCreatedTabId = 1000;
  (global as any).chrome = {
    tabs: {
      query: vi.fn((_opts: any) => Promise.resolve(mockExistingChromeTabs)),
      create: vi.fn((opts: any) => {
        const tab = { id: mockCreatedTabId++, windowId: 1, url: opts.url };
        mockExistingChromeTabs.push(tab);
        return Promise.resolve(tab);
      }),
      get: vi.fn((id: number) => {
        const t = mockExistingChromeTabs.find(t => t.id === id);
        return t ? Promise.resolve(t) : Promise.reject(new Error('Tab not found'));
      }),
      remove: vi.fn((id: number) => {
        mockExistingChromeTabs = mockExistingChromeTabs.filter(t => t.id !== id);
        return Promise.resolve();
      }),
      update: vi.fn(() => Promise.resolve()),
    },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
});

afterEach(() => {
  _resetTabRegistryForTesting();
});

describe('TabRegistry (T6: ③+④ tab reuse + 5min auto-close)', () => {
  describe('openOrReuseTab', () => {
    it('creates a new tab when no Chrome tab and no registry entry exists', async () => {
      const reg = new TabRegistry();
      const tabId = await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(tabId).toBe(1000);
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://chatglm.cn', active: false });
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(1000);
    });

    it('reuses existing registry entry on second call (no new chrome.tabs.create)', async () => {
      const reg = new TabRegistry();
      const t1 = await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      const createCallsBefore = (chrome.tabs.create as any).mock.calls.length;
      const t2 = await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(t2).toBe(t1);
      expect((chrome.tabs.create as any).mock.calls.length).toBe(createCallsBefore);
    });

    it('reuses existing Chrome tab at same hostname when registry is cold (cold-start path)', async () => {
      mockExistingChromeTabs = [{ id: 99, windowId: 1, url: 'https://chatglm.cn/already-open' }];
      const reg = new TabRegistry();
      const tabId = await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(tabId).toBe(99);
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(99);
    });
  });

  describe('markUsed', () => {
    it('markUsed creates a fresh close timer (proves the timer was reset)', async () => {
      const reg = new TabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      const beforeTimerId = _getTabEntryForTesting(reg, 'glm' as WebProvider['presetId'])!.closeTimerId;
      reg.markUsed('glm' as WebProvider['presetId']);
      const afterTimerId = _getTabEntryForTesting(reg, 'glm' as WebProvider['presetId'])!.closeTimerId;
      // markUsed calls clearTimeout(before) + setTimeout(new) → new handle ≠ old handle
      expect(afterTimerId).not.toBe(beforeTimerId);
    });

    it('markUsed is a no-op for unknown provider', () => {
      const reg = new TabRegistry();
      expect(() => reg.markUsed('kimi' as WebProvider['presetId'])).not.toThrow();
    });
  });

  describe('closeTab', () => {
    it('removes the tab and clears registry state', async () => {
      const reg = new TabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      await reg.closeTab('glm' as WebProvider['presetId']);
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBeUndefined();
      expect(chrome.tabs.remove).toHaveBeenCalledWith(1000);
    });

    it('is a no-op for unknown provider', async () => {
      const reg = new TabRegistry();
      await reg.closeTab('kimi' as WebProvider['presetId']);  // should not throw
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
    });

    it('swallows chrome.tabs.remove error if tab already closed', async () => {
      const reg = new TabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      (chrome.tabs.remove as any) = vi.fn(() => Promise.reject(new Error('Tab not found')));
      await expect(reg.closeTab('glm' as WebProvider['presetId'])).resolves.not.toThrow();
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBeUndefined();
    });
  });

  describe('getTab', () => {
    it('returns undefined for unknown provider', () => {
      const reg = new TabRegistry();
      expect(reg.getTab('kimi' as WebProvider['presetId'])).toBeUndefined();
    });

    it('returns the tabId for a known provider', async () => {
      const reg = new TabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(1000);
    });
  });

  describe('5min auto-close (T6 core feature)', () => {
    it('auto-closes the tab after idleCloseMs', async () => {
      _resetTabRegistryForTesting({ idleCloseMs: 100 });
      const reg = getTabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(1000);
      // Wait > idleCloseMs
      await new Promise(r => setTimeout(r, 150));
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBeUndefined();
      expect(chrome.tabs.remove).toHaveBeenCalledWith(1000);
    });

  it('markUsed within idle window prevents auto-close', async () => {
    _resetTabRegistryForTesting({ idleCloseMs: 100 });
    const reg = getTabRegistry();
    await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
    // Use it again before timeout
    setTimeout(() => reg.markUsed('glm' as WebProvider['presetId']), 50);
    // Wait past original timeout
    await new Promise(r => setTimeout(r, 150));
    expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(1000);
  });
});

describe('injectRelayScripts (T7: ③+④ ISOLATED then MAIN injection + message contract)', () => {
  beforeEach(() => {
    // Ensure chrome.scripting exists (T6 beforeEach only sets chrome.tabs + chrome.runtime)
    if (!(chrome as any).scripting) {
      (chrome as any).scripting = { executeScript: vi.fn() };
    }
    (chrome.scripting.executeScript as any) = vi.fn((_opts: any) => {
      // Mock the bridge registration: ISOLATED injection returns immediately
      return Promise.resolve([{ result: { ok: true } }]);
    });
  });

  it('injects ISOLATED world first, then MAIN world (order matters for bridge availability)', async () => {
    const callOrder: string[] = [];
    (chrome.scripting.executeScript as any) = vi.fn((opts: any) => {
      callOrder.push(opts.world);
      return Promise.resolve([{ result: { ok: true } }]);
    });
    await injectRelayScripts(42, {
      providerId: 'glm',
      endpoint: 'https://chatglm.cn/api/chat',
      bodyTemplate: '{}',
      streamFormat: 'sse',
      endSignal: 'data: [DONE]',
      deltaPath: 'choices.0.delta.content',
      stopReasonPath: 'choices.0.finish_reason',
    });
    expect(callOrder).toEqual(['ISOLATED', 'MAIN']);
  });

  it('ISOLATED injection has correct target + world', async () => {
    const calls: any[] = [];
    (chrome.scripting.executeScript as any) = vi.fn((opts: any) => {
      calls.push(opts);
      return Promise.resolve([{ result: { ok: true } }]);
    });
    await injectRelayScripts(42, {
      providerId: 'glm',
      endpoint: 'https://chatglm.cn/api/chat',
      bodyTemplate: '{}',
      streamFormat: 'sse',
      endSignal: 'data: [DONE]',
      deltaPath: 'choices.0.delta.content',
      stopReasonPath: 'choices.0.finish_reason',
    });
    const isolated = calls.find(c => c.world === 'ISOLATED');
    expect(isolated).toBeDefined();
    expect(isolated.target).toEqual({ tabId: 42 });
    expect(typeof isolated.func).toBe('function');
  });

  it('MAIN injection receives the chat request as args (providerId, endpoint, bodyTemplate, etc.)', async () => {
    const calls: any[] = [];
    (chrome.scripting.executeScript as any) = vi.fn((opts: any) => {
      calls.push(opts);
      return Promise.resolve([{ result: { ok: true } }]);
    });
    await injectRelayScripts(42, {
      providerId: 'kimi',
      endpoint: 'https://kimi.moonshot.cn/api/chat',
      bodyTemplate: '{"messages":[]}',
      streamFormat: 'sse',
      endSignal: 'data: [DONE]',
      deltaPath: 'choices.0.delta.content',
      stopReasonPath: 'choices.0.finish_reason',
    });
    const main = calls.find(c => c.world === 'MAIN');
    expect(main).toBeDefined();
    expect(main.target).toEqual({ tabId: 42 });
    // The args array is passed to the MAIN-world function
    expect(main.args).toEqual([expect.objectContaining({
      providerId: 'kimi',
      endpoint: 'https://kimi.moonshot.cn/api/chat',
      bodyTemplate: '{"messages":[]}',
      streamFormat: 'sse',
      endSignal: 'data: [DONE]',
      deltaPath: 'choices.0.delta.content',
      stopReasonPath: 'choices.0.finish_reason',
    })]);
  });

  it('throws if MAIN injection fails (e.g., page not ready, CSP blocks)', async () => {
    let call = 0;
    (chrome.scripting.executeScript as any) = vi.fn((_opts: any) => {
      call++;
      if (call === 1) return Promise.resolve([{ result: { ok: true } }]);  // ISOLATED ok
      return Promise.reject(new Error('Cannot access chrome:// page'));   // MAIN fails
    });
    await expect(injectRelayScripts(42, {
      providerId: 'glm',
      endpoint: 'https://chatglm.cn/api/chat',
      bodyTemplate: '{}',
      streamFormat: 'sse',
      endSignal: 'data: [DONE]',
      deltaPath: 'choices.0.delta.content',
      stopReasonPath: 'choices.0.finish_reason',
    })).rejects.toThrow('Cannot access chrome:// page');
  });
});

describe('message type constants (T7: contract for MAIN → ISOLATED → SW)', () => {
  it('exports 4 message type constants with expected string values', () => {
    expect(WEB_LLM_RELAY_READY).toBe('WEB_LLM_RELAY_READY');
    expect(WEB_LLM_CHUNK).toBe('WEB_LLM_CHUNK');
    expect(WEB_LLM_DONE).toBe('WEB_LLM_DONE');
    expect(WEB_LLM_ERROR).toBe('WEB_LLM_ERROR');
  });

  it('WebProviderRelayMessage union includes all 4 message shapes', () => {
    const ready: WebProviderRelayMessage = { type: 'WEB_LLM_RELAY_READY', providerId: 'glm' };
    const chunk: WebProviderRelayMessage = { type: 'WEB_LLM_CHUNK', providerId: 'glm', text: 'hi' };
    const done: WebProviderRelayMessage = { type: 'WEB_LLM_DONE', providerId: 'glm', stopReason: 'stop' };
    const error: WebProviderRelayMessage = { type: 'WEB_LLM_ERROR', providerId: 'glm', error: 'oops' };
    expect(ready.type).toBe('WEB_LLM_RELAY_READY');
    expect(chunk.type).toBe('WEB_LLM_CHUNK');
    expect(done.type).toBe('WEB_LLM_DONE');
    expect(error.type).toBe('WEB_LLM_ERROR');
  });
});

describe('parseSseFrames (T8: ③+④ SSE parser)', () => {
  it('parses a single complete event from a full chunk', () => {
    const chunk = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
    const { events, rest } = parseSseFrames('', chunk);
    expect(events).toEqual([{ data: '{"choices":[{"delta":{"content":"hello"}}]}' }]);
    expect(rest).toBe('');
  });

  it('buffers partial events across chunks (frame split mid-line)', () => {
    // Chunk 1: half of an event
    const r1 = parseSseFrames('', 'data: {"choices":[{"delta":{"con');
    expect(r1.events).toEqual([]);
    expect(r1.rest).toBe('data: {"choices":[{"delta":{"con');
    // Chunk 2: rest of the event + a complete second event
    const r2 = parseSseFrames(r1.rest, 'tent":"hi"}}]}\n\ndata: [DONE]\n\n');
    expect(r2.events).toEqual([
      { data: '{"choices":[{"delta":{"content":"hi"}}]}' },
      { data: '[DONE]' },
    ]);
    expect(r2.rest).toBe('');
  });

  it('treats blank line as event separator', () => {
    const chunk = 'data: a\n\ndata: b\n\n';
    const { events } = parseSseFrames('', chunk);
    expect(events).toEqual([{ data: 'a' }, { data: 'b' }]);
  });

  it('parses event: line as event type', () => {
    const chunk = 'event: message\ndata: hello\n\n';
    const { events } = parseSseFrames('', chunk);
    expect(events).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('ignores comment lines (starting with :)', () => {
    const chunk = ': this is a comment\ndata: hello\n\n';
    const { events } = parseSseFrames('', chunk);
    expect(events).toEqual([{ data: 'hello' }]);
  });

  it('returns empty events for chunk with no complete frames', () => {
    const { events, rest } = parseSseFrames('', 'data: partial');
    expect(events).toEqual([]);
    expect(rest).toBe('data: partial');
  });

  it('handles multi-line data (concatenated with \\n)', () => {
    const chunk = 'data: line1\ndata: line2\n\n';
    const { events } = parseSseFrames('', chunk);
    expect(events).toEqual([{ data: 'line1\nline2' }]);
  });
});

describe('parseDelta (T8: ③+④ JSON path navigation)', () => {
  it('extracts text from simple dot-notation path', () => {
    const json = JSON.stringify({ content: 'hello' });
    expect(parseDelta(json, 'content')).toBe('hello');
  });

  it('extracts text from nested path with array index', () => {
    const json = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] });
    expect(parseDelta(json, 'choices.0.delta.content')).toBe('hi');
  });

  it('returns empty string for missing path', () => {
    const json = JSON.stringify({ choices: [{ delta: {} }] });
    expect(parseDelta(json, 'choices.0.delta.content')).toBe('');
  });

  it('returns empty string for null/undefined intermediate', () => {
    expect(parseDelta(JSON.stringify({ a: null }), 'a.b.c')).toBe('');
  });

  it('returns empty string for invalid JSON', () => {
    expect(parseDelta('not json', 'content')).toBe('');
  });

  it('coerces non-string values to string (numbers, booleans)', () => {
    expect(parseDelta(JSON.stringify({ n: 42 }), 'n')).toBe('42');
    expect(parseDelta(JSON.stringify({ b: true }), 'b')).toBe('true');
  });
});

/** Build a mock ReadableStream that emits the given UTF-8 chunks then closes. */
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/** Build a mock ReadableStream that never closes (for timeout tests). */
function makeHangingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start() { /* never close */ },
    pull() { /* never resolve — hangs until aborted */ },
  });
}

describe('processChatStream abort + timeout (T9: ③+④ cancellation)', () => {
  it('exports WEB_SESSION_TIMEOUT_MS = 60_000', () => {
    expect(WEB_SESSION_TIMEOUT_MS).toBe(60_000);
  });

  it('aborts when external AbortSignal is triggered mid-stream', async () => {
    const stream = makeHangingStream();
    const ac = new AbortController();
    const emitted: any[] = [];
    const p = processChatStream(
      stream,
      { providerId: 'glm', endpoint: 'x', bodyTemplate: '{}', streamFormat: 'sse', endSignal: '[DONE]', deltaPath: 'content' },
      (m) => emitted.push(m),
      { abortSignal: ac.signal },
    );
    // Give the stream loop a moment to start, then abort
    await new Promise(r => setTimeout(r, 10));
    ac.abort(new Error('user stopped'));
    await p;
    // Should emit WEB_LLM_ERROR with the abort reason
    const error = emitted.find(m => m.type === 'WEB_LLM_ERROR');
    expect(error).toBeDefined();
    expect(error.error).toMatch(/user stopped|aborted/);
  });

  it('aborts immediately if signal is already aborted before start', async () => {
    const stream = makeHangingStream();
    const ac = new AbortController();
    ac.abort(new Error('pre-aborted'));
    const emitted: any[] = [];
    await processChatStream(
      stream,
      { providerId: 'glm', endpoint: 'x', bodyTemplate: '{}', streamFormat: 'sse', endSignal: '[DONE]', deltaPath: 'content' },
      (m) => emitted.push(m),
      { abortSignal: ac.signal },
    );
    const error = emitted.find(m => m.type === 'WEB_LLM_ERROR');
    expect(error).toBeDefined();
    expect(error.error).toMatch(/pre-aborted/);
  });

  it('times out after custom timeoutMs (no end signal received)', async () => {
    const stream = makeHangingStream();
    const emitted: any[] = [];
    await processChatStream(
      stream,
      { providerId: 'glm', endpoint: 'x', bodyTemplate: '{}', streamFormat: 'sse', endSignal: '[DONE]', deltaPath: 'content' },
      (m) => emitted.push(m),
      { timeoutMs: 50 },
    );
    // Should emit WEB_LLM_ERROR with timeout reason
    const error = emitted.find(m => m.type === 'WEB_LLM_ERROR');
    expect(error).toBeDefined();
    expect(error.error).toMatch(/timeout/i);
  });

  it('processes a complete stream without abort/timeout (happy path)', async () => {
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const emitted: any[] = [];
    await processChatStream(
      stream,
      { providerId: 'glm', endpoint: 'x', bodyTemplate: '{}', streamFormat: 'sse', endSignal: '[DONE]', deltaPath: 'choices.0.delta.content' },
      (m) => emitted.push(m),
    );
    expect(emitted).toEqual([
      { type: 'WEB_LLM_CHUNK', providerId: 'glm', text: 'hello' },
      { type: 'WEB_LLM_DONE', providerId: 'glm' },
    ]);
  });
});

describe('executeChatRequest (⑤.1: 401 detection + error mapping)', () => {
  function makeRequest(overrides: Partial<import('@/lib/ai-config/web-provider-relay').WebProviderChatRequest> = {}): import('@/lib/ai-config/web-provider-relay').WebProviderChatRequest {
    return {
      providerId: 'glm',
      endpoint: 'https://chatglm.cn/api/chat',
      method: 'POST',
      bodyTemplate: '{}',
      streamFormat: 'sse',
      endSignal: 'data: [DONE]',
      deltaPath: 'choices.0.delta.content',
      ...overrides,
    };
  }

  function makeResponse(status: number, body?: ReadableStream<Uint8Array>): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 401 ? 'Unauthorized' : 'Error',
      body: body ?? null,
    } as unknown as Response;
  }

  it('emits WEB_LLM_NEEDS_RELOGIN on 401 response (not WEB_LLM_ERROR)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(makeResponse(401)));
    const emitted: WebProviderRelayMessage[] = [];
    await executeChatRequest(
      fetchFn as any,
      makeRequest(),
      (m: WebProviderRelayMessage) => emitted.push(m),
    );
    const reLogin = emitted.find(m => m.type === WEB_LLM_NEEDS_RELOGIN) as Extract<WebProviderRelayMessage, { type: typeof WEB_LLM_NEEDS_RELOGIN }> | undefined;
    expect(reLogin).toBeDefined();
    expect(reLogin!.providerId).toBe('glm');
    expect(reLogin!.status).toBe(401);
    expect(reLogin!.message).toMatch(/re-login/i);
    // Must NOT also emit a generic error
    expect(emitted.find(m => m.type === 'WEB_LLM_ERROR')).toBeUndefined();
  });

  it('emits WEB_LLM_NEEDS_RELOGIN for both 401 and 403 (expired token / forbidden)', async () => {
    for (const status of [401, 403]) {
      const fetchFn = vi.fn(() => Promise.resolve(makeResponse(status)));
      const emitted: WebProviderRelayMessage[] = [];
      await executeChatRequest(fetchFn as any, makeRequest(), (m: WebProviderRelayMessage) => emitted.push(m));
      expect(emitted.find(m => m.type === WEB_LLM_NEEDS_RELOGIN)).toBeDefined();
    }
  });

  it('emits WEB_LLM_ERROR on other 4xx/5xx (not needs-relogin)', async () => {
    for (const status of [400, 404, 429, 500, 502, 503]) {
      const fetchFn = vi.fn(() => Promise.resolve(makeResponse(status)));
      const emitted: WebProviderRelayMessage[] = [];
      await executeChatRequest(fetchFn as any, makeRequest(), (m: WebProviderRelayMessage) => emitted.push(m));
      const err = emitted.find(m => m.type === 'WEB_LLM_ERROR') as Extract<WebProviderRelayMessage, { type: typeof WEB_LLM_ERROR }> | undefined;
      expect(err, `status ${status} should emit error`).toBeDefined();
      expect(err!.error).toMatch(new RegExp(`HTTP ${status}`));
      expect(emitted.find(m => m.type === WEB_LLM_NEEDS_RELOGIN)).toBeUndefined();
    }
  });

  it('emits WEB_LLM_ERROR on network failure (fetch throws)', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('NetworkError: offline')));
    const emitted: WebProviderRelayMessage[] = [];
    await executeChatRequest(fetchFn as any, makeRequest(), (m: WebProviderRelayMessage) => emitted.push(m));
    const err = emitted.find(m => m.type === 'WEB_LLM_ERROR') as Extract<WebProviderRelayMessage, { type: typeof WEB_LLM_ERROR }> | undefined;
    expect(err).toBeDefined();
    expect(err!.error).toMatch(/NetworkError/);
  });

  it('emits WEB_LLM_ERROR when response has no body (200 but body=null)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(makeResponse(200, undefined as any)));
    const emitted: WebProviderRelayMessage[] = [];
    await executeChatRequest(fetchFn as any, makeRequest(), (m: WebProviderRelayMessage) => emitted.push(m));
    const err = emitted.find(m => m.type === 'WEB_LLM_ERROR') as Extract<WebProviderRelayMessage, { type: typeof WEB_LLM_ERROR }> | undefined;
    expect(err).toBeDefined();
    expect(err!.error).toMatch(/no body/);
  });

  it('happy path: 200 with SSE stream → chunks + done via processChatStream', async () => {
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const fetchFn = vi.fn(() => Promise.resolve(makeResponse(200, stream)));
    const emitted: WebProviderRelayMessage[] = [];
    await executeChatRequest(fetchFn as any, makeRequest(), (m: WebProviderRelayMessage) => emitted.push(m));
    expect(emitted.map(m => m.type)).toEqual([
      'WEB_LLM_CHUNK',
      'WEB_LLM_DONE',
    ]);
  });

  it('passes request body, method, and headers to fetch()', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(makeResponse(500)));
    await executeChatRequest(
      fetchFn as any,
      makeRequest({ endpoint: 'https://example.com/x', bodyTemplate: '{"k":"v"}' }),
      () => {},
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/x',
      expect.objectContaining({
        method: 'POST',
        body: '{"k":"v"}',
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });
});
});
