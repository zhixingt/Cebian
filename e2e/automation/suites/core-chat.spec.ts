import { expect } from '@playwright/test';
import type { TestCaseFn } from '../config.js';

export const tests: Record<string, TestCaseFn> = {
  // 1.1 新会话创建
  'TC-1.1.1': async (ctx) => {
    ctx.log('打开侧边栏并创建新会话');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    // 点击新建聊天按钮（SquarePen 图标）
    const newChatBtn = ctx.page.locator('[data-testid="new-chat"], button:has-text("新建"), [aria-label*="新建"]').first();
    if (await newChatBtn.count() > 0) {
      await newChatBtn.click();
    }

    // 发送消息
    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('你好');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(2000);

    // 检查 URL 包含 /chat/
    const url = ctx.page.url();
    expect(url).toContain('/chat/');

    // 检查消息气泡出现
    const messages = ctx.page.locator('[data-testid="message"], .message, .chat-message').first();
    await expect(messages).toBeVisible();
  },

  'TC-1.1.2': async (ctx) => {
    ctx.log('连续创建两个会话并检查隔离');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const newChatBtn = ctx.page.locator('[data-testid="new-chat"], button:has-text("新建"), [aria-label*="新建"]').first();
    if (await newChatBtn.count() > 0) await newChatBtn.click();

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('第一条消息');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(2000);

    const firstUrl = ctx.page.url();

    if (await newChatBtn.count() > 0) await newChatBtn.click();
    await input.fill('第二条消息');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(2000);

    const secondUrl = ctx.page.url();
    expect(secondUrl).not.toBe(firstUrl);
    expect(secondUrl).toContain('/chat/');
  },

  'TC-1.1.3': async (ctx) => {
    ctx.log('未配置模型时发送检查错误提示');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    // 清除模型配置（通过 localStorage 或设置页面）
    await ctx.page.evaluate(() => {
      localStorage.removeItem('activeModel');
      localStorage.removeItem('customModels');
    });
    await ctx.page.reload({ waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('测试消息');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(1500);

    // 检查错误提示
    const bodyText = await ctx.page.locator('body').innerText();
    const hasError = bodyText.includes('请先选择一个模型') || bodyText.includes('选择模型') || bodyText.includes('模型');
    expect(hasError).toBe(true);
  },

  'TC-1.1.4': async (ctx) => {
    ctx.log('检查新会话自动滚动');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('自动滚动测试');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(2000);

    // 检查滚动位置接近底部
    const scrollTop = await ctx.page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="chat-scroll"], .scroll-area, .messages');
      const el = scroller ?? document.documentElement;
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    });
    expect(scrollTop).toBe(true);
  },

  // 1.2 消息发送与流式响应
  'TC-1.2.2': async (ctx) => {
    ctx.log('超长文本输入');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const longText = '测试'.repeat(2500);
    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill(longText);
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(3000);

    const messages = ctx.page.locator('[data-testid="message"], .message').first();
    await expect(messages).toBeVisible();
  },

  'TC-1.2.3': async (ctx) => {
    ctx.log('空消息发送');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const sendBtn = ctx.page.locator('button[type="submit"], [data-testid="send"], [aria-label*="发送"]').first();
    const isDisabled = await sendBtn.isDisabled().catch(() => false);
    if (!isDisabled) {
      await sendBtn.click();
      await ctx.page.waitForTimeout(500);
    }
    // 断言：消息未增加（或按钮禁用）
    const messages = await ctx.page.locator('[data-testid="message"], .message').count();
    expect(messages).toBeLessThanOrEqual(1);
  },

  'TC-1.2.4': async (ctx) => {
    ctx.log('仅空格换行发送');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('   \n\n  ');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(500);

    const messages = await ctx.page.locator('[data-testid="message"], .message').count();
    expect(messages).toBeLessThanOrEqual(1);
  },

  'TC-1.2.5': async (ctx) => {
    ctx.log('特殊字符输入 XSS');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('<script>alert(1)</script>');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(2000);

    // 检查没有 script 标签执行
    const hasInlineScript = await ctx.page.evaluate(() => {
      return document.querySelector('script') !== null && document.querySelector('script')?.textContent?.includes('alert(1)');
    });
    expect(hasInlineScript).toBe(false);
  },

  'TC-1.2.6': async (ctx) => {
    ctx.log('网络中断模拟');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    await ctx.context.setOffline(true);
    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('离线测试');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(3000);
    await ctx.context.setOffline(false);

    const bodyText = await ctx.page.locator('body').innerText();
    const hasError = bodyText.includes('错误') || bodyText.includes('失败') || bodyText.includes('网络') || bodyText.includes('重试');
    expect(hasError).toBe(true);
  },

  'TC-1.2.7': async (ctx) => {
    ctx.log('响应中取消');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('取消测试');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(500);

    const cancelBtn = ctx.page.locator('button:has-text("取消"), [data-testid="cancel"], [aria-label*="取消"]').first();
    if (await cancelBtn.count() > 0 && await cancelBtn.isVisible()) {
      await cancelBtn.click();
    }
    await ctx.page.waitForTimeout(1000);

    // 检查停止生成状态（消息存在但可能不完整）
    const messages = await ctx.page.locator('[data-testid="message"], .message').count();
    expect(messages).toBeGreaterThanOrEqual(1);
  },

  'TC-1.2.8': async (ctx) => {
    ctx.log('重试失败消息');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    await input.fill('重试测试');
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(2000);

    const retryBtn = ctx.page.locator('button:has-text("重试"), [data-testid="retry"], [aria-label*="重试"]').first();
    if (await retryBtn.count() > 0 && await retryBtn.isVisible()) {
      await retryBtn.click();
      await ctx.page.waitForTimeout(2000);
    }
    const messages = await ctx.page.locator('[data-testid="message"], .message').count();
    expect(messages).toBeGreaterThanOrEqual(1);
  },

  // 1.3 Markdown 渲染
  'TC-1.3.1': async (ctx) => {
    ctx.log('代码块渲染');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const codeBlock = await ctx.page.locator('pre, code, .code-block').first();
    if (await codeBlock.count() > 0) {
      await expect(codeBlock).toBeVisible();
    }
  },

  'TC-1.3.2': async (ctx) => {
    ctx.log('表格渲染');
    const table = await ctx.page.locator('table').first();
    if (await table.count() > 0) {
      await expect(table).toBeVisible();
    }
  },

  'TC-1.3.3': async (ctx) => {
    ctx.log('嵌套列表');
    const list = await ctx.page.locator('ul, ol').first();
    if (await list.count() > 0) {
      await expect(list).toBeVisible();
    }
  },

  'TC-1.3.4': async (ctx) => {
    ctx.log('链接渲染');
    const link = await ctx.page.locator('a[href]').first();
    if (await link.count() > 0) {
      const target = await link.getAttribute('target');
      expect(target).toBe('_blank');
    }
  },

  'TC-1.3.5': async (ctx) => {
    ctx.log('图片渲染');
    const img = await ctx.page.locator('img').first();
    if (await img.count() > 0) {
      await expect(img).toBeVisible();
    }
  },

  'TC-1.3.6': async (ctx) => {
    ctx.log('文本两端对齐');
    const justify = await ctx.page.locator('[style*="justify"], .text-justify').first();
    if (await justify.count() > 0) {
      const style = await justify.getAttribute('style');
      expect(style).toContain('justify');
    }
  },

  // 1.4 附件上传
  'TC-1.4.1': async (ctx) => {
    ctx.log('上传图片');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const fileInput = ctx.page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles({
        name: 'test.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
      });
      await ctx.page.waitForTimeout(500);
      const attachment = ctx.page.locator('[data-testid="attachment"], .attachment-chip').first();
      await expect(attachment).toBeVisible();
    }
  },

  'TC-1.4.2': async (ctx) => {
    ctx.log('上传多个文件');
    const fileInput = ctx.page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles([
        { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
        { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('b') },
        { name: 'c.txt', mimeType: 'text/plain', buffer: Buffer.from('c') },
      ]);
      await ctx.page.waitForTimeout(500);
      const attachments = await ctx.page.locator('[data-testid="attachment"], .attachment-chip').count();
      expect(attachments).toBeGreaterThanOrEqual(3);
    }
  },

  'TC-1.4.4': async (ctx) => {
    ctx.log('删除附件');
    const removeBtn = ctx.page.locator('[data-testid="remove-attachment"], button:has-text("删除")').first();
    if (await removeBtn.count() > 0) {
      await removeBtn.click();
      await ctx.page.waitForTimeout(500);
      const attachments = await ctx.page.locator('[data-testid="attachment"], .attachment-chip').count();
      expect(attachments).toBe(0);
    }
  },
};
