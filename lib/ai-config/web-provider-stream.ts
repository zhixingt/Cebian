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
import { getTabRegistry, injectDomRelay } from './web-provider-relay';
import {
  WEB_LLM_CHUNK,
  WEB_LLM_DONE,
  WEB_LLM_ERROR,
  WEB_LLM_RELAY_READY,
  WEB_LLM_NEEDS_RELOGIN,
  type WebProviderRelayMessage,
} from './web-provider-relay';
import { WEB_PROVIDER_PRESETS, type WebProviderPreset } from './web-provider-presets';
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
function getDefaultDeps(): WebSessionStreamDeps {
  if (_defaultDeps) return _defaultDeps;
  _defaultDeps = {
    openTab: async (providerId, url) => {
      const tabId = await getTabRegistry().openOrReuseTab(providerId, url);
      getTabRegistry().markUsed(providerId);
      return tabId;
    },
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
    // Defensive: any uncaught error from the orchestrator
    console.error('[web-session-stream] uncaught error:', err);
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

  try {
    // 1. Parse model id
    const { providerId, modelId } = parseWebModelId(model.id);

    // 2. Look up preset
    const preset = deps.presets.find((p) => p.id === providerId);
    if (!preset) {
      throw new Error(`Unknown web provider: ${providerId}`);
    }
    // ⑧: domStrategy is required (replaces old chatApi check)
    if (!preset.domStrategy) {
      throw new Error(`Provider ${providerId} has no domStrategy configured`);
    }

    // 3. Resolve bundle (validates login + decryption)
    const bundle = await deps.resolveBundle(providerId);
    if (!bundle) {
      throw new Error(`Provider ${providerId} has no valid session — please log in via Settings`);
    }

    // 4. Build DOM relay request
    const request = buildRelayRequest(preset, modelId, context);

    // 5. Open/reuse tab
    const tabId = await deps.openTab(providerId, preset.loginUrl);

    // 6. Listen for messages BEFORE injecting (so we don't miss the RELAY_READY)
    let accumulatedText = '';
    const textDone = { value: false };
    unregisterMsg = deps.onMessage((msg) => {
      if (msg.providerId !== providerId) return;
      switch (msg.type) {
        case WEB_LLM_CHUNK: {
          // ⑧: msg.text is the FULL text (not delta) because the DOM reader
          // re-reads the whole textContent each poll. Compute delta ourselves.
          const newText = msg.text;
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

    // 8. Inject the relay scripts
    await deps.injectScripts(tabId, request);
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
