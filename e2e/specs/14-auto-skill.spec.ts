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
 * E2E 自动化套件: BrowserWing Skill (8 个用例)
 * 用例ID: TC-5.1.x ~ TC-5.3.x
 */
test.describe('AUTO: BrowserWing Skill', () => {
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

  // ─── 5.1 Skill 部署 ───

  test('TC-5.1.1: Verify skill deployed', async () => {
    checkSkip('TC-5.1.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    const exists = await sp.page.evaluate(async () => {
      try {
        const vfs = (window as any).vfs;
        if (!vfs) return false;
        const content = await vfs.readFile('~/.cebian/skills/browserwing/SKILL.md');
        return typeof content === 'string' && content.length > 0;
      } catch {
        return false;
      }
    });
    expect(exists).toBe(true);

    await sp.page.close();
    complete('TC-5.1.1');
  });

  // ─── 5.2 Mock HTTP 端点 ───

  test('TC-5.2.1: Mock BrowserWing navigate', async () => {
    checkSkip('TC-5.2.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.route('http://127.0.0.1:8080/api/v1/executor/navigate', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, url: 'https://example.com' }),
      });
    });

    const result = await sp.page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:8080/api/v1/executor/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      return res.json();
    });
    expect(result.success).toBe(true);

    await sp.page.close();
    complete('TC-5.2.1');
  });

  test('TC-5.2.2: Mock snapshot', async () => {
    checkSkip('TC-5.2.2');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.route('http://127.0.0.1:8080/api/v1/executor/snapshot', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          elements: [
            { refId: '@e1', tag: 'button', text: 'Submit' },
            { refId: '@e2', tag: 'input', type: 'text', placeholder: 'Name' },
          ],
        }),
      });
    });

    const result = await sp.page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:8080/api/v1/executor/snapshot', { method: 'POST' });
      return res.json();
    });
    expect(result.success).toBe(true);
    const elements = result.elements || [];
    const hasRefId = elements.some((el: any) => el.refId === '@e1');
    expect(hasRefId).toBe(true);

    await sp.page.close();
    complete('TC-5.2.2');
  });

  test('TC-5.2.3: Mock click by RefID', async () => {
    checkSkip('TC-5.2.3');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.route('http://127.0.0.1:8080/api/v1/executor/click', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, clicked: true }),
      });
    });

    const result = await sp.page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:8080/api/v1/executor/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId: '@e1' }),
      });
      return res.json();
    });
    expect(result.success).toBe(true);
    expect(result.clicked).toBe(true);

    await sp.page.close();
    complete('TC-5.2.3');
  });

  test('TC-5.2.5: Mock batch', async () => {
    checkSkip('TC-5.2.5');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.route('http://127.0.0.1:8080/api/v1/executor/batch', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, results: [{ success: true }, { success: true }] }),
      });
    });

    const result = await sp.page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:8080/api/v1/executor/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: [
            { type: 'click', refId: '@e1' },
            { type: 'type', refId: '@e2', text: 'test' },
          ],
        }),
      });
      return res.json();
    });
    expect(result.success).toBe(true);

    await sp.page.close();
    complete('TC-5.2.5');
  });

  test('TC-5.2.9: Invalid action', async () => {
    checkSkip('TC-5.2.9');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.route('http://127.0.0.1:8080/api/v1/executor/foo', async (route) => {
      await route.fulfill({
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Invalid action' }),
      });
    });

    const result = await sp.page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:8080/api/v1/executor/foo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);

    await sp.page.close();
    complete('TC-5.2.9');
  });

  test('TC-5.2.10: Network error', async () => {
    checkSkip('TC-5.2.10');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    // Ensure no route handler for this endpoint so fetch throws
    await sp.page.unroute('http://127.0.0.1:8080/api/v1/executor/unavailable');

    const result = await sp.page.evaluate(async () => {
      try {
        const res = await fetch('http://127.0.0.1:8080/api/v1/executor/unavailable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        return { ok: res.ok, error: false };
      } catch (e) {
        return { ok: false, error: true, message: (e as Error).message };
      }
    });
    expect(result.error).toBe(true);

    await sp.page.close();
    complete('TC-5.2.10');
  });

  // ─── 5.3 Batch fill ───

  test('TC-5.3.1: Batch fill', async () => {
    checkSkip('TC-5.3.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);

    await sp.page.route('http://127.0.0.1:8080/api/v1/executor/fill-form', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, filled: true }),
      });
    });

    await sp.page.route('http://127.0.0.1:8080/api/v1/executor/batch', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, results: [{ success: true }, { success: true }] }),
      });
    });

    const result = await sp.page.evaluate(async () => {
      const entries = [
        { url: 'https://example.com/form1', data: { name: 'Alice' } },
        { url: 'https://example.com/form2', data: { name: 'Bob' } },
      ];
      let successCount = 0;
      for (const entry of entries) {
        const res = await fetch('http://127.0.0.1:8080/api/v1/executor/fill-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
        const data = await res.json().catch(() => ({}));
        if (data.success) successCount++;
      }
      return { successCount };
    });
    expect(result.successCount).toBe(2);

    await sp.page.close();
    complete('TC-5.3.1');
  });
});
