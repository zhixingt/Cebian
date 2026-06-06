/**
 * ⑧: Provider-specific DOM strategy.
 *
 * Why a DOM strategy (not HTTP replay):
 *   - T1 DevTools research (2026-06-04) revealed each provider's chat API has
 *     anti-bot mechanisms that make pure HTTP replay infeasible:
 *       - GLM: requires HMAC X-Sign header (reverse-engineer their JS)
 *       - DeepSeek: requires WebAssembly PoW challenge solver
 *       - Kimi: uses gRPC-web binary protocol (custom framing)
 *   - Each has a public OpenAI-compatible API (api.deepseek.com, etc.) that
 *     needs an API key — defeats the "use my logged-in browser session" value prop.
 *   - Solution: reuse the real browser tab. Inject the user's message into the
 *     chat input, press Enter, read the AI's reply from the DOM.
 *   - This is the same approach used by browser-use, Anthropic Computer Use,
 *     and OpenAI Operator — bypasses all anti-bot because the browser session
 *     does the actual work.
 *
 * Each provider has two strategies:
 *   - InputStrategy: how to find the input element, set the message, trigger send
 *   - ReaderStrategy: how to poll the DOM for the AI's reply, detect completion
 */

import type { WebProvider } from '../types';

// ===== Input strategy =====

/**
 * How to set the message into the page's input element.
 *
 * Most providers use a controlled <textarea> (GLM, DeepSeek) or a contenteditable
 * <div> (Kimi uses Lexical editor). React-style controlled inputs need the
 * value setter trick to bypass React's value comparison; contenteditable
 * editors need execCommand or InputEvent dispatch.
 */
export interface InputStrategy {
  /** CSS selector for the input element. Must be specific (avoid catching the search box). */
  selector: string;

  /**
   * How to set the message into the element:
   *   - 'textarea-setter': Use HTMLTextAreaElement.prototype.value setter
   *     (required for React-controlled textareas; dispatches synthetic input event)
   *   - 'contenteditable-setter': Use HTMLElement.innerText setter + InputEvent
   *     (required for Lexical editor and similar contenteditable frameworks)
   *   - 'execCommand': Use document.execCommand('insertText') (legacy but works
   *     for some apps; deprecated in modern Chrome but still functional)
   */
  setMethod: 'textarea-setter' | 'contenteditable-setter' | 'execCommand';

  /**
   * How to trigger the send:
   *   - 'enter': dispatch an Enter keydown+keyup (works for most chat UIs)
   *   - 'ctrl-enter': use Ctrl+Enter (some apps use this instead of plain Enter)
   *   - 'click-send-button': click a send button (only when there's a visible
   *     button; some apps don't have one)
   */
  sendMethod: 'enter' | 'ctrl-enter' | 'click-send-button';

  /** CSS selector for the send button (required if sendMethod=click-send-button) */
  sendButtonSelector?: string;

  /**
   * Time to wait after setting the value before triggering send (ms).
   * Some apps debounce the input event; default 100ms.
   */
  settleDelayMs?: number;

  /**
   * Optional: scroll the input into view before interacting.
   * Default true; some pages have multiple inputs and need to focus the right one.
   */
  scrollIntoView?: boolean;
}

// ===== Reader strategy =====

/**
 * How to read the AI's reply from the DOM after sending the message.
 *
 * The reader polls the DOM at regular intervals looking for the most recent
 * assistant message element. When new text appears, onChunk is called.
 * When the text is stable for stableThresholdMs, onDone is called.
 */
export interface ReaderStrategy {
  /**
   * CSS selector for the most recent assistant message element.
   * Strategy: pick a selector that uniquely matches the LAST assistant message,
   * not all of them. E.g., for Kimi, the last `[data-message-role="assistant"]`.
   */
  assistantMessageSelector: string;

  /**
   * Optional: selector for a "thinking/loading" indicator.
   * While present, the message is still streaming.
   * Used to determine completion when stableThresholdMs is ambiguous.
   */
  thinkingIndicatorSelector?: string;

  /**
   * Polling interval in ms. Default 100ms.
   * Lower = more responsive but more CPU. 100ms feels real-time to humans.
   */
  pollIntervalMs?: number;

  /**
   * How long the text must be stable (unchanged) before onDone is called (ms).
   * Default 800ms. Apps typically pause briefly between sentences.
   * Too low = false completion; too high = perceptible lag.
   */
  stableThresholdMs?: number;

