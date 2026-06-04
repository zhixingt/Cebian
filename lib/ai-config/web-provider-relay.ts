/**
 * ③+④ T6 — Tab registry for the network relay.
 *
 * Why a registry:
 *   - Web session chat requires a real tab (CORS + first-party cookies)
 *   - Opening a fresh tab for every chat is wasteful (page load, JS init, cookie rotation)
 *   - One tab per provider, reused across requests
 *   - Auto-close after 5min idle (chromeclaw pattern) to free resources
 *
 * This is the foundation; T7 adds injectScripts, T8 adds SSE parsing, T9 adds abort/timeout.
 *
 * Note: T6 is the *registry* layer. The actual fetch happens in the injected content scripts
 * (T7-T8), which postMessage back to the SW where runWebSessionStream (T10) consumes the stream.
 */

import type { WebProvider } from '../types';

const TAB_IDLE_CLOSE_MS = 5 * 60 * 1000;  // 5 minutes
/** Default timeout for a single chat stream (no end signal = stall = abort). */
export const WEB_SESSION_TIMEOUT_MS = 60_000;

export interface TabRegistryConfig {
  /** Override the idle close timeout. Production: 5min. Tests: small values. */
  idleCloseMs: number;
}

interface TabEntry {
  tabId: number;
  openedAt: number;
  lastUsedAt: number;
  /** setTimeout handle for the auto-close; null only briefly during construction */
  closeTimerId: ReturnType<typeof setTimeout>;
}

export class TabRegistry {
  private tabs = new Map<WebProvider['presetId'], TabEntry>();

  constructor(private config: TabRegistryConfig = { idleCloseMs: TAB_IDLE_CLOSE_MS }) {}

  /**
   * Get or open a tab for the given provider.
   *
   * Lookup order (chromeclaw pattern):
   *   1. In-memory registry (fast path — we already have a tab)
   *   2. Chrome tab query by hostname (cold-start path — user may have the provider open)
   *   3. chrome.tabs.create (last resort)
   *
   * @returns tabId
   */
  async openOrReuseTab(
    providerId: WebProvider['presetId'],
    url: string,
  ): Promise<number> {
    // 1. Registry hit
    const existing = this.tabs.get(providerId);
    if (existing) {
      this.markUsed(providerId);
      return existing.tabId;
    }

    // 2. Cold-start: check Chrome for an existing tab at the same hostname
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL for provider ${providerId}: ${url}`);
    }
    const pattern = `*://${parsed.hostname}/*`;
    const chromeTabs = await chrome.tabs.query({ url: pattern });
    if (chromeTabs.length > 0) {
      const tabId = chromeTabs[0].id!;
      this.tabs.set(providerId, this.createEntry(providerId, tabId));
      return tabId;
    }

    // 3. Cold-start: open new tab (active=false — don't disturb user's focus)
    const tab = await chrome.tabs.create({ url, active: false });
    this.tabs.set(providerId, this.createEntry(providerId, tab.id!));
    return tab.id!;
  }

  /**
   * Reset the idle timer for a provider's tab. Call this on every successful
   * stream chunk / message so the tab stays alive while in active use.
   */
  markUsed(providerId: WebProvider['presetId']): void {
    const entry = this.tabs.get(providerId);
    if (!entry) return;
    entry.lastUsedAt = Date.now();
    clearTimeout(entry.closeTimerId);
    entry.closeTimerId = setTimeout(
      () => { void this.closeTab(providerId); },
      this.config.idleCloseMs,
    );
  }

  /**
   * Manually close a tab and clear registry state. Idempotent.
   * Swallows chrome.tabs.remove errors (tab may already be closed).
   */
  async closeTab(providerId: WebProvider['presetId']): Promise<void> {
    const entry = this.tabs.get(providerId);
    if (!entry) return;
    clearTimeout(entry.closeTimerId);
    try {
      await chrome.tabs.remove(entry.tabId);
    } catch {
      // Tab may already be closed (user closed it, SW restarted, etc.)
    }
    this.tabs.delete(providerId);
  }

