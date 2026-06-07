import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext } from '../helpers/extension';
import { awaitUserLogin, waitForAssistantReply } from '../helpers/chatglm';

/**
 * E2E Item 4: 3-turn conversation with no 60s timeout regression.
 *
 * The original Kimi/GLM timeout bug (the "Reader timeout after 60000ms"
 * from earlier history) was caused by the DOM relay reading the wrong
 * message (history instead of current reply). The fix introduced a
 * turn-boundary baseline gate. This spec exercises that gate by sending
 * 3 messages in succession and asserting each gets a reply within 60s.
 *
 * ⚠️ Same login caveat as Item 3 — user logs in to chatglm.cn once.
 */
test.describe('E2E Item 4: multi-turn', () => {
  let ext: ExtensionContext;

  test.beforeAll(async () => {
    ext = await launchWithExtension();
  }, 60_000);

  test.afterAll(async () => {
    await ext.context.close();
  });

  test('3 consecutive turns each get a reply within 60s', async () => {
    test.setTimeout(8 * 60 * 1000); // login + 3 × 60s

    const glmTab = await ext.openChatglmTab();
    await awaitUserLogin(glmTab);

    const sidepanelUrl = `chrome-extension://${ext.extensionId}/sidepanel.html`;
    const sidepanel = await ext.context.newPage();
    await sidepanel.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await sidepanel.waitForLoadState('networkidle', { timeout: 15_000 });

    const chatInput = sidepanel.locator(
      'textarea, [contenteditable="true"], input[type="text"]',
    ).first();
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    const turns = [
      'Reply with the single word: ONE',
      'Reply with the single word: TWO',
      'Reply with the single word: THREE',
    ];

    for (const prompt of turns) {
      await chatInput.fill(prompt);
      await chatInput.press('Enter');
      const reply = await waitForAssistantReply(glmTab, prompt, 60_000);
      expect(reply.length, `turn "${prompt}" should get a non-empty reply`).toBeGreaterThan(0);
    }
  });
});
