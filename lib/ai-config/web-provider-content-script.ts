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

// ===== Inlined strategy functions (mirror of web-provider-dom-strategy.ts) =====
// Keep in sync with the source-of-truth in web-provider-dom-strategy.ts.
// Differences: no jsdom fallback (real Chrome always has these), no scheduler
// injection (uses real setInterval).

function _setInput(root: ParentNode, strategy: WebProviderDomStrategy['input'], message: string): { ok: boolean; error?: string } {
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
    desc.set.call(el, message);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (strategy.setMethod === 'contenteditable-setter') {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText');
    if (desc?.set) {
      desc.set.call(el, message);
    } else {
      el.textContent = message;
    }
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
  return { ok: true };
}

function _sendInput(root: ParentNode, strategy: WebProviderDomStrategy['input'], activeElement: Element | null): { ok: boolean; error?: string } {
  if (strategy.sendMethod === 'enter' || strategy.sendMethod === 'ctrl-enter') {
    if (!activeElement) return { ok: false, error: 'No active element' };
    const ctrlKey = strategy.sendMethod === 'ctrl-enter';
    const init: KeyboardEventInit = {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, ctrlKey,
    };
    activeElement.dispatchEvent(new KeyboardEvent('keydown', init));
    activeElement.dispatchEvent(new KeyboardEvent('keypress', init));
    activeElement.dispatchEvent(new KeyboardEvent('keyup', init));
    return { ok: true };
  } else if (strategy.sendMethod === 'click-send-button') {
    if (!strategy.sendButtonSelector) return { ok: false, error: 'sendMethod=click-send-button requires sendButtonSelector' };
    const btn = root.querySelector(strategy.sendButtonSelector) as HTMLElement | null;
    if (!btn) return { ok: false, error: `Send button not found: ${strategy.sendButtonSelector}` };
    btn.click();
    return { ok: true };
  }
  return { ok: false, error: `Unknown sendMethod: ${(strategy as any).sendMethod}` };
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

  try {
    // 1. Set the message
    const setResult = _setInput(document, request.domStrategy.input, request.message);
    if (!setResult.ok) {
      postToBridge({ type: 'WEB_LLM_ERROR', providerId: request.providerId, error: 'set: ' + setResult.error });
      return;
    }

    // 2. Wait for the input to settle (some apps debounce)
    const settleMs = request.domStrategy.input.settleDelayMs ?? 100;
    await new Promise((r) => setTimeout(r, settleMs));

    // 3. Trigger send
    const sendResult = _sendInput(document, request.domStrategy.input, document.activeElement);
    if (!sendResult.ok) {
      postToBridge({ type: 'WEB_LLM_ERROR', providerId: request.providerId, error: 'send: ' + sendResult.error });
      return;
    }

    // 4. Poll the DOM for the AI's reply
    const pollMs = request.domStrategy.reader.pollIntervalMs ?? 100;
    const stableMs = request.domStrategy.reader.stableThresholdMs ?? 800;
    const maxMs = request.domStrategy.reader.maxTotalMs ?? 60_000;
    const startedAt = Date.now();
    let lastText = '';
    let lastChangedAt = Date.now();
    let stableReported = false;

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

      const text = request.domStrategy.reader.textMode === 'textContent'
        ? (el.textContent ?? '')
        : (el.innerText ?? '');

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
      if (stable && !thinking && text.length > 0 && !stableReported) {
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
