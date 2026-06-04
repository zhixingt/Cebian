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
    msgEl.innerText = 'AI reply text';
    document.body.appendChild(msgEl);

    await runDomRelayMainWorld(makeRequest());
    // Should NOT emit relogin
    const types = postSpy.messages.map((m: any) => m.type);
    expect(types).not.toContain('WEB_LLM_NEEDS_RELOGIN');
    expect(types).not.toContain('WEB_LLM_ERROR');
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
});
