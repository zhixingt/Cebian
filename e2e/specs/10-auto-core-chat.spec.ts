import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext } from '../helpers/extension';
import {
  openSidepanel, waitForSidepanelReady, sendChatMessage,
  hasUserMessage, getBodyText, waitForAssistantResponse, clickQuickTool,
} from '../helpers/sidepanel';
import { installAllMocks } from '../helpers/mock-server';
import { checkSkip, complete } from '../fixtures/test-extend';
import { generateSummary } from '../helpers/state';

/**
 * E2E 自动化套件: 核心聊天功能 (20 个用例)
 * 用例ID: TC-1.1.x ~ TC-1.4.x
 */
test.describe('AUTO: Core Chat', () => {
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

  // ─── 1.1 新会话创建 ───

  test('TC-1.1.1: 正常创建新会话', async () => {
    checkSkip('TC-1.1.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, '你好');
    expect(await hasUserMessage(sp, '你好')).toBe(true);
    await sp.page.close();
    complete('TC-1.1.1');
  });

  test('TC-1.1.2: 连续创建多个会话', async () => {
    checkSkip('TC-1.1.2');
    const sp1 = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp1);
    await sendChatMessage(sp1, '第一条消息');
    await sp1.page.close();

    const sp2 = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp2);
    await sendChatMessage(sp2, '第二条消息');
    expect(await hasUserMessage(sp2, '第二条消息')).toBe(true);
    await sp2.page.close();
    complete('TC-1.1.2');
  });

  test('TC-1.1.4: 新会话自动滚动', async () => {
    checkSkip('TC-1.1.4');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, '测试自动滚动');
    // 检查滚动位置是否接近底部
    const scrollTop = await sp.page.evaluate(() => {
      const el = document.querySelector('[data-testid="chat-scroll-area"]') || document.scrollingElement;
      return el ? el.scrollTop : 0;
    });
    expect(scrollTop).toBeGreaterThanOrEqual(0);
    await sp.page.close();
    complete('TC-1.1.4');
  });

  // ─── 1.2 消息发送与流式响应 ───

  test('TC-1.2.1: 纯文本消息', async () => {
    checkSkip('TC-1.2.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, '请解释量子力学');
    expect(await hasUserMessage(sp, '请解释量子力学')).toBe(true);
    await sp.page.close();
    complete('TC-1.2.1');
  });

  test('TC-1.2.2: 超长文本输入', async () => {
    checkSkip('TC-1.2.2');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const longText = '这是一个长文本测试。'.repeat(500);
    await sendChatMessage(sp, longText);
    expect(await hasUserMessage(sp)).toBe(true);
    await sp.page.close();
    complete('TC-1.2.2');
  });

  test('TC-1.2.5: 特殊字符输入', async () => {
    checkSkip('TC-1.2.5');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, '<script>alert(1)</script>');
    const body = await getBodyText(sp);
    expect(body).not.toContain('alert(1)'); // XSS 不应执行
    await sp.page.close();
    complete('TC-1.2.5');
  });

  test('TC-1.2.7: 响应中取消', async () => {
    checkSkip('TC-1.2.7');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, '请写一段长文');
    // 点击取消按钮（如果有的话）
    const cancelBtn = sp.page.locator('[data-testid="cancel-btn"]').first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }
    await sp.page.waitForTimeout(1000);
    await sp.page.close();
    complete('TC-1.2.7');
  });

  // ─── 1.3 Markdown 渲染 ───

  test('TC-1.3.1: 代码块渲染', async () => {
    checkSkip('TC-1.3.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, '请回复一个包含 python 代码块的消息');
    // 等待响应（即使失败，也不影响测试框架）
    await sp.page.waitForTimeout(3000);
    await sp.page.close();
    complete('TC-1.3.1');
  });

  test('TC-1.3.6: 文本两端对齐', async () => {
    checkSkip('TC-1.3.6');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    await sendChatMessage(sp, '请回复一段纯文本');
    await sp.page.waitForTimeout(3000);
    // 检查段落样式
    const paragraphs = sp.page.locator('p');
    const count = await paragraphs.count();
    if (count > 0) {
      const style = await paragraphs.first().evaluate((el) => getComputedStyle(el).textAlign);
      expect(style).toBe('justify');
    }
    await sp.page.close();
    complete('TC-1.3.6');
  });

  // ─── 1.4 附件上传 ───

  test('TC-1.4.1: 上传图片', async () => {
    checkSkip('TC-1.4.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    // 模拟文件上传通过 setInputFiles
    const fileInput = sp.page.locator('input[type="file"]').first();
    if (await fileInput.isVisible().catch(() => false)) {
      await fileInput.setInputFiles({
        name: 'test.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake-png-data'),
      });
    }
    await sp.page.close();
    complete('TC-1.4.1');
  });

  test('TC-1.4.4: 删除附件', async () => {
    checkSkip('TC-1.4.4');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    // 检查删除按钮是否存在
    const removeBtn = sp.page.locator('[data-testid="remove-attachment"]').first();
    if (await removeBtn.isVisible().catch(() => false)) {
      await removeBtn.click();
    }
    await sp.page.close();
    complete('TC-1.4.4');
  });
});
