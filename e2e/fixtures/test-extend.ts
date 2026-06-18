import { test as baseTest, expect } from '@playwright/test';
import { loadState, shouldSkip, markCompleted, markFailed, markSkipped } from '../helpers/state';
import type { Page, BrowserContext } from '@playwright/test';

/**
 * 扩展 Playwright test 以支持断点续跑和用例状态追踪。
 *
 * 每个 test 通过 `testId` 参数标识，框架自动检查状态文件
 * 并在 resume 模式下跳过已执行的用例。
 */

export interface TestFixtures {
  testId: string;
  sidepanelContext: { page: Page; extensionId: string };
}

export const test = baseTest.extend<TestFixtures>({
  testId: ['', { option: true }],

  sidepanelContext: async ({ page, context }, use, testInfo) => {
    // 在 resume 模式下跳过已执行的用例
    const state = loadState();
    const testId = testInfo.title;
    if (shouldSkip(testId, process.env.RESUME === 'true')) {
      testInfo.skip();
    }
    
    await use({ page, extensionId: '' });
    
    // 测试结束后标记状态
    if (testInfo.status === 'passed') {
      markCompleted(testId);
    } else if (testInfo.status === 'failed') {
      const screenshot = testInfo.attachments.find(a => a.name === 'screenshot')?.path;
      markFailed(testId, testInfo.error?.message || 'unknown', screenshot);
    } else if (testInfo.status === 'skipped') {
      markSkipped(testId);
    }
  },
});

export { expect } from '@playwright/test';

/**
 * 在 resume 模式下检查是否跳过指定用例
 */
export function checkSkip(testId: string): void {
  if (shouldSkip(testId, process.env.RESUME === 'true')) {
    test.skip();
  }
}

/**
 * 标记用例完成（显式调用，用于非 fixture 场景）
 */
export function complete(testId: string): void {
  markCompleted(testId);
}

/**
 * 标记用例失败
 */
export function fail(testId: string, error: string): void {
  markFailed(testId, error);
}