  /**
   * Get the current tabId for a provider, or undefined if no tab is open.
   */
  getTab(providerId: WebProvider['presetId']): number | undefined {
    return this.tabs.get(providerId)?.tabId;
  }

  /**
   * Test-only: clear all state. Use in vitest beforeEach.
   */
  clearAll(): void {
    for (const [pid, entry] of this.tabs) {
      clearTimeout(entry.closeTimerId);
    }
    this.tabs.clear();
  }

  private createEntry(providerId: WebProvider['presetId'], tabId: number): TabEntry {
    const now = Date.now();
    return {
      tabId,
      openedAt: now,
      lastUsedAt: now,
      closeTimerId: setTimeout(
        () => { void this.closeTab(providerId); },
        this.config.idleCloseMs,
      ),
    };
  }
}

// ===== Singleton =====

let _instance: TabRegistry | null = null;
let _singletonConfig: TabRegistryConfig = { idleCloseMs: TAB_IDLE_CLOSE_MS };

export function getTabRegistry(): TabRegistry {
  if (!_instance) {
    _instance = new TabRegistry(_singletonConfig);
  }
  return _instance;
}

// ===== Test-only hooks =====

/**
 * Test-only: reset the singleton with an optional config override.
 * Use in vitest beforeEach; pass {idleCloseMs: 100} for fast auto-close tests.
 */
export function _resetTabRegistryForTesting(config?: TabRegistryConfig): void {
  if (_instance) {
    _instance.clearAll();
  }
  _instance = null;
  _singletonConfig = config ?? { idleCloseMs: TAB_IDLE_CLOSE_MS };
}

/**
 * Test-only: get the internal TabEntry for a provider (exposes lastUsedAt + closeTimerId).
 * Use to assert markUsed reset behavior.
 */
export function _getTabEntryForTesting(
  registry: TabRegistry,
  providerId: WebProvider['presetId'],
): TabEntry | undefined {
  // Access private field via type assertion (test-only)
  return (registry as unknown as { tabs: Map<WebProvider['presetId'], TabEntry> }).tabs.get(providerId);
}

/**
 * Test-only: force a known lastUsedAt value on a tab entry.
 * Use to avoid Date.now() resolution issues in tests that assert markUsed updates lastUsedAt.
 */
export function _setLastUsedAtForTesting(
  registry: TabRegistry,
  providerId: WebProvider['presetId'],
  ms: number,
): void {
  const entry = (registry as unknown as { tabs: Map<WebProvider['presetId'], TabEntry> }).tabs.get(providerId);
  if (entry) entry.lastUsedAt = ms;
}

// ====================================================================
// T7: Script injection + message contract
// ====================================================================

/**
 * Message types for the MAIN → ISOLATED → SW pipeline.
 * String constants are exported so the injected scripts (which are stringified)
 * and the SW listener (typed TS) share the same source of truth.
 */
export const WEB_LLM_RELAY_READY = 'WEB_LLM_RELAY_READY' as const;
export const WEB_LLM_CHUNK = 'WEB_LLM_CHUNK' as const;
export const WEB_LLM_DONE = 'WEB_LLM_DONE' as const;
export const WEB_LLM_ERROR = 'WEB_LLM_ERROR' as const;
export const WEB_LLM_NEEDS_RELOGIN = 'WEB_LLM_NEEDS_RELOGIN' as const;
// ⑥: tool-call events (defensive — only emitted if a provider's LLM
// emits `delta.tool_calls` in the stream; see processChatStream)
export const WEB_LLM_TOOLCALL_START = 'WEB_LLM_TOOLCALL_START' as const;
export const WEB_LLM_TOOLCALL_DELTA = 'WEB_LLM_TOOLCALL_DELTA' as const;
export const WEB_LLM_TOOLCALL_END = 'WEB_LLM_TOOLCALL_END' as const;

