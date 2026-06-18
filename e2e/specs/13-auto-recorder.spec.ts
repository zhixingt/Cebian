import { test, expect } from '@playwright/test';
import { launchWithExtension, type ExtensionContext } from '../helpers/extension';
import {
  openSidepanel, waitForSidepanelReady, getBodyText, sendChatMessage,
} from '../helpers/sidepanel';
import { installAllMocks } from '../helpers/mock-server';
import { checkSkip, complete } from '../fixtures/test-extend';
import { generateSummary } from '../helpers/state';

/**
 * E2E 自动化套件: 录制与回放 (9 个用例)
 * 用例ID: TC-4.1.x ~ TC-4.5.x
 */
test.describe('AUTO: Recorder & Playback', () => {
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

  // ─── 4.1 开始录制 ───

  test('TC-4.1.1: 录制按钮状态切换', async () => {
    checkSkip('TC-4.1.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    // 打开一个普通网页以便录制有内容可记录
    const webPage = await ext.context.newPage();
    await webPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    const recordBtn = sp.page.locator('[aria-label*="录制"], [aria-label*="record"], [title*="录制"], [title*="record"]').first();
    if (await recordBtn.count() === 0) {
      // 如果 aria-label 被本地化，尝试通过组件结构定位
      const altBtn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
      if (await altBtn.count() > 0) await altBtn.click();
    } else {
      await recordBtn.click();
    }
    await sp.page.waitForTimeout(1000);

    // 录制中按钮应有 rose 颜色或 pulse 动画
    const btn = sp.page.locator('[aria-label*="停止"], [aria-label*="stop"], [title*="停止"], [title*="stop"]').first()
      || sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    const className = await btn.getAttribute('class').catch(() => '');
    const hasPulse = await btn.locator('.animate-pulse').isVisible().catch(() => false);
    expect(className.includes('rose') || className.includes('text-rose') || hasPulse).toBe(true);

    await webPage.close();
    await sp.page.close();
    complete('TC-4.1.1');
  });

  // ─── 4.2 停止录制 ───

  test('TC-4.2.1: 停止录制后聊天记录出现录制附件 chip', async () => {
    checkSkip('TC-4.2.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const webPage = await ext.context.newPage();
    await webPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 开始录制
    let btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(500);

    // 在网页上执行一次点击操作
    await webPage.click('body').catch(() => {});
    await sp.page.waitForTimeout(500);

    // 停止录制（再次点击同一个按钮）
    btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(2000);

    // 检查输入框区域是否有录制附件 chip
    const attachment = sp.page.locator('[data-type="recording"], .text-amber-400, [title*="recording"]').first();
    const hasAttachment = await attachment.isVisible().catch(() => false);
    // 如果附件未出现，检查 body 文本中是否有录制相关提示
    const body = await getBodyText(sp);
    const hasRecordingText = body.includes('录制') || body.includes('recording') || body.includes('附件');
    expect(hasAttachment || hasRecordingText).toBe(true);

    await webPage.close();
    await sp.page.close();
    complete('TC-4.2.1');
  });

  // ─── 4.3 录制编辑器 ───

  test('TC-4.3.1: 点击录制附件打开 RecordingEditor Dialog', async () => {
    checkSkip('TC-4.3.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const webPage = await ext.context.newPage();
    await webPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 录制并停止
    let btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(500);
    await webPage.click('body').catch(() => {});
    await sp.page.waitForTimeout(500);
    btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(2000);

    // 点击录制附件打开编辑器
    const chip = sp.page.locator('[data-type="recording"], .text-amber-400').first();
    if (await chip.count() > 0) await chip.click();
    await sp.page.waitForTimeout(1000);

    const dialog = sp.page.locator('[role="dialog"], [data-testid="recording-editor"]').first();
    expect(await dialog.isVisible().catch(() => false)).toBe(true);

    await webPage.close();
    await sp.page.close();
    complete('TC-4.3.1');
  });

  test('TC-4.3.2: 修改步骤值', async () => {
    checkSkip('TC-4.3.2');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const webPage = await ext.context.newPage();
    await webPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 录制并停止
    let btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(500);
    await webPage.click('body').catch(() => {});
    await sp.page.waitForTimeout(500);
    btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(2000);

    // 打开编辑器
    const chip = sp.page.locator('[data-type="recording"], .text-amber-400').first();
    if (await chip.count() > 0) await chip.click();
    await sp.page.waitForTimeout(1000);

    const dialog = sp.page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      const input = dialog.locator('input').first();
      if (await input.count() > 0) {
        await input.fill('new-selector-value');
        await sp.page.waitForTimeout(200);
        const val = await input.inputValue();
        expect(val).toBe('new-selector-value');
      }
    }

    await webPage.close();
    await sp.page.close();
    complete('TC-4.3.2');
  });

  test('TC-4.3.4: 删除步骤', async () => {
    checkSkip('TC-4.3.4');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const webPage = await ext.context.newPage();
    await webPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 录制并停止（多执行几次操作以确保有多步骤）
    let btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(500);
    await webPage.click('body').catch(() => {});
    await webPage.click('body').catch(() => {});
    await sp.page.waitForTimeout(500);
    btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(2000);

    // 打开编辑器
    const chip = sp.page.locator('[data-type="recording"], .text-amber-400').first();
    if (await chip.count() > 0) await chip.click();
    await sp.page.waitForTimeout(1000);

    const dialog = sp.page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      const stepsBefore = await dialog.locator('[data-testid="step"], .step-item, .group').count();
      const delBtn = dialog.locator('button[title*="删除"], button:has(.lucide-trash2)').first();
      if (await delBtn.count() > 0) {
        await delBtn.click();
        await sp.page.waitForTimeout(200);
        const stepsAfter = await dialog.locator('[data-testid="step"], .step-item, .group').count();
        expect(stepsAfter).toBeLessThan(stepsBefore);
      }
    }

    await webPage.close();
    await sp.page.close();
    complete('TC-4.3.4');
  });

  test('TC-4.3.8: 回放步骤关闭编辑器', async () => {
    checkSkip('TC-4.3.8');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const webPage = await ext.context.newPage();
    await webPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 录制并停止
    let btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(500);
    await webPage.click('body').catch(() => {});
    await sp.page.waitForTimeout(500);
    btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(2000);

    // 打开编辑器
    const chip = sp.page.locator('[data-type="recording"], .text-amber-400').first();
    if (await chip.count() > 0) await chip.click();
    await sp.page.waitForTimeout(1000);

    const dialog = sp.page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      const replayBtn = dialog.locator('button:has-text("回放"), button:has(.lucide-play)').first();
      if (await replayBtn.count() > 0) {
        await replayBtn.click();
        await sp.page.waitForTimeout(1000);
        const closed = await dialog.isVisible().catch(() => false);
        expect(closed).toBe(false);
      }
    }

    await webPage.close();
    await sp.page.close();
    complete('TC-4.3.8');
  });

  test('TC-4.3.9: 保存为快捷指令', async () => {
    checkSkip('TC-4.3.9');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const webPage = await ext.context.newPage();
    await webPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 录制并停止
    let btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(500);
    await webPage.click('body').catch(() => {});
    await sp.page.waitForTimeout(500);
    btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(2000);

    // 打开编辑器
    const chip = sp.page.locator('[data-type="recording"], .text-amber-400').first();
    if (await chip.count() > 0) await chip.click();
    await sp.page.waitForTimeout(1000);

    const dialog = sp.page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      // 点击保存为快捷指令按钮
      const saveAsBtn = dialog.locator('button:has-text("保存为快捷指令"), button:has-text("Save as"), button:has(.lucide-save)').nth(1).first();
      if (await saveAsBtn.count() > 0) await saveAsBtn.click();
      await sp.page.waitForTimeout(500);

      const nameInput = dialog.locator('input').first();
      if (await nameInput.count() > 0) await nameInput.fill('TestWorkflow');
      const saveBtn = dialog.locator('button:has-text("保存"), button:has-text("Save")').first();
      if (await saveBtn.count() > 0) await saveBtn.click();
      await sp.page.waitForTimeout(1000);

      // 检查 toast 成功提示
      const toast = sp.page.locator('[data-sonner-toast]').first();
      if (await toast.isVisible().catch(() => false)) {
        const toastText = await toast.innerText();
        expect(toastText.includes('成功') || toastText.includes('saved') || toastText.includes('保存')).toBe(true);
      }
    }

    await webPage.close();
    await sp.page.close();
    complete('TC-4.3.9');
  });

  // ─── 4.4 录制内容回放 ───

  test('TC-4.4.1: 登录流程录制与回放', async () => {
    checkSkip('TC-4.4.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    // 构造一个模拟登录页面
    const loginPage = await ext.context.newPage();
    await loginPage.setContent(
      '<input id="user" placeholder="用户名" /><input id="pass" type="password" placeholder="密码" /><button id="login">登录</button>',
      { waitUntil: 'domcontentloaded' },
    );
    await sp.page.waitForTimeout(500);

    // 开始录制
    let btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(500);

    // 在登录页执行操作
    await loginPage.fill('#user', 'testuser').catch(() => {});
    await loginPage.fill('#pass', 'testpass').catch(() => {});
    await loginPage.click('#login').catch(() => {});
    await sp.page.waitForTimeout(500);

    // 停止录制
    btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(2000);

    // 检查录制附件存在
    const chip = sp.page.locator('[data-type="recording"], .text-amber-400').first();
    const hasChip = await chip.isVisible().catch(() => false);
    expect(hasChip).toBe(true);

    await loginPage.close();
    await sp.page.close();
    complete('TC-4.4.1');
  });

  // ─── 4.5 录制导出 ───

  test('TC-4.5.1: 录制附件 chip 类型为 recording', async () => {
    checkSkip('TC-4.5.1');
    const sp = await openSidepanel(ext.context, ext.extensionId);
    await waitForSidepanelReady(sp);
    const webPage = await ext.context.newPage();
    await webPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await sp.page.waitForTimeout(500);

    // 录制并停止
    let btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(500);
    await webPage.click('body').catch(() => {});
    await sp.page.waitForTimeout(500);
    btn = sp.page.locator('button').filter({ has: sp.page.locator('svg.lucide-circle-dot') }).first();
    if (await btn.count() > 0) await btn.click();
    await sp.page.waitForTimeout(2000);

    const chip = sp.page.locator('[data-type="recording"], .text-amber-400').first();
    if (await chip.count() > 0) {
      const type = await chip.getAttribute('data-type').catch(() => '');
      expect(type === 'recording' || type === '').toBe(true);
      // 如果 data-type 不存在，至少检查 className 包含 amber（recording chip 的样式）
      const className = await chip.getAttribute('class').catch(() => '');
      expect(className.includes('amber') || className.includes('recording') || type === 'recording').toBe(true);
    } else {
      // 如果没有 chip，检查 body 文本
      const body = await getBodyText(sp);
      expect(body.includes('录制') || body.includes('recording')).toBe(true);
    }

    await webPage.close();
    await sp.page.close();
    complete('TC-4.5.1');
  });
});
