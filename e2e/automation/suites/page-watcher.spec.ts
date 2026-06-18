import { expect } from '@playwright/test';
import type { TestCaseFn } from '../config.js';

export const tests: Record<string, TestCaseFn> = {
  'TC-3.1.1': async (ctx) => {
    ctx.log('检测新增元素，插入 15 个 div 触发通知');
    const page = await ctx.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    // 开启监控
    await page.evaluate(() => {
      (window as any).startPageWatcher?.();
    });

    await page.evaluate(() => {
      const app = document.getElementById('app')!;
      for (let i = 0; i < 15; i++) {
        const div = document.createElement('div');
        div.textContent = 'item ' + i;
        app.appendChild(div);
      }
    });

    await ctx.page.waitForTimeout(9000); // 等待防抖 8000ms

    const bodyText = await ctx.page.locator('body').innerText();
    const detected = bodyText.includes('变化') || bodyText.includes('change') || bodyText.includes('page_change');
    expect(detected).toBe(true);
    await page.close();
  },

  'TC-3.1.2': async (ctx) => {
    ctx.log('忽略 script/style 标签');
    const page = await ctx.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    await page.evaluate(() => {
      (window as any).startPageWatcher?.();
    });

    await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'console.log(1)';
      document.body.appendChild(s);
    });

    await ctx.page.waitForTimeout(9000);
    const bodyText = await ctx.page.locator('body').innerText();
    const hasChange = bodyText.includes('page_change') || bodyText.includes('检测到');
    // 不应该触发，因为 script 在 IGNORED_TAGS 中
    expect(hasChange).toBe(false);
    await page.close();
  },

  'TC-3.1.3': async (ctx) => {
    ctx.log('忽略广告类元素');
    const page = await ctx.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    await page.evaluate(() => {
      (window as any).startPageWatcher?.();
    });

    await page.evaluate(() => {
      const ad = document.createElement('div');
      ad.className = 'ad-banner';
      ad.textContent = '广告';
      document.body.appendChild(ad);
    });

    await ctx.page.waitForTimeout(9000);
    const bodyText = await ctx.page.locator('body').innerText();
    const hasChange = bodyText.includes('page_change') || bodyText.includes('检测到');
    expect(hasChange).toBe(false);
    await page.close();
  },

  'TC-3.1.4': async (ctx) => {
    ctx.log('文本内容变化触发通知');
    const page = await ctx.context.newPage();
    await page.setContent('<div id="text">原始文本</div>', { waitUntil: 'domcontentloaded' });
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    await page.evaluate(() => {
      (window as any).startPageWatcher?.();
    });

    await page.evaluate(() => {
      document.getElementById('text')!.textContent = '修改后的文本'.repeat(20);
    });

    await ctx.page.waitForTimeout(9000);
    const bodyText = await ctx.page.locator('body').innerText();
    const hasChange = bodyText.includes('变化') || bodyText.includes('change') || bodyText.includes('检测到');
    expect(hasChange).toBe(true);
    await page.close();
  },

  'TC-3.1.5': async (ctx) => {
    ctx.log('低于阈值不触发通知');
    const page = await ctx.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });
    await ctx.page.goto(ctx.sidepanelUrl, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(1000);

    await page.evaluate(() => {
      (window as any).startPageWatcher?.();
    });

    await page.evaluate(() => {
      const app = document.getElementById('app')!;
      for (let i = 0; i < 5; i++) {
        const div = document.createElement('div');
        div.textContent = 'item ' + i;
        app.appendChild(div);
      }
    });

    await ctx.page.waitForTimeout(9000);
    const bodyText = await ctx.page.locator('body').innerText();
    const hasChange = bodyText.includes('page_change') || bodyText.includes('检测到');
    expect(hasChange).toBe(false);
    await page.close();
  },

  'TC-3.1.6': async (ctx) => {
    ctx.log('多实例保护，第二次返回 already_watching');
    const page = await ctx.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });

    const first = await page.evaluate(() => {
      return (window as any).startPageWatcher?.();
    });
    const second = await page.evaluate(() => {
      return (window as any).startPageWatcher?.();
    });

    expect(second).toContain('already_watching');
    await page.close();
  },

  'TC-3.1.7': async (ctx) => {
    ctx.log('停止监控，observer disconnect');
    const page = await ctx.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      (window as any).startPageWatcher?.();
    });
    const stopped = await page.evaluate(() => {
      return (window as any).stopPageWatcher?.();
    });

    expect(stopped).toBe(true);
    await page.close();
  },
};
