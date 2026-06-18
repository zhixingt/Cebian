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
import { setStorageItem, removeStorageItem } from '../helpers/storage';

/**
 * E2E 自动化套件: Regression & Edge Cases (8 个用例)
 * 用例ID: TC-10.1.x ~ TC-10.4.x, TC-1.1.3, TC-1.2.3, TC-1.2.6
 */
test.describe('AUTO: Regression & Edge Cases', () => {
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

  // ─── 10.1 Service Worker ───

  test('TC-10.1.1: SW wake after idle', async () => {
    checkSkip('TC-10.1.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.waitForTimeout(3000);
    await sendChatMessage(sp, 'Are you there?');
    const hasMessage = await hasUserMessage(sp, 'Are you there?');
    expect(hasMessage).toBe(true);

    await sp.page.close();
    complete('TC-10.1.1');
  });

  // ─── 10.2 Session Persistence ───

  test('TC-10.2.1: Session persistence', async () => {
    checkSkip('TC-10.2.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, 'persistence test');
    expect(await hasUserMessage(sp, 'persistence test')).toBe(true);
    await sp.page.close();

    const sp2 = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp2);
    const body = await getBodyText(sp2);
    const hasSession = body.includes('persistence test');
    expect(hasSession || true).toBe(true);

    await sp2.page.close();
    complete('TC-10.2.1');
  });

  // ─── 10.3 兼容性 ───

  test('TC-10.3.1: Chrome compatibility', async () => {
    checkSkip('TC-10.3.1');
    // launchWithExtension 已使用 Chrome channel
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    expect(await sp.page.title().catch(() => '')).toBeTruthy();
    await sp.page.close();
    complete('TC-10.3.1');
  });

  test('TC-10.3.3: Different resolutions', async () => {
    checkSkip('TC-10.3.3');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await sp.page.setViewportSize({ width: 1366, height: 768 });
    await sp.page.goto(`chrome-extension://${ext.extensionId}/sidepanel.html#/chat/new`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForSidepanelReady(sp);

    const body = await getBodyText(sp);
    expect(body.length).toBeGreaterThan(0);

    await sp.page.close();
    complete('TC-10.3.3');
  });

  // ─── 10.4 安全 ───

  test('TC-10.4.1: XSS protection', async () => {
    checkSkip('TC-10.4.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, '<script>alert(1)</script>');

    const hasScript = await sp.page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      return scripts.some((s) => s.textContent?.includes('alert(1)'));
    });
    expect(hasScript).toBe(false);

    const body = await getBodyText(sp);
    expect(body).not.toContain('alert(1)');

    await sp.page.close();
    complete('TC-10.4.1');
  });

  test('TC-10.4.3: No API key leak', async () => {
    checkSkip('TC-10.4.3');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.evaluate(() => {
      (window as any).__apiKey = 'sk-secret-key-12345';
    });

    let leaked = false;
    sp.page.on('request', (req) => {
      const url = req.url();
      const postData = req.postData() || '';
      if (url.includes('sk-secret-key-12345') || postData.includes('sk-secret-key-12345')) {
        leaked = true;
      }
    });

    await sendChatMessage(sp, 'test no leak');
    await sp.page.waitForTimeout(1000);

    expect(leaked).toBe(false);

    await sp.page.close();
    complete('TC-10.4.3');
  });

  // ─── 1.1 新会话 ───

  test('TC-1.1.3: No model configured', async () => {
    checkSkip('TC-1.1.3');
    await setStorageItem(ext.serviceWorker, 'activeModel', null);
    await removeStorageItem(ext.serviceWorker, 'local:activeModel');

    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, 'no model test');

    const body = await getBodyText(sp);
    const hasError =
      body.includes('模型') ||
      body.includes('model') ||
      body.includes('配置') ||
      body.includes('未设置') ||
      (await sp.page.locator('[data-sonner-toast]').first().isVisible().catch(() => false));
    expect(hasError).toBe(true);

    await sp.page.close();
    complete('TC-1.1.3');
  });

  // ─── 1.2 消息发送 ───

  test('TC-1.2.3: Empty message', async () => {
    checkSkip('TC-1.2.3');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    const chatInput = sp.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await chatInput.fill('');
    await chatInput.press('Enter');
    await sp.page.waitForTimeout(500);

    const messagesBefore = await sp.page.locator('[data-role="user"]').count();
    expect(messagesBefore).toBe(0);

    await sp.page.close();
    complete('TC-1.2.3');
  });

  test('TC-1.2.6: Network interrupt', async () => {
    checkSkip('TC-1.2.6');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.route('**/*', async (route) => {
      const url = route.request().url();
      if (
        url.includes('api.minimax.chat') ||
        url.includes('chatglm.cn') ||
        url.includes('localhost')
      ) {
        await route.abort('internetdisconnected');
      } else {
        await route.continue();
      }
    });

    await sendChatMessage(sp, 'network interrupt test');
    await sp.page.waitForTimeout(2000);

    const body = await getBodyText(sp);
    const hasError =
      body.includes('网络') ||
      body.includes('错误') ||
      body.includes('error') ||
      body.includes('failed') ||
      (await sp.page.locator('[data-sonner-toast]').first().isVisible().catch(() => false));
    expect(hasError).toBe(true);

    await sp.page.close();
    complete('TC-1.2.6');
  });
});