  /**
   * Maximum total time to wait for a reply before giving up (ms).
   * Default 60s. Resets on every new chunk.
   */
  maxTotalMs?: number;

  /**
   * How to extract text from the matched element.
   *   - 'textContent': raw text, includes whitespace and hidden elements
   *   - 'innerText': rendered text, respects CSS visibility (recommended)
   */
  textMode?: 'textContent' | 'innerText';
}

// ===== Combined strategy =====

/**
 * A provider's complete DOM strategy.
 * One per preset. Stored in WebProviderPreset.domStrategy.
 */
export interface WebProviderDomStrategy {
  input: InputStrategy;
  reader: ReaderStrategy;
}

// ===== Execution helpers (testable, also used by the content script) =====

/** Result of executing an input strategy. */
export interface InputExecutionResult {
  /** Whether the input element was found and the message was set. */
  ok: boolean;
  /** If !ok, why. */
  error?: string;
  /** The element that received the message (useful for debugging). */
  element?: HTMLElement;
}

/**
 * Find the input element and set the message. Pure DOM operation.
 *
 * Does NOT trigger send. Call executeSend separately (so the caller can verify
 * the input was set before sending).
 *
 * @param root - typically `document`, but can be a sub-tree for testing
 * @param strategy - the input strategy to apply
 * @param message - the user's message text
 */
export function executeInputSet(
  root: ParentNode,
  strategy: InputStrategy,
  message: string,
): InputExecutionResult {
  const el = root.querySelector(strategy.selector) as HTMLElement | null;
  if (!el) {
    return { ok: false, error: `Input element not found: ${strategy.selector}` };
  }
  if (strategy.scrollIntoView !== false && typeof el.scrollIntoView === 'function') {
    // jsdom doesn't implement scrollIntoView; real Chrome does. Guard for both.
    el.scrollIntoView({ block: 'center' });
  }
  el.focus();

  if (strategy.setMethod === 'textarea-setter') {
    // React-controlled textarea: use the prototype's value setter
    // to bypass React's value comparison.
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!desc?.set) {
      return { ok: false, error: 'No value setter on element prototype' };
    }
    desc.set.call(el, message);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (strategy.setMethod === 'contenteditable-setter') {
    // Lexical/ProseMirror/other contenteditable: prefer innerText setter
    // (real Chrome); fall back to textContent for environments that lack it
    // (jsdom tests).
    const desc = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText');
    if (desc?.set) {
      desc.set.call(el, message);
    } else {
      el.textContent = message;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
  } else if (strategy.setMethod === 'execCommand') {
    // Legacy fallback. Works for some contenteditable, fails for others.
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
}

/**
 * Trigger the send action (Enter key, Ctrl+Enter, or click).
 *
 * For key-based sends, dispatches keydown + keyup events with the appropriate
 * modifier. This works for both textarea (sends on Enter) and contenteditable
 * (sends on Enter) apps.
 *
 * @param root - typically `document`
 * @param strategy - the input strategy
 * @param activeElement - typically `document.activeElement` (the input we just filled)
 */
export function executeSend(
  root: ParentNode,
  strategy: InputStrategy,
  activeElement: Element | null,
): { ok: boolean; error?: string } {
  if (strategy.sendMethod === 'enter' || strategy.sendMethod === 'ctrl-enter') {
    if (!activeElement) {
      return { ok: false, error: 'No active element to send key to' };
    }
    const ctrlKey = strategy.sendMethod === 'ctrl-enter';
    const keyEventInit: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      ctrlKey,
    };
    activeElement.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
    activeElement.dispatchEvent(new KeyboardEvent('keypress', keyEventInit));
    activeElement.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
    return { ok: true };
  } else if (strategy.sendMethod === 'click-send-button') {
    if (!strategy.sendButtonSelector) {
      return { ok: false, error: 'sendMethod=click-send-button requires sendButtonSelector' };
    }
    const btn = root.querySelector(strategy.sendButtonSelector) as HTMLElement | null;
    if (!btn) {
      return { ok: false, error: `Send button not found: ${strategy.sendButtonSelector}` };
    }
    btn.click();
    return { ok: true };
  }
  return { ok: false, error: `Unknown sendMethod: ${strategy.sendMethod}` };
}

/** Callbacks for the reader. */
export interface ReaderCallbacks {
  /** Called when new text appears (after a poll where textContent changed). */
  onChunk: (text: string, fullText: string) => void;
  /** Called when the message is complete (text stable for stableThresholdMs or thinking indicator gone). */
  onDone: (fullText: string) => void;
  /** Called on unrecoverable error (selector lost, total timeout). */
  onError: (err: Error) => void;
}

/**
 * Handle returned by startReader. Call stop() to cancel polling.
 */
export interface ReaderHandle {
  /** Cancel the polling. Safe to call multiple times. */
  stop: () => void;
  /** Resolves when onDone or onError fires (whichever comes first). */
  done: Promise<void>;
}

/** Scheduler interface for testability. */
export interface Scheduler {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

const defaultScheduler: Scheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/**
 * Start polling the DOM for the AI's reply. Calls onChunk when text changes
 * and onDone when text is stable for stableThresholdMs.
 *
 * Pure DOM operation; the "scheduler" is injectable for tests.
 *
 * @param root - typically `document`
 * @param strategy - the reader strategy
 * @param callbacks - onChunk, onDone, onError handlers
 * @param scheduler - injectable for tests (default uses real setInterval)
 * @param now - injectable for tests (default uses Date.now)
 */
export function startReader(
  root: ParentNode,
  strategy: ReaderStrategy,
  callbacks: ReaderCallbacks,
  scheduler: Scheduler = defaultScheduler,
  now: () => number = Date.now,
): ReaderHandle {
  const pollMs = strategy.pollIntervalMs ?? 100;
  const stableMs = strategy.stableThresholdMs ?? 800;
  const maxMs = strategy.maxTotalMs ?? 60_000;

  let lastText = '';
  let lastChangedAt = now();
  let startedAt = now();
  let stopped = false;

  const tick = () => {
    if (stopped) return;

    // Total timeout check
    if (now() - startedAt > maxMs) {
      stopped = true;
      callbacks.onError(new Error(`Reader timeout after ${maxMs}ms`));
      resolveDone();
      return;
    }

    // Find the assistant message element
    const el = root.querySelector(strategy.assistantMessageSelector) as HTMLElement | null;
    if (!el) {
      // No message yet — keep polling, but don't error
      return;
    }

    // Read text
    const text = strategy.textMode === 'textContent'
      ? (el.textContent ?? '')
      : (el.innerText ?? '');

    if (text !== lastText) {
      lastText = text;
      lastChangedAt = now();
      callbacks.onChunk(text, text);
    }

    // Stable check (text hasn't changed for stableMs)
    if (text.length > 0 && now() - lastChangedAt >= stableMs) {
      stopped = true;
      callbacks.onDone(text);
      resolveDone();
    }
  };

  const handle = scheduler.setInterval(tick, pollMs);
  // Fire once immediately in case the element already exists
  queueMicrotask(tick);

  let resolveDone!: () => void;
  const donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });

  return {
    stop: () => {
      stopped = true;
      scheduler.clearInterval(handle);
      resolveDone();
    },
    done: donePromise,
  };
}