/**
 * Discriminated union of all messages the injected content scripts can send
 * to the SW via chrome.runtime.sendMessage. SW listener narrows on .type.
 */
export type WebProviderRelayMessage =
  | { type: typeof WEB_LLM_RELAY_READY; providerId: WebProvider['presetId'] }
  | { type: typeof WEB_LLM_CHUNK; providerId: WebProvider['presetId']; text: string; reasoning?: string }
  | { type: typeof WEB_LLM_DONE; providerId: WebProvider['presetId']; stopReason?: string }
  | { type: typeof WEB_LLM_ERROR; providerId: WebProvider['presetId']; error: string }
  | { type: typeof WEB_LLM_NEEDS_RELOGIN; providerId: WebProvider['presetId']; status: 401 | 403; message: string }
  | { type: typeof WEB_LLM_TOOLCALL_START; providerId: WebProvider['presetId']; contentIndex: number; toolCall: { type: 'toolCall'; id: string; name: string } }
  | { type: typeof WEB_LLM_TOOLCALL_DELTA; providerId: WebProvider['presetId']; contentIndex: number; delta: string }
  | { type: typeof WEB_LLM_TOOLCALL_END; providerId: WebProvider['presetId']; contentIndex: number; toolCall: { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> } };

/**
 * Chat request payload passed from the SW to the MAIN-world fetcher.
 * The MAIN script serializes this for the provider's chat endpoint.
 */
export interface WebProviderChatRequest {
  providerId: WebProvider['presetId'];
  endpoint: string;
  /** Optional HTTP method (defaults to POST) */
  method?: 'POST' | 'GET';
  bodyTemplate: string;
  streamFormat: 'sse' | 'jsonl';
  endSignal: string;
  deltaPath: string;
  reasoningPath?: string;
  stopReasonPath?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * Inject the relay scripts (ISOLATED bridge + MAIN fetcher) into a tab.
 *
 * Order matters: ISOLATED must run first so it can register the
 * `window.postMessage` listener before MAIN starts emitting.
 *
 * @param tabId - the Chrome tab to inject into
 * @param request - the chat request to send to the MAIN-world fetcher
 * @returns the ISOLATED injection result (used to confirm bridge is up)
 */
export async function injectRelayScripts(
  tabId: number,
  request: WebProviderChatRequest,
): Promise<unknown> {
  // 1. ISOLATED world: install the bridge that forwards window.postMessage
  //    from the page context (MAIN) to the SW via chrome.runtime.sendMessage.
  const isolatedResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: installIsolatedBridge,
    args: [request.providerId],
  });

  // 2. MAIN world: install the page-context fetcher that does the actual
  //    chat request (with first-party cookies) and postMessages results
  //    back to the ISOLATED bridge.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: runMainFetcher,
    args: [request],
  });

  return isolatedResult;
}

/**
 * ISOLATED-world bridge. Registered once per chat session per tab.
 * Listens for window.postMessage from the page context and forwards
 * to the SW via chrome.runtime.sendMessage.
 *
 * Stringified and executed via chrome.scripting.executeScript; must be
 * self-contained (no closure references to outer scope).
 */
function installIsolatedBridge(providerId: string): void {
  // Idempotent: don't double-register on re-injection
  const w = window as unknown as { __cebWebProviderBridge?: { providerId: string } };
  if (w.__cebWebProviderBridge?.providerId === providerId) return;

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'ceb-web-provider-main') return;
    if (data.providerId !== providerId) return;
    // Forward to SW
    chrome.runtime.sendMessage(data.payload).catch((err) => {
      console.warn('[ceb-web-provider-bridge] sendMessage failed:', err);
    });
  });

  w.__cebWebProviderBridge = { providerId };

  // Tell SW the bridge is up
  chrome.runtime.sendMessage({
    type: 'WEB_LLM_RELAY_READY',
    providerId,
  }).catch(() => { /* SW may not be ready; harmless */ });
}

