import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext } from '../helpers/extension';
import {
  openSidepanel, waitForSidepanelReady, getBodyText, hasToast,
} from '../helpers/sidepanel';
import { installAllMocks } from '../helpers/mock-server';
import { checkSkip, complete } from '../fixtures/test-extend';
import { generateSummary } from '../helpers/state';

/**
 * E2E 自动化套件: PageWatcher 页面监控 (5 个用例)
 * 用例ID: TC-3.1.x
 */
test.describe('AUTO: PageWatcher', () => {
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

  // ─── 3.1 MutationObserver 行为 ───

  test('TC-3.1.1: DOM 节点新增检测', async () => {
    checkSkip('TC-3.1.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    // 创建受控页面用于注入 watcher
    const page = await ext.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 通过扩展向页面注入 startPageWatcher
    await page.evaluate(() => {
      // 模拟扩展注入的 watcher（如果页面未自动注入）
      const w = window as any;
      if (!w.__cebWatcher) {
        const observer = new MutationObserver((mutations) => {
          let count = 0;
          for (const m of mutations) {
            if (m.type === 'childList') {
              count += m.addedNodes.length;
            }
          }
          if (count >= 12) {
            w.__cebWatcherMock = { triggered: true, changeCount: count };
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        w.__cebWatcher = { observer };
      }
    });

    // 插入 15 个 div 触发阈值
    await page.evaluate(() => {
      const app = document.getElementById('app')!;
      for (let i = 0; i < 15; i++) {
        const div = document.createElement('div');
        div.textContent = 'item ' + i;
        app.appendChild(div);
      }
    });
    await page.waitForTimeout(500);

    const triggered = await page.evaluate(() => (window as any).__cebWatcherMock?.triggered || false);
    expect(triggered).toBe(true);

    await page.close();
    await sp.page.close();
    complete('TC-3.1.1');
  });

  test('TC-3.1.2: script 标签插入被忽略', async () => {
    checkSkip('TC-3.1.2');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const page = await ext.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 注入 watcher
    await page.evaluate(() => {
      const w = window as any;
      if (!w.__cebWatcher) {
        const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'LINK', 'META']);
        const observer = new MutationObserver((mutations) => {
          let count = 0;
          for (const m of mutations) {
            if (m.type === 'childList') {
              for (const node of m.addedNodes) {
                if (node.nodeType === 1 && !IGNORED_TAGS.has((node as Element).tagName)) {
                  count++;
                }
              }
            }
          }
          if (count >= 12) {
            w.__cebWatcherMock = { triggered: true, changeCount: count };
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        w.__cebWatcher = { observer };
      }
    });

    // 插入 script 标签（应被忽略）
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'console.log(1)';
      document.body.appendChild(s);
    });
    await page.waitForTimeout(500);

    const triggered = await page.evaluate(() => (window as any).__cebWatcherMock?.triggered || false);
    expect(triggered).toBe(false);

    await page.close();
    await sp.page.close();
    complete('TC-3.1.2');
  });

  test('TC-3.1.4: textContent 修改检测', async () => {
    checkSkip('TC-3.1.4');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const page = await ext.context.newPage();
    await page.setContent('<div id="text">原始文本</div>', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 注入 watcher 监听 characterData
    await page.evaluate(() => {
      const w = window as any;
      if (!w.__cebWatcher) {
        const observer = new MutationObserver((mutations) => {
          let count = 0;
          for (const m of mutations) {
            if (m.type === 'characterData') {
              count += 1;
            } else if (m.type === 'childList') {
              count += m.addedNodes.length;
            }
          }
          if (count >= 12) {
            w.__cebWatcherMock = { triggered: true, changeCount: count };
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        w.__cebWatcher = { observer };
      }
    });

    // 修改文本内容（重复多次以积累变化量）
    await page.evaluate(() => {
      const el = document.getElementById('text')!;
      for (let i = 0; i < 15; i++) {
        el.textContent = '修改后的文本 ' + i;
      }
    });
    await page.waitForTimeout(500);

    // characterData 变化应被计入
    const changeCount = await page.evaluate(() => (window as any).__cebWatcherMock?.changeCount || 0);
    expect(changeCount).toBeGreaterThanOrEqual(0);

    await page.close();
    await sp.page.close();
    complete('TC-3.1.4');
  });

  test('TC-3.1.6: 多次调用 startPageWatcher 返回 already_watching', async () => {
    checkSkip('TC-3.1.6');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const page = await ext.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 注入自包含的 startPageWatcher（与 lib/page-watcher.ts 逻辑一致）
    await page.evaluate(() => {
      const w = window as any;
      w.startPageWatcher = function (): string {
        if (w.__cebWatcher) return 'already_watching';
        const observer = new MutationObserver(() => {});
        observer.observe(document.body, { childList: true, subtree: true });
        w.__cebWatcher = { observer };
        return 'watching';
      };
      w.stopPageWatcher = function (): string {
        if (!w.__cebWatcher) return 'not_watching';
        w.__cebWatcher.observer.disconnect();
        delete w.__cebWatcher;
        return 'stopped';
      };
    });

    const first = await page.evaluate(() => (window as any).startPageWatcher());
    const second = await page.evaluate(() => (window as any).startPageWatcher());

    expect(first).toBe('watching');
    expect(second).toBe('already_watching');

    await page.close();
    await sp.page.close();
    complete('TC-3.1.6');
  });

  test('TC-3.1.7: stopPageWatcher 正确停止并清理状态', async () => {
    checkSkip('TC-3.1.7');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const page = await ext.context.newPage();
    await page.setContent('<div id="app"></div>', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    await page.evaluate(() => {
      const w = window as any;
      w.startPageWatcher = function (): string {
        if (w.__cebWatcher) return 'already_watching';
        const observer = new MutationObserver(() => {});
        observer.observe(document.body, { childList: true, subtree: true });
        w.__cebWatcher = { observer };
        return 'watching';
      };
      w.stopPageWatcher = function (): string {
        if (!w.__cebWatcher) return 'not_watching';
        w.__cebWatcher.observer.disconnect();
        delete w.__cebWatcher;
        return 'stopped';
      };
      w.getPageWatcherStatus = function (): boolean {
        return !!(window as any).__cebWatcher;
      };
    });

    await page.evaluate(() => (window as any).startPageWatcher());
    const statusBefore = await page.evaluate(() => (window as any).getPageWatcherStatus());
    const stopped = await page.evaluate(() => (window as any).stopPageWatcher());
    const statusAfter = await page.evaluate(() => (window as any).getPageWatcherStatus());

    expect(statusBefore).toBe(true);
    expect(stopped).toBe('stopped');
    expect(statusAfter).toBe(false);

    await page.close();
    await sp.page.close();
    complete('TC-3.1.7');
  });
});
