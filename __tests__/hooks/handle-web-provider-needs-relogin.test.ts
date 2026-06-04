import { describe, it, expect, vi } from 'vitest';
import {
  handleWebProviderNeedsRelogin,
  type WebProviderNeedsReloginDeps,
} from '@/hooks/handle-web-provider-needs-relogin';
import type { ServerMessage } from '@/lib/protocol';

function makeDeps(overrides: Partial<WebProviderNeedsReloginDeps> = {}): WebProviderNeedsReloginDeps {
  return {
    showToast: vi.fn(),
    openSettings: vi.fn(),
    ...overrides,
  };
}

function makeMsg(overrides: Partial<Extract<ServerMessage, { type: 'web_provider_needs_relogin' }>> = {}): Extract<ServerMessage, { type: 'web_provider_needs_relogin' }> {
  return {
    type: 'web_provider_needs_relogin',
    providerId: 'glm',
    status: 401,
    message: 'Please re-login to glm via Settings → Web Providers.',
    ...overrides,
  };
}

describe('handleWebProviderNeedsRelogin (⑤.4: sidepanel handler for 401/403)', () => {
  it('returns false for non-web_provider_needs_relogin messages (let other handlers process)', () => {
    const deps = makeDeps();
    const result = handleWebProviderNeedsRelogin({ type: 'connected' } as any, deps);
    expect(result).toBe(false);
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.openSettings).not.toHaveBeenCalled();
  });

  it('returns true for web_provider_needs_relogin messages (handled)', () => {
    const deps = makeDeps();
    const result = handleWebProviderNeedsRelogin(makeMsg(), deps);
    expect(result).toBe(true);
  });

  it('shows a toast with the user-friendly message (destructive variant for 401/403)', () => {
    const deps = makeDeps();
    handleWebProviderNeedsRelogin(
      makeMsg({ providerId: 'kimi', status: 403, message: 'Forbidden' }),
      deps,
    );
    expect(deps.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: expect.stringMatching(/Kimi|re-login/i),
      }),
    );
  });

  it('calls openSettings to navigate the user to the Web providers section', () => {
    const deps = makeDeps();
    handleWebProviderNeedsRelogin(makeMsg({ providerId: 'deepseek' }), deps);
    expect(deps.openSettings).toHaveBeenCalledWith('deepseek');
  });

  it('handles all 3 built-in providers (glm, kimi, deepseek)', () => {
    for (const providerId of ['glm', 'kimi', 'deepseek'] as const) {
      const deps = makeDeps();
      handleWebProviderNeedsRelogin(makeMsg({ providerId }), deps);
      expect(deps.openSettings).toHaveBeenCalledWith(providerId);
      expect(deps.showToast).toHaveBeenCalledTimes(1);
    }
  });

  it('order: showToast BEFORE openSettings (so the user sees the notification when the view changes)', () => {
    const order: string[] = [];
    const deps: WebProviderNeedsReloginDeps = {
      showToast: vi.fn(() => order.push('showToast')),
      openSettings: vi.fn(() => order.push('openSettings')),
    };
    handleWebProviderNeedsRelogin(makeMsg(), deps);
    expect(order).toEqual(['showToast', 'openSettings']);
  });
});