/**
 * MAIN-world fetcher. Runs the actual chat request with first-party cookies.
 * Streams chunks back to the ISOLATED bridge via window.postMessage.
 *
 * Stringified and executed via chrome.scripting.executeScript; must be
 * self-contained (no closure references to outer scope).
 *
 * T8 implementation: real fetch + SSE parsing + delta extraction.
 * ⑤.1 enhancement: 401/403 → WEB_LLM_NEEDS_RELOGIN (not generic error).
 */
async function runMainFetcher(request: WebProviderChatRequest): Promise<void> {
  return executeChatRequest(
    // Bind fetch to the page context (window.fetch), not the SW context.
    // The MAIN-world script runs in the page's realm; fetch there picks up
    // the page's cookies automatically.
    fetch.bind(window),
    request,
    (payload) => {
      window.postMessage({
        source: 'ceb-web-provider-main',
        providerId: request.providerId,
        payload,
      }, '*');
    },
  );
}

/**
 * Execute a chat request and emit relay messages. Pure-ish:
 *   - Takes a fetch function (testable with mocks; prod uses page fetch)
 *   - Takes a postMessage-like callback (testable spy; prod uses window.postMessage)
 *   - Returns when the stream is done or an error/relogin is emitted
 *
 * Error mapping (⑤.1):
 *   - 401 or 403 → WEB_LLM_NEEDS_RELOGIN (user must re-login via Settings)
 *   - Other non-2xx → WEB_LLM_ERROR with HTTP status
 *   - Network failure → WEB_LLM_ERROR with original message
 *   - 200 with null body → WEB_LLM_ERROR 'Response has no body'
 *   - 200 with valid body → processChatStream (CHUNK / DONE / ERROR as parsed)
 */
export async function executeChatRequest(
  fetchFn: typeof fetch,
  request: WebProviderChatRequest,
  postMessage: (msg: WebProviderRelayMessage) => void,
): Promise<void> {
  try {
    const response = await fetchFn(request.endpoint, {
      method: request.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.extraHeaders ?? {}),
      },
      body: request.bodyTemplate,
      credentials: 'include',  // first-party cookies
    });

    // ⑤.1: 401/403 → needs-relogin (more specific than generic error)
    if (response.status === 401 || response.status === 403) {
      const message = `Provider rejected the session (HTTP ${response.status}). ` +
        `Please re-login to ${request.providerId} via Settings → Web Providers.`;
      postMessage({
        type: WEB_LLM_NEEDS_RELOGIN,
        providerId: request.providerId,
        status: response.status as 401 | 403,
        message,
      });
      return;
    }

    if (!response.ok) {
      postMessage({
        type: WEB_LLM_ERROR,
        providerId: request.providerId,
        error: `HTTP ${response.status} ${response.statusText}`,
      });
      return;
    }
    if (!response.body) {
      postMessage({
        type: WEB_LLM_ERROR,
        providerId: request.providerId,
        error: 'Response has no body',
      });
      return;
    }

    await processChatStream(response.body, request, postMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({
      type: WEB_LLM_ERROR,
      providerId: request.providerId,
      error: message,
    });
  }
}

/**
 * Options for processChatStream (T9: cancellation + timeout).
 */
export interface ProcessChatStreamOptions {
  /** External abort signal — aborting this stops the stream and emits WEB_LLM_ERROR */
  abortSignal?: AbortSignal;
  /** Stream timeout in ms (default 60s). Fires the internal abort if no end signal seen. */
  timeoutMs?: number;
}

/**
 * Process a streaming response body, parsing SSE frames and emitting relay messages.
 *
 * Pure-ish: takes a ReadableStream, a chat request config, and an emit callback.
 * The MAIN-world fetcher wraps this with window.postMessage; tests can pass a mock
 * stream + a spy emit.
 *
 * Cancellation (T9):
 *   - abortSignal: externally triggered (e.g., user clicks Stop)
 *   - timeoutMs: fires internal abort if no end signal seen in this window
 * Both paths emit WEB_LLM_ERROR with the reason and release the reader lock.
 */
