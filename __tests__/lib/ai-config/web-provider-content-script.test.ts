/**
 * ⑨: Unit tests for the content script's needs-relogin trigger.
 *
 * Tests the pre-flight + mid-call checks in runDomRelayMainWorld that
 * detect "user is no longer logged in" and emit WEB_LLM_NEEDS_RELOGIN
 * instead of a generic WEB_LLM_ERROR.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runDomRelayMainWorld, type DomRelayRequest } from '@/lib/ai-config/web-provider-content-script';
import { GLM_DOM_STRATEGY } from '@/lib/ai-config/web-provider-dom-strategy';

/**
 * Spy on window.postMessage to capture the messages the content script sends
 * to the ISOLATED bridge.
 */
function installPostMessageSpy(): { messages: any[] } {
  const messages: any[] = [];
  const original = window.postMessage.bind(window);
  window.postMessage = vi.fn((data: any, targetOrigin: any) => {
    if (data && data.source === 'ceb-web-provider-main') {
      messages.push(data.payload);
    }
    // Also call original in case anything else listens.
    // Use the 2-arg overload (message + targetOrigin) which jsdom requires.
    // Cast through `unknown` to bypass TS overload picking (TS may prefer
    // the WindowPostMessageOptions overload which doesn't accept a string).
    return (original as unknown as (data: any, targetOrigin: any) => void)(data, targetOrigin);
  });
  return { messages };
}

function makeRequest(overrides: Partial<DomRelayRequest> = {}): DomRelayRequest {
  return {
    providerId: 'glm',
    modelId: 'glm-4.6',
    message: 'hello',
    domStrategy: GLM_DOM_STRATEGY,
    ...overrides,
  };
}

