/**
 * ⑧: Self-contained MAIN-world content script.
 *
 * Runs inside the provider's chat page. Responsibilities:
 *   1. Inject the user's message into the input element (via InputStrategy)
 *   2. Trigger send (Enter key, Ctrl+Enter, or click)
 *   3. Poll the DOM for the AI's reply (via ReaderStrategy)
 *   4. Report text chunks back to the SW via window.postMessage → ISOLATED bridge
 *
 * Self-contained because chrome.scripting.executeScript stringifies the function
 * — no imports are available in the page context.
 *
 * Strategy functions are inlined (vs imported) so the script is one blob.
 * Keep them in sync with lib/ai-config/web-provider-dom-strategy.ts.
 *
 * Stringified and passed to chrome.scripting.executeScript; do not break the
 * "must be self-contained" rule.
 */

import type { WebProviderDomStrategy } from './web-provider-dom-strategy';

export interface DomRelayRequest {
  providerId: string;
  modelId: string;
  /** The user's message text (concat of all content parts) */
  message: string;
  /** The provider's DOM strategy (input + reader) */
  domStrategy: WebProviderDomStrategy;
}

/**
 * MAIN-world orchestrator. Stringified and injected via chrome.scripting.
 * MUST be self-contained — no closure references, no imports.
 */