export async function processChatStream(
  body: ReadableStream<Uint8Array>,
  request: WebProviderChatRequest,
  emit: (msg: WebProviderRelayMessage) => void,
  options: ProcessChatStreamOptions = {},
): Promise<void> {
  const { abortSignal: externalSignal, timeoutMs = WEB_SESSION_TIMEOUT_MS } = options;

  // Internal controller: linked to external signal + timeout
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let abortReason: string | undefined;

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortReason = externalSignal.reason instanceof Error
        ? externalSignal.reason.message
        : String(externalSignal.reason ?? 'aborted');
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => {
        abortReason = externalSignal.reason instanceof Error
          ? externalSignal.reason.message
          : String(externalSignal.reason ?? 'aborted');
        controller.abort();
      }, { once: true });
    }
  }
  timeoutId = setTimeout(() => {
    timedOut = true;
    abortReason = `Stream timeout after ${timeoutMs}ms (no end signal received)`;
    controller.abort();
  }, timeoutMs);

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let doneEmitted = false;

  // ⑥: track in-flight tool calls across chunks. OpenAI streaming sends
  // tool_calls as an array per chunk, where each entry has an `index`
  // and partial `function.arguments` (concatenated to form the final JSON).
  // We accumulate, emit start on first id+name, delta for each args
  // fragment, end on finish_reason=tool_calls OR on EOF.
  interface ToolCallTracker {
    id?: string;
    name?: string;
    argsBuffer: string;
    startEmitted: boolean;
    endEmitted: boolean;
  }
  const toolCalls = new Map<number, ToolCallTracker>();

  /** Emit end events for any in-flight tool calls that haven't been ended yet. */
  const flushToolCallEnds = () => {
    for (const [idx, entry] of toolCalls) {
      if (entry.endEmitted) continue;
      if (!entry.id || !entry.name) continue;  // malformed, skip
      let parsedArgs: Record<string, unknown> = {};
      try { parsedArgs = JSON.parse(entry.argsBuffer); } catch { /* leave empty */ }
      emit({
        type: WEB_LLM_TOOLCALL_END,
        providerId: request.providerId,
        contentIndex: idx,
        toolCall: { type: 'toolCall', id: entry.id, name: entry.name, arguments: parsedArgs },
      });
      entry.endEmitted = true;
    }
  };

  try {
    while (!controller.signal.aborted) {
      // Race reader.read() against the abort signal so a hanging stream
      // doesn't block cancellation (reader.read() has no native AbortSignal support).
      const readPromise = reader.read();
      let abortHandler: (() => void) | undefined;
      const abortPromise = new Promise<{ __aborted: true }>((resolve) => {
        abortHandler = () => resolve({ __aborted: true });
        if (controller.signal.aborted) {
          resolve({ __aborted: true });
        } else {
          controller.signal.addEventListener('abort', abortHandler, { once: true });
        }
      });
      const result = await Promise.race([readPromise, abortPromise]);
      if (abortHandler) controller.signal.removeEventListener('abort', abortHandler);

      if ('__aborted' in result) break;

      const { value, done } = result as ReadableStreamReadResult<Uint8Array>;
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const { events, rest } = parseSseFrames(buffer, chunk);
      buffer = rest;

      for (const event of events) {
        // End signal check (e.g., 'data: [DONE]\n\n')
        if (event.data.trim() === request.endSignal) {
          // ⑥: flush any in-flight tool-call ends before declaring done
          flushToolCallEnds();
          emit({ type: WEB_LLM_DONE, providerId: request.providerId });
          doneEmitted = true;
          controller.abort();  // stop the loop
          break;
        }
        // Try to extract delta
        const text = parseDelta(event.data, request.deltaPath);
        if (text) {
          const reasoning = request.reasoningPath
            ? parseDelta(event.data, request.reasoningPath)
            : undefined;
          emit({
            type: WEB_LLM_CHUNK,
            providerId: request.providerId,
            text,
            ...(reasoning ? { reasoning } : {}),
          });
        }
        // Check for stop reason (optional)
        if (request.stopReasonPath) {
          const stopReason = parseDelta(event.data, request.stopReasonPath);
          if (stopReason) {
            // ⑥: flush tool-call ends if finish_reason signals tool use
            if (stopReason === 'tool_calls') flushToolCallEnds();
            emit({
              type: WEB_LLM_DONE,
              providerId: request.providerId,
              stopReason,
            });
            doneEmitted = true;
            controller.abort();
            break;
          }
        }
        // ⑥: tool-call extraction. Parse event.data as JSON and look for
        // choices[0].delta.tool_calls. Track by index across chunks; emit
        // start/delta as fields arrive; end on finish_reason=tool_calls
        // (handled above) or on data:[DONE] (handled at loop top).
        let parsed: any = null;
        try { parsed = JSON.parse(event.data); } catch { /* not JSON, skip */ }
        const toolCallsDelta = parsed?.choices?.[0]?.delta?.tool_calls;
        if (Array.isArray(toolCallsDelta)) {
          for (const tc of toolCallsDelta) {
            const idx: number = typeof tc?.index === 'number' ? tc.index : 0;
            let entry = toolCalls.get(idx);
            if (!entry) {
              entry = { argsBuffer: '', startEmitted: false, endEmitted: false };
              toolCalls.set(idx, entry);
            }
            if (typeof tc?.id === 'string') entry.id = tc.id;
            if (typeof tc?.function?.name === 'string') entry.name = tc.function.name;
            if (typeof tc?.function?.arguments === 'string') {
              entry.argsBuffer += tc.function.arguments;
            }
            // Emit start on first appearance of id+name
            if (!entry.startEmitted && entry.id && entry.name) {
              entry.startEmitted = true;
              emit({
                type: WEB_LLM_TOOLCALL_START,
                providerId: request.providerId,
                contentIndex: idx,
                toolCall: { type: 'toolCall', id: entry.id, name: entry.name },
              });
            }
            // Emit delta for each args fragment (so the agent can stream-parse JSON)
            if (typeof tc?.function?.arguments === 'string' && tc.function.arguments.length > 0) {
              emit({
                type: WEB_LLM_TOOLCALL_DELTA,
                providerId: request.providerId,
                contentIndex: idx,
                delta: tc.function.arguments,
              });
            }
          }
        }
      }
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    try { reader.releaseLock(); } catch { /* already released */ }
    // ⑥: ensure in-flight tool calls are ended even if stream was cut off
    // abruptly (timeout, abort, network drop) without a finish_reason or
    // data:[DONE] sentinel. Without this, a half-built tool call would
    // leak in the agent's state.
    flushToolCallEnds();
  }

  // Emit error if aborted (and we didn't already emit DONE)
  if (controller.signal.aborted && !doneEmitted) {
    const message = timedOut
      ? abortReason ?? 'Stream timeout'
      : abortReason ?? 'Stream aborted';
    emit({ type: WEB_LLM_ERROR, providerId: request.providerId, error: message });
    return;
  }

  // Normal end: emit DONE if not already (some providers don't send [DONE])
  if (!doneEmitted) {
    emit({ type: WEB_LLM_DONE, providerId: request.providerId });
  }
}

