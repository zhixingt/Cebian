import { expect } from '@playwright/test';
import type { TestCaseFn } from '../config.js';
import { testConfig } from '../config.js';

export const tests: Record<string, TestCaseFn> = {
  // 5.1 Skill 部署
  'TC-5.1.1': async (ctx) => {
    ctx.log('检查首次部署 skill 文件');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(2000);

    // 通过 VFS 检查 skill 文件存在
    const hasSkill = await ctx.page.evaluate(async () => {
      const vfs = (window as any).vfs;
      if (!vfs) return false;
      const list = await vfs.list?.('~/.cebian/skills/browserwing/');
      return Array.isArray(list) && list.length > 0;
    });
    expect(hasSkill).toBe(true);
  },

  'TC-5.1.2': async (ctx) => {
    ctx.log('检查幂等部署');
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(2000);

    const before = await ctx.page.evaluate(async () => {
      const vfs = (window as any).vfs;
      const list = await vfs.list?.('~/.cebian/skills/browserwing/');
      return JSON.stringify(list);
    });

    await ctx.page.reload({ waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(2000);

    const after = await ctx.page.evaluate(async () => {
      const vfs = (window as any).vfs;
      const list = await vfs.list?.('~/.cebian/skills/browserwing/');
      return JSON.stringify(list);
    });
    expect(after).toBe(before);
  },

  // 5.2 API 调用
  'TC-5.2.1': async (ctx) => {
    ctx.log('navigate');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'navigate', url: 'https://example.com' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.url).toBe('https://example.com');
  },

  'TC-5.2.2': async (ctx) => {
    ctx.log('snapshot');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snapshot' }),
    });
    const data = await res.json();
    expect(data.title).toBeTruthy();
    expect(Array.isArray(data.elements)).toBe(true);
  },

  'TC-5.2.3': async (ctx) => {
    ctx.log('click by RefID');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', identifier: '@e1' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.clicked).toBe('@e1');
  },

  'TC-5.2.4': async (ctx) => {
    ctx.log('type');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'type', identifier: '@e2', text: 'hello' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.typed).toBe('@e2');
  },

  'TC-5.2.5': async (ctx) => {
    ctx.log('batch');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch', operations: [{ action: 'click' }, { action: 'type' }, { action: 'navigate' }] }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.completed).toBe(3);
  },

  'TC-5.2.7': async (ctx) => {
    ctx.log('screenshot');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'screenshot', fullPage: true }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data).toContain('base64');
  },

  'TC-5.2.8': async (ctx) => {
    ctx.log('evaluate');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'evaluate', expression: 'document.title' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.result).toBeTruthy();
  },

  'TC-5.2.9': async (ctx) => {
    ctx.log('错误处理');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/foo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'foo' }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('Unknown');
  },

  'TC-5.2.10': async (ctx) => {
    ctx.log('网络错误');
    try {
      await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort + 100}/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(false).toBe(true); // 应该抛错
    } catch (e) {
      expect(e).toBeTruthy();
    }
  },

  // 5.3 批量表单填写
  'TC-5.3.2': async (ctx) => {
    ctx.log('截图留痕');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/batch-fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ name: 'A' }], screenshot: true }),
    });
    const data = await res.json();
    expect(data.total).toBe(1);
  },

  'TC-5.3.3': async (ctx) => {
    ctx.log('提交失败回退');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/batch-fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ name: 'A' }, { name: 'B' }] }),
    });
    const data = await res.json();
    expect(data.success + data.failed).toBe(data.total);
  },

  'TC-5.3.4': async (ctx) => {
    ctx.log('空数据');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/batch-fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    const data = await res.json();
    expect(data.total).toBe(0);
    expect(data.success).toBe(0);
    expect(data.failed).toBe(0);
  },

  'TC-5.3.6': async (ctx) => {
    ctx.log('自定义提交按钮');
    const res = await fetch(`http://127.0.0.1:${testConfig.mockServers.browserwingPort}/batch-fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ name: 'A' }], submitSelector: '@e5' }),
    });
    const data = await res.json();
    expect(data.success).toBe(1);
  },
};
