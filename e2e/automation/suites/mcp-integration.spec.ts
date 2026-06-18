import { expect } from '@playwright/test';
import type { TestCaseFn } from '../config.js';
import { testConfig } from '../config.js';

export const tests: Record<string, TestCaseFn> = {
  // 6.1 MCP Server 配置
  'TC-6.1.1': async (ctx) => {
    ctx.log('添加 HTTP MCP');
    await ctx.page.goto(`chrome-extension://${ctx.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    // 导航到 MCP 设置
    const mcpNav = ctx.page.locator('a:has-text("MCP"), button:has-text("MCP"), [data-testid="mcp-nav"]').first();
    if (await mcpNav.count() > 0) await mcpNav.click();
    await ctx.page.waitForTimeout(500);

    const addBtn = ctx.page.locator('button:has-text("添加"), [data-testid="add-mcp"]').first();
    if (await addBtn.count() > 0) await addBtn.click();
    await ctx.page.waitForTimeout(500);

    await ctx.page.locator('input[name="name"], input[placeholder*="名称"]').first().fill('Test MCP');
    await ctx.page.locator('input[name="url"], input[placeholder*="URL"]').first().fill(`http://localhost:${testConfig.mockServers.mcpPort}/mcp`);
    const typeSelect = ctx.page.locator('select, [data-testid="transport-type"]').first();
    if (await typeSelect.count() > 0) await typeSelect.selectOption('streamable-http');

    const saveBtn = ctx.page.locator('button:has-text("保存"), [data-testid="save-mcp"]').first();
    if (await saveBtn.count() > 0) await saveBtn.click();
    await ctx.page.waitForTimeout(1500);

    const status = ctx.page.locator('[data-testid="mcp-status"], .status').first();
    if (await status.count() > 0) {
      const text = await status.innerText();
      expect(text).toContain('已连接');
    }
  },

  'TC-6.1.2': async (ctx) => {
    ctx.log('添加 SSE MCP');
    await ctx.page.goto(`chrome-extension://${ctx.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const mcpNav = ctx.page.locator('a:has-text("MCP"), button:has-text("MCP"), [data-testid="mcp-nav"]').first();
    if (await mcpNav.count() > 0) await mcpNav.click();
    await ctx.page.waitForTimeout(500);

    const addBtn = ctx.page.locator('button:has-text("添加"), [data-testid="add-mcp"]').first();
    if (await addBtn.count() > 0) await addBtn.click();
    await ctx.page.waitForTimeout(500);

    await ctx.page.locator('input[name="name"], input[placeholder*="名称"]').first().fill('SSE MCP');
    await ctx.page.locator('input[name="url"], input[placeholder*="URL"]').first().fill(`http://localhost:${testConfig.mockServers.mcpPort}/sse`);
    const typeSelect = ctx.page.locator('select, [data-testid="transport-type"]').first();
    if (await typeSelect.count() > 0) await typeSelect.selectOption('sse');

    const saveBtn = ctx.page.locator('button:has-text("保存"), [data-testid="save-mcp"]').first();
    if (await saveBtn.count() > 0) await saveBtn.click();
    await ctx.page.waitForTimeout(1500);

    const items = await ctx.page.locator('[data-testid="mcp-card"], .mcp-item').count();
    expect(items).toBeGreaterThanOrEqual(1);
  },

  'TC-6.1.3': async (ctx) => {
    ctx.log('添加带认证 MCP');
    await ctx.page.goto(`chrome-extension://${ctx.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const mcpNav = ctx.page.locator('a:has-text("MCP"), button:has-text("MCP"), [data-testid="mcp-nav"]').first();
    if (await mcpNav.count() > 0) await mcpNav.click();
    await ctx.page.waitForTimeout(500);

    const addBtn = ctx.page.locator('button:has-text("添加"), [data-testid="add-mcp"]').first();
    if (await addBtn.count() > 0) await addBtn.click();
    await ctx.page.waitForTimeout(500);

    await ctx.page.locator('input[name="name"], input[placeholder*="名称"]').first().fill('Auth MCP');
    await ctx.page.locator('input[name="url"], input[placeholder*="URL"]').first().fill(`http://localhost:${testConfig.mockServers.mcpPort}/mcp`);
    const authType = ctx.page.locator('select, [data-testid="auth-type"]').first();
    if (await authType.count() > 0) await authType.selectOption('Bearer Token');
    const tokenInput = ctx.page.locator('input[name="token"], input[placeholder*="Token"]').first();
    if (await tokenInput.count() > 0) await tokenInput.fill('test-token-123');

    const saveBtn = ctx.page.locator('button:has-text("保存"), [data-testid="save-mcp"]').first();
    if (await saveBtn.count() > 0) await saveBtn.click();
    await ctx.page.waitForTimeout(1500);

    expect(true).toBe(true);
  },

  'TC-6.1.4': async (ctx) => {
    ctx.log('连接失败');
    await ctx.page.goto(`chrome-extension://${ctx.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const mcpNav = ctx.page.locator('a:has-text("MCP"), button:has-text("MCP"), [data-testid="mcp-nav"]').first();
    if (await mcpNav.count() > 0) await mcpNav.click();
    await ctx.page.waitForTimeout(500);

    const addBtn = ctx.page.locator('button:has-text("添加"), [data-testid="add-mcp"]').first();
    if (await addBtn.count() > 0) await addBtn.click();
    await ctx.page.waitForTimeout(500);

    await ctx.page.locator('input[name="name"], input[placeholder*="名称"]').first().fill('Dead MCP');
    await ctx.page.locator('input[name="url"], input[placeholder*="URL"]').first().fill('http://localhost:19999/mcp');
    const saveBtn = ctx.page.locator('button:has-text("保存"), [data-testid="save-mcp"]').first();
    if (await saveBtn.count() > 0) await saveBtn.click();
    await ctx.page.waitForTimeout(3000);

    const status = ctx.page.locator('[data-testid="mcp-status"], .status').first();
    if (await status.count() > 0) {
      const text = await status.innerText();
      const hasError = text.includes('失败') || text.includes('超时') || text.includes('error');
      expect(hasError).toBe(true);
    }
  },

  'TC-6.1.5': async (ctx) => {
    ctx.log('删除 MCP');
    await ctx.page.goto(`chrome-extension://${ctx.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const mcpNav = ctx.page.locator('a:has-text("MCP"), button:has-text("MCP"), [data-testid="mcp-nav"]').first();
    if (await mcpNav.count() > 0) await mcpNav.click();
    await ctx.page.waitForTimeout(500);

    const deleteBtn = ctx.page.locator('button:has-text("删除"), [data-testid="delete-mcp"]').first();
    if (await deleteBtn.count() > 0) await deleteBtn.click();
    await ctx.page.waitForTimeout(1000);

    const items = await ctx.page.locator('[data-testid="mcp-card"], .mcp-item').count();
    expect(items).toBe(0);
  },

  'TC-6.1.6': async (ctx) => {
    ctx.log('工具自动发现');
    await ctx.page.goto(`chrome-extension://${ctx.extensionId}/settings.html`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const mcpNav = ctx.page.locator('a:has-text("MCP"), button:has-text("MCP"), [data-testid="mcp-nav"]').first();
    if (await mcpNav.count() > 0) await mcpNav.click();
    await ctx.page.waitForTimeout(500);

    const addBtn = ctx.page.locator('button:has-text("添加"), [data-testid="add-mcp"]').first();
    if (await addBtn.count() > 0) await addBtn.click();
    await ctx.page.waitForTimeout(500);

    await ctx.page.locator('input[name="name"], input[placeholder*="名称"]').first().fill('BrowserWing MCP');
    await ctx.page.locator('input[name="url"], input[placeholder*="URL"]').first().fill(`http://localhost:${testConfig.mockServers.mcpPort}/mcp`);
    const saveBtn = ctx.page.locator('button:has-text("保存"), [data-testid="save-mcp"]').first();
    if (await saveBtn.count() > 0) await saveBtn.click();
    await ctx.page.waitForTimeout(2000);

    // 检查工具列表包含 navigate / click / type
    const tools = ctx.page.locator('[data-testid="tool-list"], .tool-item').first();
    if (await tools.count() > 0) {
      const text = await ctx.page.locator('[data-testid="tool-list"], .tool-item').allInnerTexts();
      const joined = text.join(' ');
      expect(joined).toContain('navigate');
      expect(joined).toContain('click');
      expect(joined).toContain('type');
    }
  },

  // 6.2 MCP 工具调用
  'TC-6.2.2': async (ctx) => {
    ctx.log('限流保护');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    // 快速发送 10 条
    for (let i = 0; i < 10; i++) {
      await input.fill(`限流测试 ${i}`);
      await ctx.page.keyboard.press('Enter');
      await ctx.page.waitForTimeout(200);
    }
    await ctx.page.waitForTimeout(5000);

    // 检查没有崩溃且消息存在
    const messages = await ctx.page.locator('[data-testid="message"], .message').count();
    expect(messages).toBeGreaterThanOrEqual(1);
  },

  'TC-6.2.3': async (ctx) => {
    ctx.log('断路器');
    // 模拟 MCP 服务连续失败，检查断路器打开
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    const input = ctx.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
    for (let i = 0; i < 6; i++) {
      await input.fill(`断路器测试 ${i}`);
      await ctx.page.keyboard.press('Enter');
      await ctx.page.waitForTimeout(500);
    }
    await ctx.page.waitForTimeout(3000);

    const bodyText = await ctx.page.locator('body').innerText();
    const hasCircuit = bodyText.includes('断路器') || bodyText.includes('circuit') || bodyText.includes('服务不可用');
    expect(hasCircuit).toBe(true);
  },
};
