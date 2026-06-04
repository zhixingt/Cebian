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
      return { ok: false, error: `Unknown setMethod: ${(strategy as any).setMethod}` };
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
    return { ok: false, error: `Unknown sendMethod: ${(strategy as any).sendMethod}` };
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

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - startedAt > maxMs) {
        postToBridge({ type: 'WEB_LLM_ERROR', providerId: request.providerId, error: `Reader timeout after ${maxMs}ms` });
        return;
      }
      await new Promise((r) => setTimeout(r, pollMs));

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
  }
}

/**
 * ISOLATED-world bridge. Forwards window.postMessage from MAIN to SW.
 * Stringified and injected; must be self-contained.
 */
export function installIsolatedBridge(providerId: string): void {
  const w = window as unknown as { __cebWebProviderBridge?: { providerId: string } };
  if (w.__cebWebProviderBridge?.providerId === providerId) return;

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'ceb-web-provider-main') return;
    if (data.providerId !== providerId) return;
    chrome.runtime.sendMessage(data.payload).catch((err) => {
      console.warn('[ceb-web-provider-bridge] sendMessage failed:', err);
    });
  });

  w.__cebWebProviderBridge = { providerId };
  chrome.runtime.sendMessage({
    type: 'WEB_LLM_RELAY_READY',
    providerId,
  }).catch(() => { /* SW may not be ready; harmless */ });
}
