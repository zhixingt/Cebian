import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext } from '../helpers/extension';
import { awaitUserLogin, sendMessage, waitForAssistantReply } from '../helpers/chatglm';

/**
 * E2E Item 3: log in to GLM, send a message, receive a full reply.
 *
 * ⚠️ This spec requires the user to log in to chatglm.cn ONCE while the
 * test is running. The harness opens a chatglm.cn tab and the user
 * completes the login (password, captcha, etc.) within 5 minutes.
 *
 * The flow:
 *   1. Harness launches Chrome with the extension
 *   2. Harness opens a chatglm.cn tab
 *   3. USER logs in to chatglm.cn (manual, up to 5 min)
 *   4. Harness sends "hello" via the sidepanel
 *   5. Harness reads the reply (via DOM polling)
 *   6. Harness asserts the reply is non-empty
 */
test.describe('E2E Item 3: send + receive', () => {
  let ext: ExtensionContext;

  test.beforeAll(async () => {
    ext = await launchWithExtension();
  }, 60_000);

  test.afterAll(async () => {
    await ext.context.close();
  });

  test('login → send message → receive reply', async () => {
    test.setTimeout(7 * 60 * 1000); // 5 min login + 2 min chat

    // 1. Open chatglm.cn and wait for user to log in
    const glmTab = await ext.openChatglmTab();
    await awaitUserLogin(glmTab);

    // 2. Open the sidepanel and ensure GLM is selected
    const sidepanelUrl = `chrome-extension://${ext.extensionId}/sidepanel.html`;
    const sidepanel = await ext.context.newPage();
    await sidepanel.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await sidepanel.waitForLoadState('networkidle', { timeout: 15_000 });

    // 3. Send a message via the sidepanel chat input
    const chatInput = sidepanel.locator(
      'textarea, [contenteditable="true"], input[type="text"]',
    ).first();
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    const prompt = 'Reply with the single word: PONG';
    await chatInput.fill(prompt);
    await chatInput.press('Enter');

    // 4. Wait for the reply in the chatglm.cn tab (where the model
    //    actually streams the response)
    const reply = await waitForAssistantReply(glmTab, prompt, 90_000);
    expect(reply.length, 'reply should be non-empty').toBeGreaterThan(0);
  });
});
