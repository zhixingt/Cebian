/**
 * ⑧: pi-ai stream function for web session providers (DOM-injection).
 *
 * Registers a custom api kind 'web-session' with pi-ai's ApiProvider registry.
 * When the agent (or ModelSelector) selects a Model<'web-session'>, pi-ai
 * dispatches to this stream function, which orchestrates the DOM-injection
 * relay into the provider's tab.
 *
 * Flow (called by pi-ai's complete()/stream()):
 *   1. Parse model.id → { providerId, modelId }
 *   2. Look up the preset to get domStrategy
 *   3. Resolve the cookie bundle (decrypted, cached) — validates login
 *   4. Build the DOM relay request (text + strategy)
 *   5. Open/reuse a tab via TabRegistry
 *   6. Inject ISOLATED bridge + MAIN orchestrator scripts
 *   7. Listen for messages from the tab (via deps.onMessage)
 *   8. Push pi-ai events to the returned AssistantMessageEventStream
 *   9. On abort/timeout/error → push error event
 *
 * ⑧: Replaces the old HTTP-replay flow (buildChatRequest with bodyTemplate
 * substitution, etc.). The new flow just sends a text message to the tab
 * and polls the DOM for the reply — no HTTP fetch, no SSE parsing.
 *
 * Testability: dependencies (openTab, injectScripts, onMessage, resolveBundle, presets)
 * are injected via WebSessionStreamDeps. Production uses the real chrome.* wrappers
 * from web-provider-relay; tests pass mocks.
 */

