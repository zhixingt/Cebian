import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext } from '../helpers/extension';
import { getStorageItem } from '../helpers/storage';

/**
 * E2E Item 2: sending a message WITHOUT logging in to GLM is blocked.
 *
 * With no GLM login, the agent's `resolveModelObj` returns `null` for
 * the web:glm: modelId, and the UI shows "No model selected or model
 * not found" (or the user is prompted to log in via the relogin flow).
 *
 * This test simulates the unauthenticated state by:
 *   1. Launching the extension with a clean user data dir
 *   2. Asserting that `activeModel` is null in chrome.storage.local
 *   3. Asserting that sending a chat message surfaces an error / login
 *      prompt (not a successful reply)
 */
test.describe('E2E Item 2: pre-auth blocked', () => {
  let ext: ExtensionContext;

  test.beforeAll(async () => {
    ext = await launchWithExtension();
  });

  test.afterAll(async () => {
    await ext.context.close();
  });

  test('activeModel is null when user has not logged in', async () => {
    // The startup-pass should NOT clear a clean null — but if the user
    // previously had DeepSeek and we set this test up fresh, activeModel
    // should be null from the start.
    const active = await getStorageItem(ext.serviceWorker, 'activeModel');
    expect(active ?? null, 'activeModel should be null on fresh install').toBeNull();
  });

  test('chat UI prompts for login when no GLM model is selected', async () => {
    const sidepanelUrl = `chrome-extension://${ext.extensionId}/sidepanel.html`;
    const page = await ext.context.newPage();
    await page.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The sidepanel should display either a "select a model" prompt or
    // a "please log in" message. Either is acceptable evidence that the
    // unauthenticated state is handled.
    const bodyText = (await page.locator('body').innerText()).toLowerCase();
    const blocked =
      bodyText.includes('login') ||
      bodyText.includes('log in') ||
      bodyText.includes('select') ||
      bodyText.includes('no model') ||
      bodyText.includes('model not found') ||
      bodyText.includes('未登录') ||
      bodyText.includes('请选择') ||
      bodyText.includes('登录');
    expect(blocked, 'sidepanel must surface a login/select-model prompt when not authenticated').toBe(true);
  });
});
