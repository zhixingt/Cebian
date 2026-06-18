import type { Page, BrowserContext } from '@playwright/test';

export interface SidepanelPage {
  page: Page;
  extensionId: string;
}

/**
 * 打开 sidepanel 页面并返回操作封装
 */
export async function openSidepanel(context: BrowserContext, extensionId: string): Promise<SidepanelPage> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html#/chat/new`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
  return { page, extensionId };
}

/**
 * 等待 sidepanel 完全加载（QuickActionsBar 可见）
 */
export async function waitForSidepanelReady(sp: SidepanelPage): Promise<void> {
  const bar = sp.page.locator('[data-testid="quick-actions-bar"]');
  await bar.waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * 在聊天输入框中发送消息
 */
export async function sendChatMessage(sp: SidepanelPage, text: string): Promise<void> {
  const chatInput = sp.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
  await chatInput.waitFor({ state: 'visible', timeout: 10_000 });
  await chatInput.fill(text);
  await chatInput.press('Enter');
  // Wait for optimistic message to appear
  await sp.page.waitForTimeout(500);
}

/**
 * 等待 AI 响应完成（通过检测流式输出停止）
 */
export async function waitForAssistantResponse(sp: SidepanelPage, timeout = 60_000): Promise<string> {
  const start = Date.now();
  let lastText = '';
  while (Date.now() - start < timeout) {
    const assistant = sp.page.locator('[data-role="assistant"]').last();
    if (await assistant.isVisible().catch(() => false)) {
      const text = await assistant.innerText();
      if (text && text !== lastText) {
        lastText = text;
        // Wait a bit more to see if streaming continues
        await sp.page.waitForTimeout(2000);
        const newText = await assistant.innerText();
        if (newText === lastText) {
          return newText; // Streaming stopped
        }
      }
    }
    await sp.page.waitForTimeout(500);
  }
  return lastText || '';
}

/**
 * 点击 QuickActionsBar 上的工具按钮
 */
export async function clickQuickTool(sp: SidepanelPage, toolId: string): Promise<void> {
  const btn = sp.page.locator(`[data-quick-tool="${toolId}"]`);
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
}

/**
 * 检查是否有用户消息出现在聊天记录中
 */
export async function hasUserMessage(sp: SidepanelPage, expectedText?: string): Promise<boolean> {
  const userMessages = sp.page.locator('[data-role="user"]');
  const count = await userMessages.count();
  if (count === 0) return false;
  if (expectedText) {
    for (let i = 0; i < count; i++) {
      const text = await userMessages.nth(i).innerText();
      if (text.includes(expectedText)) return true;
    }
    return false;
  }
  return true;
}

/**
 * 获取所有用户消息文本
 */
export async function getUserMessages(sp: SidepanelPage): Promise<string[]> {
  const messages = sp.page.locator('[data-role="user"]');
  const count = await messages.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    texts.push(await messages.nth(i).innerText());
  }
  return texts;
}

/**
 * 获取页面 body 文本（用于检查 prompt 是否被发送）
 */
export async function getBodyText(sp: SidepanelPage): Promise<string> {
  return sp.page.locator('body').innerText();
}

/**
 * 打开设置页面
 */
export async function openSettings(sp: SidepanelPage): Promise<void> {
  await sp.page.goto(`chrome-extension://${sp.extensionId}/settings.html`, {
    waitUntil: 'domcontentloaded',
  });
  await sp.page.waitForLoadState('networkidle', { timeout: 15_000 });
}

/**
 * 通过 Chrome DevTools Protocol 执行右键菜单点击（绕过原生菜单限制）
 * 注意：ContextMenus 是浏览器原生菜单，Playwright 无法直接操作。
 * 我们通过 background script 的 chrome.contextMenus.onClicked 事件直接触发。
 */
export async function triggerContextMenu(
  sp: SidepanelPage,
  menuItemId: string,
  tabUrl: string,
): Promise<void> {
  // 使用 evaluate 在 background page 中直接触发 context menu 事件
  await sp.page.evaluate(
    ({ menuItemId, tabUrl }) => {
      // 构造 fake OnClickData 和 Tab
      const info = {
        menuItemId,
        selectionText: '',
        linkUrl: undefined,
      } as chrome.contextMenus.OnClickData;
      const tab = { id: 1, url: tabUrl } as chrome.tabs.Tab;
      // 触发 listener
      chrome.contextMenus.onClicked.dispatch(info, tab);
    },
    { menuItemId, tabUrl },
  );
  await sp.page.waitForTimeout(1000);
}

/**
 * 检查 toast 通知是否出现
 */
export async function hasToast(sp: SidepanelPage, expectedText: string): Promise<boolean> {
  const toasts = sp.page.locator('[data-sonner-toast]');
  const count = await toasts.count();
  for (let i = 0; i < count; i++) {
    const text = await toasts.nth(i).innerText();
    if (text.includes(expectedText)) return true;
  }
  return false;
}

/**
 * 等待 toast 出现
 */
export async function waitForToast(sp: SidepanelPage, expectedText: string, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await hasToast(sp, expectedText)) return;
    await sp.page.waitForTimeout(300);
  }
  throw new Error(`Toast "${expectedText}" did not appear within ${timeout}ms`);
}

/**
 * 截图并保存到 report 目录
 */
export async function takeScreenshot(sp: SidepanelPage, name: string): Promise<string> {
  const path = `e2e/report/screenshots/${name}.png`;
  await sp.page.screenshot({ path, fullPage: false });
  return path;
}
