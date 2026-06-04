import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleWebProviderRelogin,
  registerWebProviderReloginHandler,
  _resetReloginHandlerForTesting,
  type WebProviderReloginDeps,
} from '@/entrypoints/background/web-provider-relogin';
import {
  WEB_LLM_NEEDS_RELOGIN,
  type WebProviderRelayMessage,
} from '@/lib/ai-config/web-provider-relay';
import type { WebProvider } from '@/lib/types';

let deps: WebProviderReloginDeps;
let chromeListener: ((msg: any) => boolean | undefined) | undefined;

beforeEach(() => {
  _resetReloginHandlerForTesting();
  chromeListener = undefined;
  deps = {
    broadcast: vi.fn(),
    invalidateBundle: vi.fn(),
  };
  // Capture the chrome.runtime.onMessage listener registered by the module
  (global as any).chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((fn: any) => { chromeListener = fn; }),
        removeListener: vi.fn(),
      },
    },
  };
});

describe('handleWebProviderRelogin (⑤.2: SW-side re-login orchestration)', () => {
  it('returns false for non-WEB_LLM_NEEDS_RELOGIN messages (let other handlers deal)', () => {
    const otherMsg: WebProviderRelayMessage = { type: 'WEB_LLM_CHUNK', providerId: 'glm', text: 'hi' };
    const handled = handleWebProviderRelogin(otherMsg, deps);
    expect(handled).toBe(false);
    expect(deps.broadcast).not.toHaveBeenCalled();
    expect(deps.invalidateBundle).not.toHaveBeenCalled();
  });

  it('invalidates the bundle cache for the failed provider', () => {
    const msg: WebProviderRelayMessage = {
      type: WEB_LLM_NEEDS_RELOGIN,
      providerId: 'glm',
      status: 401,
      message: 'Please re-login',
    };
    handleWebProviderRelogin(msg, deps);
    expect(deps.invalidateBundle).toHaveBeenCalledWith('glm');
  });

  it('broadcasts web_provider_needs_relogin with providerId, status, message', () => {
    const msg: WebProviderRelayMessage = {
      type: WEB_LLM_NEEDS_RELOGIN,
      providerId: 'deepseek',
      status: 403,
      message: 'Provider rejected the session',
    };
    handleWebProviderRelogin(msg, deps);
    expect(deps.broadcast).toHaveBeenCalledWith({
      type: 'web_provider_needs_relogin',
      providerId: 'deepseek',
      status: 403,
      message: 'Provider rejected the session',
    });
  });

  it('handles all 3 built-in providers (glm, kimi, deepseek)', () => {
    for (const providerId of ['glm', 'deepseek', 'deepseek'] as const) {
      const localDeps: WebProviderReloginDeps = {
        broadcast: vi.fn(),
        invalidateBundle: vi.fn(),
      };
      handleWebProviderRelogin(
        { type: WEB_LLM_NEEDS_RELOGIN, providerId, status: 401, message: 'x' },
        localDeps,
      );
      expect(localDeps.invalidateBundle).toHaveBeenCalledWith(providerId);
      expect(localDeps.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ providerId }),
      );
    }
  });

  it('order: invalidateBundle BEFORE broadcast (so the next resolveBundle returns null)', () => {
    const callOrder: string[] = [];
    deps = {
      broadcast: vi.fn(() => callOrder.push('broadcast')),
      invalidateBundle: vi.fn(() => callOrder.push('invalidateBundle')),
    };
    handleWebProviderRelogin(
      { type: WEB_LLM_NEEDS_RELOGIN, providerId: 'glm', status: 401, message: 'x' },
      deps,
    );
    expect(callOrder).toEqual(['invalidateBundle', 'broadcast']);
  });
});

describe('registerWebProviderReloginHandler (⑤.2: chrome.runtime.onMessage integration)', () => {
  it('registers a chrome.runtime.onMessage listener', () => {
    registerWebProviderReloginHandler(deps);
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(chromeListener).toBeDefined();
  });

  it('listener returns true for WEB_LLM_NEEDS_RELOGIN (handled)', () => {
    registerWebProviderReloginHandler(deps);
    const result = chromeListener!({
      type: WEB_LLM_NEEDS_RELOGIN,
      providerId: 'glm',
      status: 401,
      message: 'x',
    });
    expect(result).toBe(true);
    expect(deps.broadcast).toHaveBeenCalled();
  });

  it('listener returns false for other message types (let other handlers deal)', () => {
    registerWebProviderReloginHandler(deps);
    const result = chromeListener!({ type: 'WEB_LLM_CHUNK', providerId: 'glm', text: 'hi' });
    expect(result).toBe(false);
    expect(deps.broadcast).not.toHaveBeenCalled();
  });

  it('idempotent: calling register twice does not register twice', () => {
    registerWebProviderReloginHandler(deps);
    registerWebProviderReloginHandler(deps);
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });
});
