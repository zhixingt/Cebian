/**
 * Pure helper: should the `activeModel` storage entry be cleared when a
 * specific web provider is logged out?
 *
 * Why this matters: when the user clicks "Logout" on a WebProviderCard, the
 * provider's `loginStatus` flips to `loggedOut`, which removes it from the
 * model selector's "Web (Logged in)" group (see `getAvailableWebModels` in
 * `web-provider-models.ts`). But `activeModel` in `chrome.storage.local`
 * still points at `web:<presetId>:<modelId>` — so the next chat attempt
 * resolves the model to `null` (provider no longer in the list), the agent
 * manager returns "No model selected or model not found", and the user is
 * confused. Clearing `activeModel` here is the simplest fix: the chat UI
 * shows the normal "need model" prompt and the user re-selects after
 * re-login.
 *
 * Returns `true` ONLY when:
 *   - activeModel is non-null
 *   - activeModel.provider === 'web'
 *   - activeModel.modelId starts with `web:<loggedOutProviderId>:` (the
 *     colon separator is the boundary; `glm` must NOT match `glm-2`)
 *
 * Note: better UX would be to keep the model in the selector with a
 * "needs login" badge and show a clear "please re-login" message in the
 * chat. That's a larger change to the selector UI + agent error path;
 * see issue notes for follow-up.
 */
export function shouldClearActiveModel(
  activeModel: { provider: string; modelId: string } | null,
  loggedOutProviderId: string,
): boolean {
  if (!activeModel) return false;
  if (activeModel.provider !== 'web') return false;
  return activeModel.modelId.startsWith(`web:${loggedOutProviderId}:`);
}

/**
 * Pure helper: should the `activeModel` storage entry be AUTO-SELECTED
 * when a web provider login succeeds?
 *
 * 2026-06-07 real-E2E: after a successful login, the user got
 * "No model selected or model not found" because `activeModel` was
 * still null (the previous logout had cleared it; the new login
 * restored the provider but did NOT re-pick a model).
 *
 * Returns `true` ONLY when the user has NO model currently selected.
 * We do NOT auto-select over a non-null model (e.g. a non-web
 * provider the user explicitly chose) — that would silently switch
 * their model on login, which is hostile UX.
 */
export function shouldAutoSelectOnLogin(
  currentActiveModel: { provider: string; modelId: string } | null,
): boolean {
  return currentActiveModel === null;
}