export async function runDomRelayMainWorld(request: DomRelayRequest): Promise<void> {
  const postToBridge = (payload: unknown) => {
    window.postMessage({
      source: 'ceb-web-provider-main',
      providerId: request.providerId,
      payload,
    }, '*');
  };

  // Keep helper logic INSIDE this function. chrome.scripting.executeScript
  // serializes only `runDomRelayMainWorld` itself; module-scope helpers are
  // not available in MAIN world.
  const setInput = (root: ParentNode, strategy: WebProviderDomStrategy['input'], message: string): { ok: boolean; error?: string; element?: HTMLElement } => {
    const el = root.querySelector(strategy.selector) as HTMLElement | null;
    if (!el) return { ok: false, error: `Input not found: ${strategy.selector}` };
    if (strategy.scrollIntoView !== false && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center' });
    }
    el.focus();

    if (strategy.setMethod === 'textarea-setter') {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (!desc?.set) return { ok: false, error: 'No value setter' };
      // Clear first, then write the new value. Two writes ensure React's value
      // tracker observes a "change" rather than a no-op equal-value set.
      desc.set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      desc.set.call(el, message);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // React controlled inputs commit on blur/change; dispatch a change so
      // onChange handlers run before the synthetic Enter.
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (strategy.setMethod === 'contenteditable-setter') {
      const desc = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText');
      if (desc?.set) {
        desc.set.call(el, '');
        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        desc.set.call(el, message);
      } else {
        el.textContent = message;
      }
      // Lexical / ProseMirror listen to beforeinput (inputType=insertText)
      // and input. Dispatch both so the editor commits the change.
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: message }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
    } else if (strategy.setMethod === 'execCommand') {
      if (typeof document.execCommand !== 'function') {
        return { ok: false, error: 'document.execCommand is not available' };
      }
      if (!document.execCommand('insertText', false, message)) {
        return { ok: false, error: 'execCommand insertText returned false' };
      }
    } else {
      return { ok: false, error: `Unknown setMethod: ${strategy.setMethod}` };
    }
    return { ok: true, element: el };
  };

  const sendInput = (root: ParentNode, strategy: WebProviderDomStrategy['input'], activeElement: Element | null): { ok: boolean; error?: string; method?: string } => {
    // Try click-send-button FIRST if configured. Real buttons are the most
    // reliable trigger across providers (Lexical/React controlled textareas
    // often ignore synthetic KeyboardEvents that don't bubble through document).
    if (strategy.sendMethod === 'click-send-button' || strategy.sendButtonSelector) {
      const sel = strategy.sendButtonSelector;
      if (!sel) return { ok: false, error: 'sendMethod=click-send-button requires sendButtonSelector' };
      const btn = root.querySelector(sel) as HTMLElement | null;
      if (!btn) return { ok: false, error: `Send button not found: ${sel}` };
      btn.click();
      return { ok: true, method: 'click-send-button' };
    }

    if (strategy.sendMethod === 'enter' || strategy.sendMethod === 'ctrl-enter') {
      if (!activeElement) return { ok: false, error: 'No active element' };
      const ctrlKey = strategy.sendMethod === 'ctrl-enter';
      const init: KeyboardEventInit = {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, ctrlKey,
      };
      // 1) Dispatch on the element first (provider handlers usually bind here).
      activeElement.dispatchEvent(new KeyboardEvent('keydown', init));
      activeElement.dispatchEvent(new KeyboardEvent('keypress', init));
      activeElement.dispatchEvent(new KeyboardEvent('keyup', init));
      // 2) Also bubble through document so React/Lexical delegated listeners
      //    (which often sit on the document) can react to the Enter.
      root.dispatchEvent(new KeyboardEvent('keydown', init));
      root.dispatchEvent(new KeyboardEvent('keypress', init));
      root.dispatchEvent(new KeyboardEvent('keyup', init));
      return { ok: true, method: 'enter-bubbled' };
    }
    return { ok: false, error: `Unknown sendMethod: ${strategy.sendMethod}` };
  };

  /**
   * Best-effort real-button click fallback.
   * The reasoning behind this is empirical: after the standard "set + Enter"
   * sequence, real providers (DeepSeek/GLM) often still ignore the synthetic
   * keyboard event because the React reconciler only listens to the actual
   * send button's onClick. We probe a small set of likely selectors and click
   * the first matching one we find. This is preferred over a configured
   * sendButtonSelector because each provider's button is currently unmodeled.
   */
  const tryRealSendButtonClick = (): { clicked: boolean; selector?: string } => {
    // 1) Constrain candidates to the input's parent container (avoid
    //    clicking unrelated toolbar buttons). 2) Prefer empirically verified
    //    selectors (DeepSeek ds-button, Kimi send-button-container). 3)
    //    Respect the "disabled / aria-disabled" state so we don't click a
    //    stale "stop" button mid-stream.
    const inputEl = document.querySelector(request.domStrategy.input.selector) as HTMLElement | null;
    const root: ParentNode = inputEl?.closest('form, [class*="chat"], [class*="input"], [class*="editor"]') || document;

    const isEnabled = (el: HTMLElement) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-disabled') !== 'true' &&
      !/\bdisabled\b/.test(el.className || '');

    const candidates: string[] = [
      // DeepSeek: <div role="button" class="ds-button"> - the XL variant is the send button
      'div.ds-button[role="button"].ds-button--xl:not(.disabled)',
      'div[role="button"].ds-button.ds-button--primary:not(.disabled)',
      // Kimi: <div class="send-button-container"> (becomes enabled when text is set)
      '.send-button-container:not(.disabled)',
      // Generic fallbacks
      'button[aria-label*="Send"]',
      'div[role="button"][class*="send"]',
    ];

    for (const sel of candidates) {
      const el = root.querySelector(sel) as HTMLElement | null;
      if (el && isEnabled(el)) {
        el.click();
        return { clicked: true, selector: sel };
      }
    }
    return { clicked: false };
  };

  /**
   * Returns a promise that resolves when the assistant is clearly streaming
   * (stop button or thinking indicator present, or new markdown element added).
   * Used to decide whether the send attempt was actually accepted.
   */
  const waitForStreamingEvidence = (timeoutMs: number): Promise<boolean> => new Promise((resolve) => {
    const start = Date.now();
    const initialCount = document.querySelectorAll('[class*="markdown"]').length;
    const indicatorSelector = request.domStrategy.reader.thinkingIndicatorSelector;
    const tick = () => {
      const stop = !!document.querySelector('button[class*="stop"], [data-testid="stop-generating"]');
      const mdCount = document.querySelectorAll('[class*="markdown"]').length;
      const indicator = indicatorSelector ? !!document.querySelector(indicatorSelector) : false;
      if (stop || indicator || mdCount > initialCount) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  });

  const readAssistantText = (el: HTMLElement | null): string => {
    if (!el) return '';
    return request.domStrategy.reader.textMode === 'textContent'
      ? (el.textContent ?? '')
      : (el.innerText ?? el.textContent ?? '');
  };

  const normalizeForComparison = (text: string): string =>
    text.replace(/\s+/g, ' ').trim();

  // ⑭: Port-based abort channel. The SW opens a port named
  // `abort-${requestId}` and posts `{type:'abort'}` when the user clicks
  // Stop. The ISOLATED bridge forwards this as a `ceb-web-provider-message`
  // CustomEvent with `{type:'WEB_LLM_ABORT'}`. We listen for it here and
  // set `window.__webProviderAbortFlag = true` so the DOM polling loop
  // below can break early instead of continuing to push chunks after the
  // user cancelled. Without this, the SW-side stream is cancelled but
  // the MAIN-world IIFE keeps polling the DOM and eventually pushes
  // WEB_LLM_DONE with full accumulated text — leaving residual text in
  // the assistant message bubble.
  // MVP assumption: one active web-provider session per tab at a time.
  // If concurrent sessions are ever supported, this flag must be keyed
  // by session/request id instead of being a singleton.
  (window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag = false;
  const abortListener = (event: Event) => {
    const data = (event as CustomEvent<Record<string, unknown>>).detail;
    if (data && data.type === 'WEB_LLM_ABORT') {
      (window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag = true;
    }
  };
  document.addEventListener('ceb-web-provider-message', abortListener);

  try {
    // 0. ⑨: pre-flight "needs relogin" check.
    //    The most reliable signal that the user's session expired is that the
    //    chat input element is no longer present — the provider redirected to
    //    a login wall or the page is showing an error. Emit a relogin signal
    //    (not a generic error) so the sidepanel can prompt the user.
    if (!document.querySelector(request.domStrategy.input.selector)) {
      postToBridge({
        type: 'WEB_LLM_NEEDS_RELOGIN',
        providerId: request.providerId,
        status: 401,
        message: `Provider ${request.providerId} is no longer logged in (chat input not found on ${location.href}). Please re-login via Settings → Web Providers.`,
      });
      return;
    }

    // Snapshot the pre-send assistant text as this turn's baseline.
    // If polling keeps seeing exactly this text, it's stale history from the
    // previous turn and must be ignored.
    const baselineElBeforeSend = document.querySelector(request.domStrategy.reader.assistantMessageSelector) as HTMLElement | null;
    const baselineText = readAssistantText(baselineElBeforeSend);
    const baselineComparable = normalizeForComparison(baselineText);

    // 1. Set the message
    const setResult = setInput(document, request.domStrategy.input, request.message);
    if (!setResult.ok) {
      // ⑨: "set failed" usually means the input element disappeared between
      // our pre-flight check and the set call. Treat as needs-relogin too —
      // the page likely redirected to a login wall mid-call.
      const isInputMissing = !document.querySelector(request.domStrategy.input.selector);
      if (isInputMissing) {
        postToBridge({
          type: 'WEB_LLM_NEEDS_RELOGIN',
          providerId: request.providerId,
          status: 401,
          message: `Provider ${request.providerId} is no longer logged in (chat input disappeared mid-call). Please re-login via Settings → Web Providers.`,
        });
        return;
      }
      postToBridge({ type: 'WEB_LLM_ERROR', providerId: request.providerId, error: 'set: ' + setResult.error });
      return;
    }

    // 2. Wait for the input to settle (some apps debounce)
    const settleMs = request.domStrategy.input.settleDelayMs ?? 100;
    await new Promise((r) => setTimeout(r, settleMs));

    // 3. Trigger send. Real-world evidence: dispatching Enter to a React/Lexical
    //    controlled input alone is unreliable, so we send the key first then
    //    poll briefly to see if streaming actually started; if not, try once
    //    more with a fresh focus + input event.
    const sendTarget = setResult.element ?? document.activeElement;
    const firstSend = sendInput(document, request.domStrategy.input, sendTarget);
    if (!firstSend.ok) {
      postToBridge({ type: 'WEB_LLM_ERROR', providerId: request.providerId, error: 'send: ' + firstSend.error });
      return;
    }

    // Brief poll to detect streaming. If nothing happened, fall back to the
    // real on-page send button. This mirrors the chromeclaw pattern of waiting
    // for the first streaming signal before reporting "sent", and is the
    // empirically reliable path against React/Lexical controlled inputs.
    let streamingStarted = await waitForStreamingEvidence(1500);
    if (!streamingStarted) {
      const clicked = tryRealSendButtonClick();
      if (clicked.clicked) {
        streamingStarted = await waitForStreamingEvidence(1500);
      }
    }

    // 4. Poll the DOM for the AI's reply
    const pollMs = request.domStrategy.reader.pollIntervalMs ?? 100;
    const stableMs = request.domStrategy.reader.stableThresholdMs ?? 800;
    const maxMs = request.domStrategy.reader.maxTotalMs ?? 60_000;
    const startedAt = Date.now();

    let lastText = '';
    let lastChangedAt = Date.now();
    let stableReported = false;
    let hasTurnOutput = false;

    // Helper: check if still streaming (thinking indicator visible)
    const isStillStreaming = (): boolean => {
      if (!request.domStrategy.reader.thinkingIndicatorSelector) return false;
      return !!document.querySelector(request.domStrategy.reader.thinkingIndicatorSelector);
    };

    // 2026-06-07: early-out for known non-chat pages. If the tab is on
    // chatglm.cn but not on a chat surface (e.g. /main/alltoolsdetail
    // tool description, /tools, /model-detail), the DOM reader will
    // never find the right .markdown-body and will burn the full
    // 60s maxTotalMs. Detect this once at reader start and surface an
    // actionable WEB_LLM_ERROR with the current URL. We only check
    // /alltoolsdetail explicitly because that's the page the root
    // loginUrl redirects to; other non-chat paths are rare for the
    // GLM web provider flow and fall through to the normal timeout
    // path.
    if (/\/alltoolsdetail(\?|$|\/)/.test(location.pathname + location.search + location.hash)) {
      postToBridge({
        type: 'WEB_LLM_ERROR',
        providerId: request.providerId,
        error: `GLM is on a tool description page (${location.pathname}), not the chat interface. Please open https://chatglm.cn/main/chat/new in this tab and retry.`,
      });
      return;
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // ⑭: check the abort flag at the top of each polling iteration.
      // The SW posts `{type:'abort'}` on the port when the user clicks
      // Stop; the ISOLATED bridge forwards it as a CustomEvent with
      // `{type:'WEB_LLM_ABORT'}`; our listener sets the flag. Break
      // early so no residual text is pushed after cancel.
      if ((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag) {
        postToBridge({ type: 'WEB_LLM_DONE', providerId: request.providerId });
        return;
      }
      if (Date.now() - startedAt > maxMs) {
        postToBridge({ type: 'WEB_LLM_ERROR', providerId: request.providerId, error: `Reader timeout after ${maxMs}ms` });
        return;
      }
      await new Promise((r) => setTimeout(r, pollMs));
      // ⑭: re-check the abort flag after the poll delay. The setTimeout
      // above can block for pollMs; if the user clicked Stop while we
      // were waiting, the flag is set but we wouldn't notice it until
      // the NEXT iteration's top-of-loop check — by which time we'd
      // have already read the DOM and pushed a residual WEB_LLM_CHUNK.
      if ((window as unknown as { __webProviderAbortFlag?: boolean }).__webProviderAbortFlag) {
        postToBridge({ type: 'WEB_LLM_DONE', providerId: request.providerId });
        return;
      }

      const el = document.querySelector(request.domStrategy.reader.assistantMessageSelector) as HTMLElement | null;
      if (!el) continue;  // No message yet, keep polling

      const text = readAssistantText(el);

      // Ignore unchanged baseline from previous turns.
      const isSameBaselineElement = !!baselineElBeforeSend && el === baselineElBeforeSend;
      if (!hasTurnOutput && isSameBaselineElement && normalizeForComparison(text) === baselineComparable) {
        continue;
      }

      if (!hasTurnOutput) {
        hasTurnOutput = true;
      }

      if (text !== lastText) {
        lastText = text;
        lastChangedAt = Date.now();
        postToBridge({ type: 'WEB_LLM_CHUNK', providerId: request.providerId, text });
      }

      // Done conditions:
      //   1. Text is stable for stableThresholdMs AND no thinking indicator
      //   2. (or) text is stable for stableThresholdMs (most apps)
      const stable = Date.now() - lastChangedAt >= stableMs;
      const thinking = isStillStreaming();
      if (stable && !thinking && text.length > 0 && hasTurnOutput && !stableReported) {
        stableReported = true;
        postToBridge({ type: 'WEB_LLM_DONE', providerId: request.providerId });
        return;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    postToBridge({ type: 'WEB_LLM_ERROR', providerId: request.providerId, error: msg });
  } finally {
    // ⑭: clean up the abort listener to avoid leaks on tab reuse.
    document.removeEventListener('ceb-web-provider-message', abortListener);
  }
}

/**
 * ISOLATED-world bridge. Forwards window.postMessage from MAIN to SW.
 * Stringified and injected; must be self-contained.
 */
export function installIsolatedBridge(providerId: string, debug: boolean = false): void {
  // ⑬ FIX: extension reload survival. When the SW is reloaded (user
  // clicks "Reload" in chrome://extensions, or the extension is
  // updated), the old content script's listener still has a live
  // reference to the (now-defunct) old SW via chrome.runtime. A new
  // injection of this function sees the existing `__cebWebProviderBridge`
  // guard and exits early — but the OLD listener is the one that's
  // actually attached to the document, holding the dead SW ref.
  // Every event it tries to forward throws "Extension context
  // invalidated", while the new content script's listener never gets
  // a chance to run.
  //
  // Fix: store the listener function on the window so a fresh
  // injection can removeEventListener on the old one before adding
  // the new one. The providerId guard still prevents duplicate
  // listeners within a single page (no extra cost on the happy
  // path — same providerId, same listener ref).
  const w = window as unknown as {
    __cebWebProviderBridge?: {
      providerId: string;
      listener?: EventListener;
      connectListener?: (port: { name: string; onMessage: { addListener: (fn: (msg: unknown) => void) => void } }) => void;
    };
  };
  const existing = w.__cebWebProviderBridge;
  if (existing?.providerId === providerId && existing.listener) {
    // Same provider, same listener ref: nothing to do.
    return;
  }
  if (existing?.listener) {
    // Stale (different SW generation, different provider, or first
    // call after reload): clean up before installing the new one.
    document.removeEventListener('ceb-web-provider-message', existing.listener);
  }

  // ⑫ FIX: cross-world messaging. window.postMessage doesn't cross the
  // MAIN↔ISOLATED world boundary (each world has its own `window`).
  // document.dispatchEvent(CustomEvent) IS shared because both worlds
  // share the same `document`. Adapters dispatch 'ceb-web-provider-message'
  // on document; the bridge listens here.
  const listener = ((event: Event) => {
    const data = (event as CustomEvent<Record<string, unknown>>).detail;
    if (!data || typeof data !== 'object') return;
    // ⑫ DIAG: log every event the bridge sees. We can't use the ⑨.4
    // diag gate here directly because this function is serialized by
    // `chrome.scripting.executeScript` and re-parsed in the ISOLATED
    // world — module-scope imports would be `undefined` in the target
    // context, throwing "X is not defined" on the first message. The
    // SW reads the flag and passes it as the `debug` arg, so the gate
    // is respected without a module reference.
    const log = (...args: unknown[]): void => {
      if (debug) console.log(...args);
    };
    log('[WS-DIAG-BRIDGE] received CustomEvent', {
      type: data.type,
      providerId: data.providerId,
      keys: Object.keys(data).slice(0, 8),
    });
    if (data.providerId !== providerId) {
      log('[WS-DIAG-BRIDGE] DROPPING (providerId mismatch)');
      return;
    }
    if (typeof data.type !== 'string' || !data.type.startsWith('WEB_LLM_')) {
      log('[WS-DIAG-BRIDGE] DROPPING (not WEB_LLM_ type)');
      return;
    }
    // Abort signals are bridge→MAIN only; never forward back to SW.
    // The connectListener below dispatches WEB_LLM_ABORT on this same
    // CustomEvent channel to reach the MAIN-world IIFE; without this
    // guard the bridge's own listener would re-send it to the SW,
    // forming a feedback loop (SW → port → bridge → SW).
    if (data.type === 'WEB_LLM_ABORT') {
      log('[WS-DIAG-BRIDGE] DROPPING (abort is bridge→MAIN only)');
      return;
    }
    log('[WS-DIAG-BRIDGE] forwarding to SW', data.type);
    chrome.runtime.sendMessage(data).catch((err) => {
      // sendMessage failures are real (no SW receiver, etc.) — surface
      // them even when diag is off so we don't lose this signal.
      console.warn('[WS-DIAG-BRIDGE] sendMessage failed:', err);
    });
  }) as EventListener;

  document.addEventListener('ceb-web-provider-message', listener);
  w.__cebWebProviderBridge = { providerId, listener };
  chrome.runtime.sendMessage({
    type: 'WEB_LLM_RELAY_READY',
    providerId,
  }).catch(() => { /* SW may not be ready; harmless */ });

  // ⑭: Port-based abort channel. The SW opens a port named
  // `abort-${requestId}` via `chrome.tabs.connect(tabId, {name: ...})`
  // and posts `{type:'abort'}` when the user clicks Stop. We listen
  // for the connection here (in the ISOLATED world) and forward the
  // abort signal to the MAIN world via a `ceb-web-provider-message`
  // CustomEvent with `{type:'WEB_LLM_ABORT'}`. The MAIN-world IIFE
  // has a listener that sets `window.__webProviderAbortFlag = true`,
  // causing its polling/SSE loop to break early.
  //
  // Guard against duplicate onConnect listeners (same reload-survival
  // concern as the message listener above): remove the old connect
  // listener (captured from `existing` BEFORE we overwrote
  // `w.__cebWebProviderBridge` above) before adding a new one.
  if (existing?.connectListener) {
    chrome.runtime.onConnect.removeListener(existing.connectListener);
  }
  const connectListener = (port: { name: string; onMessage: { addListener: (fn: (msg: unknown) => void) => void } }) => {
    // Only handle ports named `abort-*` (other ports are for unrelated
    // features like the agent port in background/index.ts).
    if (!port.name || !port.name.startsWith('abort-')) return;
    port.onMessage.addListener((msg: unknown) => {
      if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'abort') {
        // Forward to MAIN world via the shared document CustomEvent
        // channel. The MAIN-world IIFE listens for this and sets
        // `window.__webProviderAbortFlag = true`.
        document.dispatchEvent(new CustomEvent('ceb-web-provider-message', {
          detail: { type: 'WEB_LLM_ABORT', providerId },
        }));
      }
    });
  };
  chrome.runtime.onConnect.addListener(connectListener);
  (w.__cebWebProviderBridge as { connectListener?: typeof connectListener }).connectListener = connectListener;
}
