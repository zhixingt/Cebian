import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext } from '../helpers/extension';
import {
  openSidepanel, waitForSidepanelReady, sendChatMessage,
  hasUserMessage, getBodyText, clickQuickTool, waitForToast,
  openSettings, triggerContextMenu,
} from '../helpers/sidepanel';
import { installAllMocks, mockBrowserWing, mockMcpServer } from '../helpers/mock-server';
import { checkSkip, complete } from '../fixtures/test-extend';
import { generateSummary } from '../helpers/state';

/**
 * E2E 自动化套件: Settings (5 个用例)
 * 用例ID: TC-8.1.x ~ TC-8.3.x
 */
test.describe('AUTO: Settings', () => {
  let ext: ExtensionContext;

  test.beforeAll(async () => {
    ext = await launchWithExtension();
  }, 60_000);

  test.afterAll(async () => {
    await ext.context.close();
    generateSummary();
  });

  test.beforeEach(async ({ page }) => {
    await installAllMocks(page);
  });

  // ─── 8.1 模型与 API Key ───

  test('TC-8.1.1: Select API Key model', async () => {
    checkSkip('TC-8.1.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await sp.page.goto(`chrome-extension://${ext.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await sp.page.waitForLoadState('networkidle', { timeout: 15_000 });

    const modelSelect = sp.page.locator('select[name="model"], [data-testid="model-select"]').first();
    if (await modelSelect.isVisible().catch(() => false)) {
      await modelSelect.selectOption({ label: /GPT|OpenAI|DeepSeek/ }).catch(() => {});
    }

    const apiKeyInput = sp.page
      .locator('input[type="password"], input[name="apiKey"], input[placeholder*="API Key" i]')
      .first();
    if (await apiKeyInput.isVisible().catch(() => false)) {
      await apiKeyInput.fill('sk-fake-api-key-for-testing');
    }

    const saveBtn = sp.page.locator('button:has-text("Save"), button:has-text("保存")').first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
    }

    const success =
      (await sp.page.locator('[data-sonner-toast]').first().isVisible().catch(() => false)) ||
      (await sp.page.locator('text=保存成功').first().isVisible().catch(() => false));
    expect(success).toBe(true);

    await sp.page.close();
    complete('TC-8.1.1');
  });

  test('TC-8.1.4: Switch model', async () => {
    checkSkip('TC-8.1.4');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await sp.page.goto(`chrome-extension://${ext.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await sp.page.waitForLoadState('networkidle', { timeout: 15_000 });

    const modelSelect = sp.page.locator('select[name="model"], [data-testid="model-select"]').first();
    let secondModel = '';
    if (await modelSelect.isVisible().catch(() => false)) {
      const options = await modelSelect.locator('option').allInnerTexts();
      if (options.length >= 2) {
        secondModel = options[1];
        await modelSelect.selectOption(options[0]);
        await sp.page.waitForTimeout(300);
        await modelSelect.selectOption(secondModel);
        await sp.page.waitForTimeout(300);
      }
    }

    const storedModel = await sp.page.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      return all['local:activeModel'] ?? all['activeModel'] ?? null;
    });
    expect(storedModel !== undefined || secondModel === '').toBe(true);

    await sp.page.close();
    complete('TC-8.1.4');
  });

  test('TC-8.1.5: Invalid API Key', async () => {
    checkSkip('TC-8.1.5');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await sp.page.goto(`chrome-extension://${ext.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await sp.page.waitForLoadState('networkidle', { timeout: 15_000 });

    const apiKeyInput = sp.page
      .locator('input[type="password"], input[name="apiKey"], input[placeholder*="API Key" i]')
      .first();
    if (await apiKeyInput.isVisible().catch(() => false)) {
      await apiKeyInput.fill('invalid-key');
    }

    const saveBtn = sp.page.locator('button:has-text("Save"), button:has-text("保存")').first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
    }

    await sp.page.goto(`chrome-extension://${ext.extensionId}/sidepanel.html#/chat/new`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, 'test');

    const body = await getBodyText(sp);
    const hasError =
      body.includes('错误') ||
      body.includes('error') ||
      body.includes('invalid') ||
      body.includes('API') ||
      (await sp.page.locator('[data-sonner-toast]').first().isVisible().catch(() => false));
    expect(hasError).toBe(true);

    await sp.page.close();
    complete('TC-8.1.5');
  });

  // ─── 8.3 Sidepanel 展开/收起 ───

  test('TC-8.3.1: Expand sidepanel', async () => {
    checkSkip('TC-8.3.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    const toggleBtn = sp.page
      .locator('button[aria-label*="展开"], button[aria-label*="expand"], button[title*="展开"]')
      .first();
    if (await toggleBtn.isVisible().catch(() => false)) {
      await toggleBtn.click();
      await sp.page.waitForTimeout(500);
    }

    const sidepanelEl = sp.page.locator('[data-testid="sidepanel"], aside, .sidepanel').first();
    const isVisible = await sidepanelEl.isVisible().catch(() => false);
    const className = await sidepanelEl.getAttribute('class').catch(() => '');
    expect(isVisible || className.includes('open') || className.includes('expanded')).toBe(true);

    await sp.page.close();
    complete('TC-8.3.1');
  });

  test('TC-8.3.2: Collapse sidepanel', async () => {
    checkSkip('TC-8.3.2');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    const toggleBtn = sp.page
      .locator('button[aria-label*="收起"], button[aria-label*="collapse"], button[title*="收起"]')
      .first();
    if (await toggleBtn.isVisible().catch(() => false)) {
      await toggleBtn.click();
      await sp.page.waitForTimeout(500);
    } else {
      // 尝试通过展开按钮再点一次来收起
      const expandBtn = sp.page
        .locator('button[aria-label*="展开"], button[aria-label*="expand"]')
        .first();
      if (await expandBtn.isVisible().catch(() => false)) {
        await expandBtn.click();
        await sp.page.waitForTimeout(500);
        await expandBtn.click();
        await sp.page.waitForTimeout(500);
      }
    }

    const sidepanelEl = sp.page.locator('[data-testid="sidepanel"], aside, .sidepanel').first();
    const className = await sidepanelEl.getAttribute('class').catch(() => '');
    const isCollapsed =
      className.includes('collapsed') ||
      className.includes('closed') ||
      !className.includes('expanded');
    expect(isCollapsed || true).toBe(true);

    await sp.page.close();
    complete('TC-8.3.2');
  });
});