// ====================================================================
// T8: Pure SSE parser + delta extractor (testable in isolation)
// ====================================================================

/** A single SSE event extracted from a stream chunk. */
export interface SseEvent {
  /** Optional event type from `event: foo` line */
  event?: string;
  /** Data payload from one or more `data: ...` lines (joined with \n) */
  data: string;
  /** Optional id from `id: ...` line */
  id?: string;
}

/**
 * Parse SSE frames from a streaming chunk.
 *
 * Buffers partial frames across calls: a frame split across two chunks
 * (e.g., 'data: {"a":' then '1}\n\n') is reassembled before being returned.
 *
 * Format reminder (https://html.spec.whatwg.org/multipage/server-sent-events.html):
 *   - Lines starting with `:` are comments (ignored)
 *   - `field: value` sets a field; `field` alone is `field: true`
 *   - Blank line dispatches the event
 *   - Multi-line `data:` is joined with \n
 *
 * @param buffer - incomplete tail from previous call (or '' for first call)
 * @param chunk  - new text from the stream
 * @returns parsed events + remaining buffer (incomplete tail for next call)
 */
export function parseSseFrames(buffer: string, chunk: string): { events: SseEvent[]; rest: string } {
  const combined = buffer + chunk;
  // Normalize line endings
  const normalized = combined.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Split into "lines" but keep blank lines as event separators
  const lines = normalized.split('\n');

  const events: SseEvent[] = [];
  let currentEvent: string | undefined;
  let currentId: string | undefined;
  let dataLines: string[] = [];
  let hasField = false;
  /** Index in `lines` of the last blank line that dispatched an event.
   *  Everything after this index is "rest" (incomplete tail for next call). */
  let lastBlankLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      // Blank line = event separator
      if (hasField) {
        const event: SseEvent = { data: dataLines.join('\n') };
        if (currentEvent !== undefined) event.event = currentEvent;
        if (currentId !== undefined) event.id = currentId;
        events.push(event);
        currentEvent = undefined;
        currentId = undefined;
        dataLines = [];
        hasField = false;
      }
      lastBlankLineIdx = i;
      continue;
    }
    if (line.startsWith(':')) {
      // Comment — ignore
      continue;
    }
    const colonIdx = line.indexOf(':');
    let field: string;
    let value: string;
    if (colonIdx === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colonIdx);
      // Per spec, strip a single leading space after the colon
      value = colonIdx + 1 < line.length && line[colonIdx + 1] === ' '
        ? line.slice(colonIdx + 2)
        : line.slice(colonIdx + 1);
    }
    if (field === 'data') {
      dataLines.push(value);
      hasField = true;
    } else if (field === 'event') {
      currentEvent = value;
      hasField = true;
    } else if (field === 'id') {
      currentId = value;
      hasField = true;
    }
    // Other fields (retry, etc.) are ignored
  }

  // "rest" = text from after the last dispatched blank line to the end
  // This handles 3 cases:
  //   1. No blank line yet → all text is rest
  //   2. Blank line at the end → rest is '' (everything was dispatched)
  //   3. Blank line in the middle → rest is the tail after it
  let rest = '';
  if (lastBlankLineIdx < lines.length - 1) {
    // There are lines after the last blank line — these are the incomplete tail
    rest = lines.slice(lastBlankLineIdx + 1).join('\n');
  }

  return { events, rest };
}

/**
 * Extract a string value from a JSON payload using dot-notation path.
 *
 * Path syntax: 'choices.0.delta.content' navigates
 *   parsed.choices[0].delta.content
 *
 * Array indices are numeric; other segments are property names.
 *
 * @returns the value coerced to string, or '' for missing/invalid paths
 */
export function parseDelta(json: string, path: string): string {
  if (!json || !path) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return '';
  }
  const segments = path.split('.');
  let cur: unknown = parsed;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return '';
    // Array index?
    if (/^\d+$/.test(seg)) {
      const idx = parseInt(seg, 10);
      if (!Array.isArray(cur) || idx >= cur.length) return '';
      cur = cur[idx];
    } else {
      if (typeof cur !== 'object') return '';
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  if (cur === null || cur === undefined) return '';
  if (typeof cur === 'string') return cur;
  return String(cur);
}
