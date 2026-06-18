/**
 * ⑤ T④ — sidepanel handler for `web_provider_needs_relogin` ServerMessage.
 *
 * Triggered by ⑤.2 (SW broadcasts after a 401/403 from a web provider).
 * The sidepanel should:
 *   1. Show a destructive toast (user-friendly message)
 *   2. Open Settings, scrolled to the failed provider
 *
 * Testability: pure function with injected deps (showToast, openSettings).
 * Wired into hooks/useBackgroundAgent.ts switch case.
 */

import type { ServerMessage } from '@/lib/protocol';

export interface WebProviderNeedsReloginDeps {
  /** Show a toast (sonner-compatible). Called with { variant, title, description }. */
  showToast: (opts: { variant: 'destructive' | 'default'; title: string; description: string }) => void;
  /** Open Settings view, scrolled to the failed provider. */
  openSettings: (providerId: 'glm') => void;
}

/** Human-friendly provider display name (for toast title). */
const PROVIDER_DISPLAY_NAME: Record<'glm', string> = {
  glm: 'GLM',
};

/**
 * Pure handler: inspects the message, shows toast + opens Settings.
 * Returns true if handled, false to let other switch cases process.
 */
export function handleWebProviderNeedsRelogin(
  msg: ServerMessage,
  deps: WebProviderNeedsReloginDeps,
): boolean {
  if (msg.type !== 'web_provider_needs_relogin') return false;

  // 1. Show toast FIRST so the user sees the notification even if the
  //    view change is slow (e.g., Settings is heavy to render).
  //    Always prefix the description with the provider name so the user
  //    knows WHICH provider expired (the message from the SW may be generic).
  deps.showToast({
    variant: 'destructive',
    title: `${PROVIDER_DISPLAY_NAME[msg.providerId]} session expired`,
    description: `${PROVIDER_DISPLAY_NAME[msg.providerId]}: ${msg.message}`,
  });

  // 2. Open Settings, scrolled to the failed provider card.
  deps.openSettings(msg.providerId);

  return true;
}