import {
  createAssistantMessageEventStream,
  registerApiProvider,
  type Model,
  type StreamFunction,
  type AssistantMessageEventStream,
  type Context,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { resolveBundle as defaultResolveBundle } from './web-provider-bundle';
import { getTabRegistry, injectDomRelay, getAuthHeadersForProvider } from './web-provider-relay';
import {
  WEB_LLM_CHUNK,
  WEB_LLM_CONVERSATION_UPDATE,
  WEB_LLM_DONE,
  WEB_LLM_ERROR,
  WEB_LLM_RELAY_READY,
  WEB_LLM_NEEDS_RELOGIN,
  type WebProviderRelayMessage,
} from './web-provider-relay';
import { getConversation, setConversation } from './web-provider-conversations';
import { diag, diagError, diagWarn } from './web-provider-diag';
import { serializeCrossProviderHistory } from './web-provider-cross-context';
import { WEB_PROVIDER_PRESETS, type WebProviderPreset } from './web-provider-presets';
// ⑪: Import per-provider content-fetch adapters so the bundler retains
// their function bodies (chromeclaw-style HTTP-replay path). The export
// `defaultMainWorldFetchByProvider` wires them up for the default deps.
import { deepseekMainWorldFetch } from './web-provider-content-fetch-deepseek';
import { glmMainWorldFetch } from './web-provider-content-fetch-glm';
import type { ContentFetchRequest } from './web-provider-content-fetch-main';
import type { WebProvider } from '../types';
import type { DomRelayRequest } from './web-provider-content-script';

/** pi-ai sourceId for our custom provider. Used by unregisterApiProviders(). */
export const WEB_SESSION_SOURCE_ID = 'cebian-web-provider';

/** Web session api kind — matches the value used when calling registerApiProvider. */
export const WEB_SESSION_API = 'web-session' as const;

/**
 * Dependencies injected into the stream function.
 * Production wires these to the real chrome.* APIs (see defaultWebSessionStreamDeps).
 * Tests pass mocks.
 */
export interface WebSessionStreamDeps {
  /** Open or reuse a Chrome tab for the provider. Returns the tabId. */
  openTab: (providerId: WebProvider['presetId'], url: string) => Promise<number>;
  /**
   * ⑪: Per-provider MAIN-world fetch function. If provided for the
   * resolved providerId, the orchestrator takes the content-fetch path
   * (chromeclaw-style HTTP-replay). If absent for a provider, fall back
   * to the legacy DOM-relay path (injectScripts below).
   */
  mainWorldFetchByProvider?: Partial<
    Record<WebProvider['presetId'], { request: unknown; func: (request: unknown) => Promise<void> }>
  >;
  /**
   * ⑪.7: Read HttpOnly cookies the SW can see (via `chrome.cookies.getAll`)
   * and return an Authorization header value (e.g. `'Bearer <jwt>'`) or
   * `null` if no auth cookie is available. Used to pass HttpOnly tokens
   * (Kimi's `kimi-auth`) to the MAIN-world adapter as `request.authHeader`.
   */
  getAuthHeaders: (providerId: WebProvider['presetId']) => Promise<string | null>;
  /** Inject the DOM relay scripts (ISOLATED bridge + MAIN orchestrator) into a tab. */
  injectScripts: (tabId: number, request: DomRelayRequest) => Promise<unknown>;
  /** Register a chrome.runtime.onMessage handler; returns an unregister function. */
  onMessage: (handler: (msg: WebProviderRelayMessage) => void) => () => void;
  /** Resolve the decrypted cookie bundle for a provider. */
  resolveBundle: (providerId: WebProvider['presetId']) => Promise<Record<string, string> | null>;
  /** Built-in presets (or test override). */
  presets: typeof WEB_PROVIDER_PRESETS;
}

/**
 * Production default dependencies. Wires to the real chrome.* wrappers.
 * Lazy-initialized to avoid loading chrome.* at import time (e.g., in tests).
 */
let _defaultDeps: WebSessionStreamDeps | null = null;

/**
 * ⑪: Default per-provider content-fetch handlers. The adapter functions
 * are referenced here so the bundler can't tree-shake them; the SW picks
 * one of these at runtime based on the resolved providerId.
 */
export const defaultMainWorldFetchByProvider: WebSessionStreamDeps['mainWorldFetchByProvider'] = {
  deepseek: {
    request: { type: 'WEB_LLM_FETCH' } as unknown as object,
    func: deepseekMainWorldFetch as unknown as (request: unknown) => Promise<void>,
  },
  glm: {
    request: { type: 'WEB_LLM_FETCH' } as unknown as object,
    func: glmMainWorldFetch as unknown as (request: unknown) => Promise<void>,
  },
};

function getDefaultDeps(): WebSessionStreamDeps {
  if (_defaultDeps) return _defaultDeps;
  _defaultDeps = {
    openTab: async (providerId, url) => {
      const tabId = await getTabRegistry().openOrReuseTab(providerId, url);
      getTabRegistry().markUsed(providerId);
      return tabId;
    },
    mainWorldFetchByProvider: defaultMainWorldFetchByProvider,
    getAuthHeaders: (providerId) => getAuthHeadersForProvider(providerId),
    injectScripts: (tabId, request) => injectDomRelay(tabId, request),
    onMessage: (handler) => {
      const listener = (msg: any) => {
        if (msg && typeof msg === 'object' && typeof msg.type === 'string') {
          handler(msg as WebProviderRelayMessage);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => { chrome.runtime.onMessage.removeListener(listener); };
    },
    resolveBundle: (providerId) => defaultResolveBundle(providerId),
    presets: WEB_PROVIDER_PRESETS,
  };
  return _defaultDeps;
}

/**
 * Parse a web-session model id into its components.
 * Format: `web:<providerId>:<modelId>` (modelId may contain colons)
 *
 * @throws if the id doesn't start with 'web:'
 */
export function parseWebModelId(id: string): { providerId: WebProvider['presetId']; modelId: string } {
  const prefix = 'web:';
  if (!id.startsWith(prefix)) {
    throw new Error(`Invalid web model id (expected 'web:' prefix): ${id}`);
  }
  const rest = id.slice(prefix.length);
  const colonIdx = rest.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(`Invalid web model id (expected '<providerId>:<modelId>'): ${id}`);
  }
  return {
    providerId: rest.slice(0, colonIdx) as WebProvider['presetId'],
    modelId: rest.slice(colonIdx + 1),
  };
}

/**
 * Build a StreamFunction<'web-session'> from the given dependencies.
 * Use this in production (passes defaultDeps) or in tests (passes mocks).
 */
export function buildWebSessionStream(
  deps: WebSessionStreamDeps = getDefaultDeps(),
): StreamFunction<typeof WEB_SESSION_API> {
  return (model, context, options) => {
    return runWebSessionStream(model, context, options, deps);
  };
}

/**
 * Register the web-session provider with pi-ai's ApiProvider registry.
 * Idempotent: calling twice with the same sourceId replaces the previous registration.
 *
 * Call this ONCE at SW startup (see T11).
 */
export function registerWebProviderStream(
  deps: WebSessionStreamDeps = getDefaultDeps(),
): void {
  const stream = buildWebSessionStream(deps);
  registerApiProvider(
    {
      api: WEB_SESSION_API,
      stream: stream as StreamFunction,
      streamSimple: stream as StreamFunction,
    },
    WEB_SESSION_SOURCE_ID,
  );
}

/**
 * Core stream function. Returns an AssistantMessageEventStream immediately;
 * the actual work (tab, inject, listen) happens in the background.
 *
 * Event flow:
 *   - 'start'        → first event, with empty AssistantMessage partial
 *   - 'text_start'   → when first chunk arrives (contentIndex 0)
 *   - 'text_delta'   → for each WEB_LLM_CHUNK from the tab
 *   - 'text_end'     → when stream ends
 *   - 'done'         → terminal event with stop reason
 *   - 'error'        → on WEB_LLM_ERROR from tab, or any thrown exception
 */
function runWebSessionStream(
  model: Model<typeof WEB_SESSION_API>,
  context: Context,
  _options: SimpleStreamOptions | undefined,
  deps: WebSessionStreamDeps,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  // Fire-and-forget orchestration
  void orchestrateStream(model, context, stream, deps).catch((err) => {
    // Defensive: any uncaught error from the orchestrator. This path
    // is reached only when the orchestrator's try/catch failed to push
    // an error event into the stream (e.g. thrown before try/catch
    // wraps the code). Log uncondiionally — surfacing this is more
    // valuable than gating it behind a flag.
    diagError('WS-DIAG', 'uncaught orchestration error', err);
  });

  return stream;
}

async function orchestrateStream(
  model: Model<typeof WEB_SESSION_API>,
  context: Context,
  stream: AssistantMessageEventStream,
  deps: WebSessionStreamDeps,
): Promise<void> {
  let unregisterMsg: (() => void) | null = null;

  // ⑫: DIAGNOSTIC — user flow vs E2E: E2E calls the adapter directly via
  // page.evaluate, bypassing this entire orchestration layer. If GLM/DeepSeek
  // fail in the real extension but pass in E2E, the failure is in one of
  // these steps. Logs go through the diag() gate (⑨.4): silent in
  // production unless the user has enabled `web_provider_debug` in
  // chrome.storage.local. Tagged with [WS-DIAG] for easy filtering.
  const diagStep = (msg: string, extra?: unknown) => diag('WS-DIAG', msg, extra);

  try {
    // 1. Parse model id
    const { providerId, modelId } = parseWebModelId(model.id);
    diagStep(`step 1: parsed modelId`, { providerId, modelId });

    // 2. Look up preset
    const preset = deps.presets.find((p) => p.id === providerId);
    if (!preset) {
      diagStep(`step 2 FAIL: no preset for ${providerId}`);
      throw new Error(`Unknown web provider: ${providerId}`);
    }
    diagStep(`step 2: preset found`, { loginUrl: preset.loginUrl });

    // ⑧: domStrategy is required (replaces old chatApi check)
    if (!preset.domStrategy) {
      diagStep(`step 2 FAIL: no domStrategy for ${providerId}`);
      throw new Error(`Provider ${providerId} has no domStrategy configured`);
    }

    // 3. Resolve bundle (validates login + decryption)
    const bundle = await deps.resolveBundle(providerId);
    if (!bundle) {
      diagStep(`step 3 FAIL: resolveBundle returned null for ${providerId} (not logged in or decryption failed)`);
      throw new Error(`Provider ${providerId} has no valid session — please log in via Settings`);
    }
    diagStep(`step 3: bundle resolved (keys: ${Object.keys(bundle).join(',')})`);

    // 4. Build request(s) and open/reuse tab
    let tabId: number;
    try {
      tabId = await deps.openTab(providerId, preset.loginUrl);
      diagStep(`step 4: tabId=${tabId}`);
    } catch (e) {
      diagStep(`step 4 FAIL: openTab threw`, e);
      throw e;
    }

    // ⑪: Resolve content-fetch handler for this provider. If available, take
    // the chromeclaw-style HTTP-replay path; otherwise fall back to DOM relay.
    const fetchEntry = deps.mainWorldFetchByProvider?.[providerId];
    const useContentFetch = !!fetchEntry;
    const relayRequest: DomRelayRequest | null = useContentFetch
      ? null
      : buildRelayRequest(preset, modelId, context);
    // ⑪.7: Build the full ContentFetchRequest (not the stub in fetchEntry.request).
    // The stub has no init.body or authHeader — the adapter would throw on
    // `init.body` and the HttpOnly `kimi-auth` cookie would be invisible
    // to the MAIN world. We extract the user message from context, fetch
    // the auth header via SW's chrome.cookies.getAll, and pass a complete
    // request the adapter can actually use.
    const fetchRequest: ContentFetchRequest | null = useContentFetch
      ? await buildContentFetchRequest(preset, modelId, context, deps)
      : null;

    // 6. Listen for messages BEFORE injecting (so we don't miss the RELAY_READY)
    let accumulatedText = '';
    const textDone = { value: false };
    unregisterMsg = deps.onMessage((msg) => {
      // ⑫ DIAG: log every message the SW listener receives (regardless of
      // providerId, so we can see messages being dropped or routed)
      diag('WS-DIAG-LISTENER', 'received', msg);
      if (msg.providerId !== providerId) {
        diag(
          'WS-DIAG-LISTENER',
          `DROPPING (providerId mismatch: got ${msg.providerId}, want ${providerId})`,
        );
        return;
      }
      switch (msg.type) {
        case WEB_LLM_CHUNK: {
          // ⑧ (DOM path): msg.text is the FULL text (not delta) because the
          // DOM reader re-reads the whole textContent each poll. Compute
          // delta ourselves.
          // ⑪ (content-fetch path): msg.chunk is a raw SSE `data: ...\n\n`
          // chunk. We accumulate it into accumulatedText and emit the new
          // suffix as the delta (same contract regardless of source).
          if (msg.chunk) {
            accumulatedText += msg.chunk;
            stream.push({
              type: 'text_delta',
              contentIndex: 0,
              delta: msg.chunk,
              partial: makePartial(providerId, modelId, accumulatedText),
            });
            break;
          }
          const newText = msg.text ?? '';
          const delta = newText.startsWith(accumulatedText)
            ? newText.slice(accumulatedText.length)
            : newText;  // reset, send all
          accumulatedText = newText;
          stream.push({
            type: 'text_delta',
            contentIndex: 0,
            delta,
            partial: makePartial(providerId, modelId, accumulatedText),
          });
          break;
        }
        case WEB_LLM_DONE: {
          if (!textDone.value) {
            stream.push({
              type: 'text_end',
              contentIndex: 0,
              content: accumulatedText,
              partial: makePartial(providerId, modelId, accumulatedText),
            });
            textDone.value = true;
          }
          const reason: 'stop' | 'length' | 'toolUse' =
            msg.stopReason === 'length' ? 'length'
            : msg.stopReason === 'tool_use' ? 'toolUse'
            : 'stop';
          stream.push({
            type: 'done',
            reason,
            message: makePartial(providerId, modelId, accumulatedText, reason),
          });
          stream.end();
          break;
        }
        case WEB_LLM_ERROR: {
          stream.push({
            type: 'error',
            reason: 'error',
            error: makePartial(providerId, modelId, accumulatedText, 'error', msg.error),
          });
          stream.end();
          break;
        }
        case WEB_LLM_RELAY_READY: {
          // Informational; the inject just confirmed the bridge is up.
          break;
        }
        case WEB_LLM_NEEDS_RELOGIN: {
          stream.push({
            type: 'error',
            reason: 'error',
            error: makePartial(providerId, modelId, accumulatedText, 'error', msg.message),
          });
          stream.end();
          break;
        }
        case WEB_LLM_CONVERSATION_UPDATE: {
          // ⑨.2: persist the server-issued conversation/parent_message id
          // so the next turn's buildContentFetchRequest can echo it back.
          // Fire-and-forget; a failed Dexie write just means the next
          // turn starts a new session (graceful degradation).
          void setConversation({
            providerId: msg.providerId,
            modelId: msg.modelId,
            ...(msg.conversationId !== undefined ? { conversationId: msg.conversationId } : {}),
            ...(msg.parentMessageId !== undefined ? { parentMessageId: msg.parentMessageId } : {}),
            lastUpdated: Date.now(),
          }).catch((err) => {
            // ⑨.2: log only on failure — keep production console clean
            diagWarn('WS-DIAG', 'failed to persist conversation state', err);
          });
          break;
        }
      }
    });

    // 7. Push 'start' event (now that we're ready to inject)
    stream.push({
      type: 'start',
      partial: makePartial(providerId, modelId, ''),
    });
    // Text content begins after start
    stream.push({
      type: 'text_start',
      contentIndex: 0,
      partial: makePartial(providerId, modelId, ''),
    });

    // 8. Inject (DOM relay vs content-fetch, per provider capability)
    if (useContentFetch) {
      diagStep(`step 8: injecting content-fetch into tabId=${tabId}`);
      try {
        await import('./web-provider-relay').then(({ injectContentFetch }) =>
          injectContentFetch(tabId, providerId, fetchEntry!.func, fetchRequest!),
        );
        diagStep(`step 8: injectContentFetch resolved (adapter invoked in MAIN world)`);
      } catch (e) {
        diagStep(`step 8 FAIL: injectContentFetch threw`, e);
        throw e;
      }
    } else {
      diagStep(`step 8: injecting DOM relay into tabId=${tabId}`);
      await deps.injectScripts(tabId, relayRequest!);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const providerId = (() => {
      try { return parseWebModelId(model.id).providerId; } catch { return 'unknown' as WebProvider['presetId']; }
    })();
    const modelId = (() => {
      try { return parseWebModelId(model.id).modelId; } catch { return 'unknown'; }
    })();
    stream.push({
      type: 'error',
      reason: 'error',
      error: makePartial(providerId, modelId, '', 'error', message),
    });
    stream.end();
  } finally {
    // Don't unregister here — the stream may still be receiving messages.
    // Unregister is called when stream.end() is called or via cleanup hook.
    if (unregisterMsg) {
      // Defer to next tick so any final messages can be processed
      const fn = unregisterMsg;
      unregisterMsg = null;
      setTimeout(fn, 100);
    }
  }
}

/**
 * Build the DomRelayRequest for a given context.
 * ⑧: extracts the user message from the context.messages and combines
 * with the preset's domStrategy. No body template, no auth headers —
 * the tab's existing session does all the work.
 */
function buildRelayRequest(
  preset: WebProviderPreset,
  modelId: string,
  context: Context,
): DomRelayRequest {
  // Extract the last user message (the one we want to send)
  // ⑧: for MVP, only support a single text message. Multi-turn will be
  //     handled in a follow-up (the storage foundation is already in place).
  const lastUserMsg = [...context.messages].reverse().find((m) => m.role === 'user');
  let messageText = '';
  if (lastUserMsg) {
    if (typeof lastUserMsg.content === 'string') {
      messageText = lastUserMsg.content;
    } else {
      // Concatenate text parts; ignore image/file (MVP = text only)
      messageText = lastUserMsg.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
  }

  return {
    providerId: preset.id,
    modelId,
    message: messageText,
    domStrategy: preset.domStrategy,
  };
}

/**
 * ⑪.7: Build the ContentFetchRequest for a given context. Unlike
 * `buildRelayRequest` (which only needs the user message — the DOM
 * does the auth), the content-fetch adapter runs in MAIN world and
 * needs:
 *   1. The user prompt in `init.body` (so the adapter can extract it)
 *   2. The auth header from SW-side `chrome.cookies.getAll` (for
 *      HttpOnly cookies the MAIN world can't see)
 *   3. ⑨.2: the stored conversation id from webProviderConversations
 *      (for DeepSeek's `parent_message_id`, GLM's `conversation_id`)
 *      so the server can keep context across turns.
 *
 * The stub `fetchEntry.request` from the dispatch table has none of
 * these — the adapter would throw on `init.body` and the HttpOnly
 * `kimi-auth` would be invisible. This function builds a complete
 * request the adapter can actually consume.
 */
export async function buildContentFetchRequest(
  preset: WebProviderPreset,
  modelId: string,
  context: Context,
  deps: WebSessionStreamDeps,
): Promise<ContentFetchRequest> {
  // Extract the last user message (same logic as buildRelayRequest)
  const lastUserMsg = [...context.messages].reverse().find((m) => m.role === 'user');
  let messageText = '';
  if (lastUserMsg) {
    if (typeof lastUserMsg.content === 'string') {
      messageText = lastUserMsg.content;
    } else {
      messageText = lastUserMsg.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
  }

  // ⑪.7: Read HttpOnly cookies from the SW (HttpOnly cookies are
  // invisible to MAIN world `document.cookie`). Returns 'Bearer <token>'
  // or null. Adapters that need the token as a Bearer header (Kimi)
  // read it from `request.authHeader`; adapters that read from
  // localStorage or non-HttpOnly cookies (DeepSeek, GLM) ignore it.
  const authHeader = await deps.getAuthHeaders(preset.id);

  // ⑨.2: Read any stored conversation state so the adapter can echo
  // the server-issued id back on the next message. Per-provider body
  // field names differ: DeepSeek uses `parent_message_id`, GLM uses
  // `conversation_id`. We expose both under a single `chatId` field
  // and a `parentMessageId` field; each adapter reads what it needs.
  const stored = await getConversation(preset.id, modelId);
  const chatId = stored?.conversationId ?? '';
  const parentMessageId = stored?.parentMessageId;

  // ⑨.5: Cross-provider context preservation. When this provider
  // has no stored session id (chatId is empty), the user is either
  // starting fresh OR just switched from a different web provider
  // mid-session. The latter case is the interesting one: the new
  // provider has no idea what was said before, but the user expects
  // the conversation to "follow them" across models. We serialize
  // the current session's prior turns (excluding this turn) as a
  // textual history block and prepend it to the prompt.
  if (chatId === '' && context.messages.length > 1) {
    const enriched = serializeCrossProviderHistory(context.messages, messageText);
    if (enriched !== messageText) {
      diag('WS-DIAG', 'injected cross-provider history', {
        priorTurns: context.messages.length - 1,
        prefixChars: enriched.length - messageText.length,
      });
      messageText = enriched;
    }
  }

  return {
    type: 'WEB_LLM_FETCH',
    requestId: crypto.randomUUID(),
    providerId: preset.id,  // ⑫ bridge filter needs this to NOT drop messages
    modelId,                 // ⑨.2: adapter echoes this in CONVERSATION_UPDATE
    init: {
      method: 'POST',
      body: JSON.stringify({
        prompt: messageText,
        chatId,
        ...(parentMessageId !== undefined ? { parentMessageId } : {}),
      }),
    },
    ...(authHeader ? { authHeader } : {}),
  };
}

/**
 * Build an AssistantMessage partial for event pushes.
 * pi-ai requires .partial on every event; we construct a minimal valid one.
 */
function makePartial(
  providerId: string,
  modelId: string,
  text: string,
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' = 'stop',
  errorMessage?: string,
): import('@earendil-works/pi-ai').AssistantMessage {
  return {
    role: 'assistant',
    content: text
      ? [{ type: 'text', text }]
      : [],
    api: WEB_SESSION_API,
    provider: WEB_SESSION_API,
    model: `${providerId}:${modelId}`,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}
