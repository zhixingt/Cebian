import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext } from '../helpers/extension';

/**
 * E2E Item 1: Web Provider section in Settings shows ONLY GLM.
 *
 * After the DeepSeek + Kimi removal, the Settings → Web Provider section
 * must not surface those providers. The test asserts the rendered
 * settings page lists only GLM.
 *
 * What this test does NOT cover:
 *   - The "available models" selector in the chat sidebar (a separate UI
 *     surface that mirrors the same preset list; covered indirectly by
 *     Item 6's data-layer assertions).
 */
test.describe('E2E Item 1: only GLM in Web Provider', () => {
  let ext: ExtensionContext;

  test.beforeAll(async () => {
    ext = await launchWithExtension();
  });

  test.afterAll(async () => {
    await ext.context.close();
  });

  test('settings page lists only GLM, not DeepSeek/Kimi', async () => {
    const settingsUrl = `chrome-extension://${ext.extensionId}/settings.html`;
    const page = await ext.context.newPage();
    await page.goto(settingsUrl, { waitUntil: 'domcontentloaded' });
    // Wait for the Web Provider section to render
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const bodyText = (await page.locator('body').innerText()).toLowerCase();
    expect(bodyText, 'settings page should be reachable').toBeTruthy();

    // Must mention GLM
    expect(bodyText, 'should mention GLM').toContain('glm');

    // Must NOT mention the removed web providers
    expect(bodyText, 'should not mention deepseek web provider').not.toContain('deepseek');
    expect(bodyText, 'should not mention kimi web provider').not.toContain('kimi');
  });
});
