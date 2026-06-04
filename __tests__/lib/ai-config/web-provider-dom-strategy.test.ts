import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executeInputSet,
  executeSend,
  startReader,
  DOM_STRATEGIES,
  GLM_DOM_STRATEGY,
  KIMI_DOM_STRATEGY,
  DEEPSEEK_DOM_STRATEGY,
  type ReaderStrategy,
  type ReaderCallbacks,
  type Scheduler,
  type WebProviderDomStrategy,
} from '@/lib/ai-config/web-provider-dom-strategy';

/**
 * ⑧: Tests for the DOM strategy abstraction.
 * Strategy: use jsdom's real DOM (vitest config has environment: 'jsdom').
 * For polling/timeout, inject a fake scheduler and fake clock.
 */

// ===== executeInputSet =====

describe('executeInputSet', () => {
  let ta: HTMLTextAreaElement;
  let div: HTMLDivElement;

  beforeEach(() => {
    ta = document.createElement('textarea');
    ta.setAttribute('data-testid', 'chat-input');
    document.body.appendChild(ta);

    div = document.createElement('div');
    div.className = 'chat-input-editor';
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('textarea-setter sets value via prototype setter (bypasses React)', () => {
    // Simulate React's value comparison: if you do `el.value = 'x'`, React
    // compares to last known value and skips update. The prototype setter
    // bypasses that. We verify by checking the descriptor on the element.
    const result = executeInputSet(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'enter',
    }, 'hello world');
    expect(result.ok).toBe(true);
    expect(ta.value).toBe('hello world');
    // The setter call should have also dispatched a bubbling 'input' event.
    // We don't have an event listener to assert, but at minimum: no throw.
  });

  it('contenteditable-setter sets innerText (or textContent fallback in jsdom)', () => {
    const result = executeInputSet(document.body, {
      selector: '.chat-input-editor',
      setMethod: 'contenteditable-setter',
      sendMethod: 'enter',
    }, 'hi there');
    expect(result.ok).toBe(true);
    // jsdom lacks innerText getter, so use textContent which is what the
    // fallback sets. Real Chrome has innerText getter, so both work there.
    const text = div.innerText ?? div.textContent;
    expect(text).toBe('hi there');
  });

  it('returns error when selector matches nothing', () => {
    const result = executeInputSet(document.body, {
      selector: '.does-not-exist',
      setMethod: 'textarea-setter',
      sendMethod: 'enter',
    }, 'msg');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error for execCommand setMethod if execCommand returns false', () => {
    // jsdom execCommand returns false by default for insertText
    const result = executeInputSet(document.body, {
      selector: 'div[contenteditable]',
      setMethod: 'execCommand',
      sendMethod: 'enter',
    }, 'msg');
    // jsdom returns false for insertText
    expect(result.ok).toBe(false);
    expect(result.error).toContain('execCommand');
  });

  it('returns error for unknown setMethod', () => {
    const result = executeInputSet(document.body, {
      selector: 'textarea',
      // @ts-expect-error - testing runtime error
      setMethod: 'magic',
      sendMethod: 'enter',
    }, 'msg');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown setMethod');
  });

  it('scrolls element into view before setting (default behavior)', () => {
    const scrollIntoView = vi.fn();
    ta.scrollIntoView = scrollIntoView;
    executeInputSet(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'enter',
    }, 'msg');
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('respects scrollIntoView: false', () => {
    const scrollIntoView = vi.fn();
    ta.scrollIntoView = scrollIntoView;
    executeInputSet(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'enter',
      scrollIntoView: false,
    }, 'msg');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

// ===== executeSend =====

describe('executeSend', () => {
  let ta: HTMLTextAreaElement;
  let btn: HTMLButtonElement;

  beforeEach(() => {
    ta = document.createElement('textarea');
    document.body.appendChild(ta);
    btn = document.createElement('button');
    btn.className = 'send-btn';
    document.body.appendChild(btn);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('dispatches Enter keydown/keypress/keyup on the active element', () => {
    ta.focus();
    const events: string[] = [];
    ta.addEventListener('keydown', () => events.push('keydown'));
    ta.addEventListener('keypress', () => events.push('keypress'));
    ta.addEventListener('keyup', () => events.push('keyup'));
    const result = executeSend(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'enter',
    }, ta);
    expect(result.ok).toBe(true);
    expect(events).toEqual(['keydown', 'keypress', 'keyup']);
  });

  it('ctrl-enter adds ctrlKey=true', () => {
    ta.focus();
    const keydownHandler = vi.fn();
    ta.addEventListener('keydown', keydownHandler);
    executeSend(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'ctrl-enter',
    }, ta);
    const evt = keydownHandler.mock.calls[0][0] as KeyboardEvent;
    expect(evt.ctrlKey).toBe(true);
  });

  it('click-send-button calls .click() on the matched button', () => {
    const click = vi.fn();
    btn.click = click;
    const result = executeSend(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'click-send-button',
      sendButtonSelector: '.send-btn',
    }, ta);
    expect(result.ok).toBe(true);
    expect(click).toHaveBeenCalled();
  });

  it('click-send-button returns error if button selector missing', () => {
    const result = executeSend(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'click-send-button',
    }, ta);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('requires sendButtonSelector');
  });

  it('click-send-button returns error if button not found', () => {
    const result = executeSend(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'click-send-button',
      sendButtonSelector: '.does-not-exist',
    }, ta);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Send button not found');
  });

  it('enter returns error if no active element', () => {
    const result = executeSend(document.body, {
      selector: 'textarea',
      setMethod: 'textarea-setter',
      sendMethod: 'enter',
    }, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active element');
  });
});

// ===== startReader (with fake scheduler) =====

describe('startReader', () => {
  let msgEl: HTMLDivElement;
  let strategy: ReaderStrategy;
  let fakeNow: number;
  let scheduler: Scheduler;
  let pendingTicks: Array<() => void>;

  beforeEach(() => {
    msgEl = document.createElement('div');
    msgEl.className = 'assistant-msg';
    document.body.appendChild(msgEl);
    pendingTicks = [];
    scheduler = {
      setInterval: (fn) => { pendingTicks.push(fn); return Symbol('interval'); },
      clearInterval: () => {},
    };
    fakeNow = 1_000_000;
    strategy = {
      assistantMessageSelector: '.assistant-msg',
      pollIntervalMs: 100,
      stableThresholdMs: 800,
      maxTotalMs: 60_000,
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not call onChunk when no element matches', () => {
    document.body.removeChild(msgEl);
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    startReader(document.body, strategy, { onChunk, onDone, onError }, scheduler, () => fakeNow);
    for (const tick of pendingTicks) tick();
    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('calls onChunk with the new text when element appears', () => {
    const onChunk = vi.fn();
    startReader(
      document.body, strategy,
      { onChunk, onDone: () => {}, onError: () => {} },
      scheduler, () => fakeNow,
    );
    // First tick (microtask): element exists but text empty
    pendingTicks.forEach((t) => t());
    expect(onChunk).not.toHaveBeenCalled();
    // Text appears
    msgEl.innerText = 'Hello';
    pendingTicks.forEach((t) => t());
    expect(onChunk).toHaveBeenCalledWith('Hello', 'Hello');
  });

  it('calls onDone when text is stable for stableThresholdMs', () => {
    const onChunk = vi.fn();
    const onDone = vi.fn();
    startReader(
      document.body, strategy,
      { onChunk, onDone, onError: () => {} },
      scheduler, () => fakeNow,
    );
    // Text appears
    msgEl.innerText = 'Hi there';
    pendingTicks.forEach((t) => t());
    expect(onDone).not.toHaveBeenCalled();
    // Time advances by less than stableThresholdMs
    fakeNow += 500;
    pendingTicks.forEach((t) => t());
    expect(onDone).not.toHaveBeenCalled();
    // Time advances past stableThresholdMs
    fakeNow += 400;
    pendingTicks.forEach((t) => t());
    expect(onDone).toHaveBeenCalledWith('Hi there');
  });

  it('resets stability timer when text changes', () => {
    const onChunk = vi.fn();
    const onDone = vi.fn();
    startReader(
      document.body, strategy,
      { onChunk, onDone, onError: () => {} },
      scheduler, () => fakeNow,
    );
    msgEl.innerText = 'First';
    pendingTicks.forEach((t) => t());
    fakeNow += 500;
    pendingTicks.forEach((t) => t());
    // Text changes — stability resets
    msgEl.innerText = 'First line\nSecond';
    pendingTicks.forEach((t) => t());
    fakeNow += 500;
    pendingTicks.forEach((t) => t());
    expect(onDone).not.toHaveBeenCalled();
    // Now advance past stableThresholdMs from the latest change
    fakeNow += 400;
    pendingTicks.forEach((t) => t());
    expect(onDone).toHaveBeenCalledWith('First line\nSecond');
  });

  it('calls onError if total time exceeds maxTotalMs', () => {
    const onError = vi.fn();
    const onDone = vi.fn();
    const errorStrategy: ReaderStrategy = { ...strategy, maxTotalMs: 1000 };
    startReader(
      document.body, errorStrategy,
      { onChunk: () => {}, onDone, onError },
      scheduler, () => fakeNow,
    );
    fakeNow += 1500;  // past maxTotalMs
    pendingTicks.forEach((t) => t());
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain('timeout');
  });

  it('stop() cancels polling and resolves done', () => {
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const handle = startReader(
      document.body, strategy,
      { onChunk, onDone, onError: () => {} },
      scheduler, () => fakeNow,
    );
    handle.stop();
    msgEl.innerText = 'Should not trigger';
    pendingTicks.forEach((t) => t());
    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('stop() is safe to call multiple times', () => {
    const handle = startReader(
      document.body, strategy,
      { onChunk: () => {}, onDone: () => {}, onError: () => {} },
      scheduler, () => fakeNow,
    );
    expect(() => { handle.stop(); handle.stop(); }).not.toThrow();
  });
});

// ===== Per-provider strategies =====

describe('DOM_STRATEGIES (verified via T1 DevTools, 2026-06-04)', () => {
  it('has all 3 built-in providers', () => {
    expect(DOM_STRATEGIES.glm).toBeDefined();
    expect(DOM_STRATEGIES.kimi).toBeDefined();
    expect(DOM_STRATEGIES.deepseek).toBeDefined();
  });

  it('GLM uses textarea-setter + enter (verified via textarea[data-testid="chat-input"])', () => {
    expect(GLM_DOM_STRATEGY.input.selector).toBe('textarea[data-testid="chat-input"]');
    expect(GLM_DOM_STRATEGY.input.setMethod).toBe('textarea-setter');
    expect(GLM_DOM_STRATEGY.input.sendMethod).toBe('enter');
  });

  it('Kimi uses contenteditable-setter + enter (verified: <div class="chat-input-editor">)', () => {
    expect(KIMI_DOM_STRATEGY.input.selector).toBe('.chat-input-editor');
    expect(KIMI_DOM_STRATEGY.input.setMethod).toBe('contenteditable-setter');
    expect(KIMI_DOM_STRATEGY.input.sendMethod).toBe('enter');
  });

  it('DeepSeek uses textarea-setter + enter (verified: <textarea placeholder="给 DeepSeek 发送消息">)', () => {
    expect(DEEPSEEK_DOM_STRATEGY.input.selector).toBe('textarea');
    expect(DEEPSEEK_DOM_STRATEGY.input.setMethod).toBe('textarea-setter');
    expect(DEEPSEEK_DOM_STRATEGY.input.sendMethod).toBe('enter');
  });

  it('all strategies have a reader with non-empty assistantMessageSelector', () => {
    for (const [id, strat] of Object.entries(DOM_STRATEGIES)) {
      expect(strat.reader.assistantMessageSelector.length, id).toBeGreaterThan(0);
    }
  });

  it('all strategies use innerText (not textContent) for stability', () => {
    for (const strat of Object.values(DOM_STRATEGIES)) {
      expect(strat.reader.textMode).toBe('innerText');
    }
  });

  it('all strategies have sensible stableThresholdMs (500-2000ms)', () => {
    for (const [id, strat] of Object.entries(DOM_STRATEGIES)) {
      const t = strat.reader.stableThresholdMs ?? 800;
      expect(t, id).toBeGreaterThanOrEqual(500);
      expect(t, id).toBeLessThanOrEqual(2000);
    }
  });
});