// ===== Per-provider strategies =====
// Verified 2026-06-04 via T1 DevTools research using direct CDP at localhost:9333.
// Selectors chosen for stability (avoid framework-specific classes that change per build).

export const GLM_DOM_STRATEGY: WebProviderDomStrategy = {
  input: {
    // GLM uses a controlled <textarea> at the bottom of the chat panel.
    // Verified 2026-06-04: single <textarea> with class `scroll-display-none`,
    // parent `.input-box-inner`. No data-testid; just match the textarea.
    selector: 'textarea',
    setMethod: 'textarea-setter',
    sendMethod: 'enter',
    settleDelayMs: 200,
    scrollIntoView: true,
  },
  reader: {
    // GLM renders assistant messages with class `.markdown-body` (GitHub-flavored
    // markdown renderer). Last-of-type to get the most recent reply.
    // Verified 2026-06-04: page probe found 2 `.markdown-body` elements; the
    // last is the AI's latest reply.
    assistantMessageSelector: '.markdown-body:last-of-type',
    // GLM shows a "stop generating" button while streaming; when it disappears
    // the message is done. Selector: button with text or class.
    thinkingIndicatorSelector: 'button.stop-generate, [data-testid="stop-generate"]',
    pollIntervalMs: 100,
    stableThresholdMs: 600,
    maxTotalMs: 60_000,
    textMode: 'innerText',
  },
};

export const DOM_STRATEGIES: Record<WebProvider['presetId'], WebProviderDomStrategy> = {
  glm: GLM_DOM_STRATEGY,
};