describe('runDomRelayMainWorld (⑨: needs-relogin detection)', () => {
  let postSpy: { messages: any[] };

  beforeEach(() => {
    postSpy = installPostMessageSpy();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    // Restore any vi.spyOn mocks (e.g., document.querySelector) so they
    // don't leak to the next test.
    vi.restoreAllMocks();
  });

  it('emits WEB_LLM_NEEDS_RELOGIN when input element is not present (pre-flight check)', async () => {
    // No textarea on the page (user is on a login wall)
    await runDomRelayMainWorld(makeRequest());
    expect(postSpy.messages).toHaveLength(1);
    expect(postSpy.messages[0].type).toBe('WEB_LLM_NEEDS_RELOGIN');
    expect(postSpy.messages[0].providerId).toBe('glm');
    expect(postSpy.messages[0].status).toBe(401);
    expect(postSpy.messages[0].message).toContain('no longer logged in');
  });

  it('emits WEB_LLM_NEEDS_RELOGIN when input disappears between pre-flight and set', async () => {
    // Simulate a race: element exists at pre-flight but is removed before set.
    // We mock querySelector to return the element on the first call (pre-flight)
    // and null on subsequent calls.
    const original = document.querySelector.bind(document);
    let callCount = 0;
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      callCount++;
      if (callCount === 1) {
        // Pre-flight: return a fake element
        return original(sel) ?? document.createElement('textarea');
      }
      // Subsequent calls: element has disappeared
      return null;
    });
    await runDomRelayMainWorld(makeRequest());
    expect(postSpy.messages).toHaveLength(1);
    expect(postSpy.messages[0].type).toBe('WEB_LLM_NEEDS_RELOGIN');
    expect(postSpy.messages[0].message).toContain('disappeared');
  });

  it('emits WEB_LLM_CHUNK + WEB_LLM_DONE when input is present (normal flow)', async () => {
    // Set up a textarea + an assistant message element
    const ta = document.createElement('textarea');
    ta.setAttribute('data-testid', 'chat-input');
    document.body.appendChild(ta);
    const msgEl = document.createElement('div');
    msgEl.className = 'markdown-body';
    msgEl.textContent = 'old reply';
    document.body.appendChild(msgEl);

    // Track that input + change events are fired (React/Lexical reconciler
    // requires change to commit, not just input).
    const events: string[] = [];
    ta.addEventListener('input', () => events.push('input'));
    ta.addEventListener('change', () => events.push('change'));

    // New turn updates the assistant text.
    setTimeout(() => {
      msgEl.textContent = 'AI reply text';
    }, 150);

    await runDomRelayMainWorld(makeRequest());
    // Should NOT emit relogin
    const types = postSpy.messages.map((m: any) => m.type);
    expect(types).not.toContain('WEB_LLM_NEEDS_RELOGIN');
    expect(types).not.toContain('WEB_LLM_ERROR');
    expect(events).toContain('change');
  });

  it('textarea send path dispatches both input AND change on the element (React-friendly)', async () => {
    const ta = document.createElement('textarea');
    ta.setAttribute('data-testid', 'chat-input');
    document.body.appendChild(ta);
    const msgEl = document.createElement('div');
    msgEl.className = 'markdown-body';
    msgEl.textContent = 'old';
    document.body.appendChild(msgEl);

    const fired: string[] = [];
    ta.addEventListener('input', () => fired.push('input'));
    ta.addEventListener('change', () => fired.push('change'));

    setTimeout(() => {
      msgEl.textContent = 'reply-1';
    }, 100);

    await runDomRelayMainWorld(makeRequest());
    // Change is required for React's onChange to fire after value-setter writes.
    expect(fired).toContain('input');
    expect(fired).toContain('change');
  });

  it('pre-flight check uses the strategy.input.selector (not hardcoded)', async () => {
    // Test that a custom strategy with a non-existent selector triggers relogin
    const customStrategy = {
      ...GLM_DOM_STRATEGY,
      input: { ...GLM_DOM_STRATEGY.input, selector: '.custom-non-existent' },
    };
    await runDomRelayMainWorld(makeRequest({ domStrategy: customStrategy }));
    expect(postSpy.messages).toHaveLength(1);
    expect(postSpy.messages[0].type).toBe('WEB_LLM_NEEDS_RELOGIN');
  });

  it('serialized runDomRelayMainWorld remains self-contained (no outer helper refs)', async () => {
    const ta = document.createElement('textarea');
    ta.setAttribute('data-testid', 'chat-input');
    document.body.appendChild(ta);

    const msgEl = document.createElement('div');
    msgEl.className = 'markdown-body';
    msgEl.textContent = 'old reply';
    document.body.appendChild(msgEl);

    setTimeout(() => {
      msgEl.textContent = 'AI reply text';
    }, 150);

    // Simulate chrome.scripting.executeScript function serialization boundary:
    // only the function body survives, no surrounding module scope helpers.
    const serializedFn = (0, eval)(`(${runDomRelayMainWorld.toString()})`) as typeof runDomRelayMainWorld;
    await serializedFn(makeRequest());

    const types = postSpy.messages.map((m: any) => m.type);
    expect(types).not.toContain('WEB_LLM_ERROR');
    expect(types).toContain('WEB_LLM_CHUNK');
    expect(types).toContain('WEB_LLM_DONE');
  });

  it('ignores pre-existing assistant message and emits only the current turn reply', async () => {
    const ta = document.createElement('textarea');
    ta.setAttribute('data-testid', 'chat-input');
    document.body.appendChild(ta);

    // Old reply already on page before this turn starts.
    const oldEl = document.createElement('div');
    oldEl.className = 'markdown-body';
    oldEl.textContent = 'OLD_REPLY';
    document.body.appendChild(oldEl);

    // Simulate the new turn's assistant message appearing later.
    setTimeout(() => {
      const newEl = document.createElement('div');
      newEl.className = 'markdown-body';
      newEl.textContent = 'NEW_REPLY';
      document.body.appendChild(newEl);
    }, 200);

    await runDomRelayMainWorld(makeRequest());

    const chunks = postSpy.messages
      .filter((m: any) => m.type === 'WEB_LLM_CHUNK')
      .map((m: any) => m.text);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toBe('NEW_REPLY');
    expect(chunks).not.toContain('OLD_REPLY');
  });

  it('does not treat unchanged pre-existing assistant text as this turn result (times out instead)', async () => {
    const ta = document.createElement('textarea');
    ta.setAttribute('data-testid', 'chat-input');
    document.body.appendChild(ta);

    const oldEl = document.createElement('div');
    oldEl.className = 'markdown-body';
    oldEl.textContent = 'OLD_STATIC_REPLY';
    document.body.appendChild(oldEl);

    const fastTimeoutStrategy = {
      ...GLM_DOM_STRATEGY,
      reader: {
        ...GLM_DOM_STRATEGY.reader,
        pollIntervalMs: 50,
        stableThresholdMs: 100,
        maxTotalMs: 400,
      },
    };

    await runDomRelayMainWorld(makeRequest({ domStrategy: fastTimeoutStrategy }));

    const chunks = postSpy.messages
      .filter((m: any) => m.type === 'WEB_LLM_CHUNK')
      .map((m: any) => m.text);
    const types = postSpy.messages.map((m: any) => m.type);

    expect(chunks).not.toContain('OLD_STATIC_REPLY');
    expect(types).toContain('WEB_LLM_ERROR');
    expect(types).not.toContain('WEB_LLM_DONE');
  });

  it('sends Enter to the input element that was set (not a later activeElement)', async () => {
    const ta = document.createElement('textarea');
    ta.setAttribute('data-testid', 'chat-input');
    document.body.appendChild(ta);

    const distractor = document.createElement('input');
    document.body.appendChild(distractor);

    // Simulate provider behavior: only the real chat input handles Enter and
    // produces a new assistant message.
    ta.addEventListener('keydown', (ev) => {
      const kev = ev as KeyboardEvent;
      if (kev.key === 'Enter') {
        const out = document.createElement('div');
        out.className = 'markdown-body';
        out.textContent = 'SENT_OK';
        document.body.appendChild(out);
      }
    });

    const strategy = {
      ...GLM_DOM_STRATEGY,
      input: {
        ...GLM_DOM_STRATEGY.input,
        settleDelayMs: 80,
      },
      reader: {
        ...GLM_DOM_STRATEGY.reader,
        pollIntervalMs: 50,
        stableThresholdMs: 100,
        maxTotalMs: 1000,
      },
    };

    // Focus shifts away before send executes.
    setTimeout(() => {
      distractor.focus();
    }, 20);

    await runDomRelayMainWorld(makeRequest({ domStrategy: strategy }));

    const chunks = postSpy.messages
      .filter((m: any) => m.type === 'WEB_LLM_CHUNK')
      .map((m: any) => m.text);
    const types = postSpy.messages.map((m: any) => m.type);

    expect(chunks).toContain('SENT_OK');
    expect(types).toContain('WEB_LLM_DONE');
    expect(types).not.toContain('WEB_LLM_ERROR');
  });
});
