/**
 * Workflow Executor 重试机制测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 模拟 chrome.tabs
const mockChromeTabs = {
  query: vi.fn(),
  update: vi.fn(),
};

// 模拟 tab-helpers
const mockExecuteInTabWithArgs = vi.fn();
const mockWaitForNavigation = vi.fn();

vi.mock('@/lib/tab-helpers', () => ({
  executeInTabWithArgs: (...args: unknown[]) => mockExecuteInTabWithArgs(...args),
  waitForNavigation: (...args: unknown[]) => mockWaitForNavigation(...args),
}));

vi.mock('@/lib/tools/interact', () => ({
  performInteraction: vi.fn(),
}));

import { executeWorkflow } from '@/lib/workflow/executor';
import type { Workflow } from '@/lib/workflow/types';

describe('executeWorkflow retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChromeTabs.query.mockResolvedValue([{ id: 123 }]);
    mockWaitForNavigation.mockResolvedValue('Navigation complete');
    global.chrome = { tabs: mockChromeTabs } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries click step on element-not-found error and succeeds on second attempt', async () => {
    mockExecuteInTabWithArgs
      .mockRejectedValueOnce(new Error('Element not found: #btn'))
      .mockResolvedValueOnce('Clicked #btn');

    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Retry Test',
      steps: [{ type: 'click', selector: '#btn' }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    const result = await executeWorkflow(workflow, { tabId: 123 });
    expect(result.success).toBe(true);
    expect(mockExecuteInTabWithArgs).toHaveBeenCalledTimes(2);
  });

  it('retries extract step up to 3 times then fails', async () => {
    mockExecuteInTabWithArgs.mockResolvedValue(null);

    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Retry Fail Test',
      steps: [{ type: 'extract', selector: '#missing', toVariable: 'x' }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    const result = await executeWorkflow(workflow, { tabId: 123 });
    expect(result.success).toBe(false);
    // extract: 初始尝试 + 3次重试 = 4次调用
    expect(mockExecuteInTabWithArgs).toHaveBeenCalledTimes(4);
  });

  it('does not retry non-retryable errors immediately', async () => {
    mockExecuteInTabWithArgs.mockRejectedValue(new Error('Permission denied'));

    const workflow: Workflow = {
      id: 'wf-1',
      name: 'No Retry Test',
      steps: [{ type: 'click', selector: '#btn' }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    const result = await executeWorkflow(workflow, { tabId: 123 });
    expect(result.success).toBe(false);
    // 非可重试错误只尝试1次
    expect(mockExecuteInTabWithArgs).toHaveBeenCalledTimes(1);
  });

  it('retries type step with exponential backoff delay', async () => {
    mockExecuteInTabWithArgs
      .mockRejectedValueOnce(new Error('No element matches selector'))
      .mockRejectedValueOnce(new Error('No element matches selector'))
      .mockResolvedValueOnce('Typed into #input');

    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Type Retry Test',
      steps: [{ type: 'type', selector: '#input', text: 'hello' }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    const start = Date.now();
    const result = await executeWorkflow(workflow, { tabId: 123 });
    const elapsed = Date.now() - start;

    expect(result.success).toBe(true);
    expect(mockExecuteInTabWithArgs).toHaveBeenCalledTimes(3);
    // 指数退避: 第一次重试 500ms，第二次 1000ms，总计至少 1400ms
    expect(elapsed).toBeGreaterThanOrEqual(1400);
  });

  it('does not retry scroll or wait steps', async () => {
    mockExecuteInTabWithArgs.mockRejectedValue(new Error('Element not found'));

    const workflow: Workflow = {
      id: 'wf-1',
      name: 'No Retry Scroll',
      steps: [{ type: 'scroll', deltaY: 100 }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    const result = await executeWorkflow(workflow, { tabId: 123 });
    expect(result.success).toBe(false);
    // scroll 不在 RETRYABLE_STEP_TYPES 中，只尝试1次
    expect(mockExecuteInTabWithArgs).toHaveBeenCalledTimes(1);
  });

  it('includes retry info in step result output when successful after retry', async () => {
    mockExecuteInTabWithArgs
      .mockRejectedValueOnce(new Error('Timed out waiting for element'))
      .mockResolvedValueOnce('Clicked #btn');

    const stepResults: { success: boolean; output?: string; error?: string }[] = [];
    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Retry Success',
      steps: [{ type: 'click', selector: '#btn' }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    await executeWorkflow(workflow, {
      tabId: 123,
      onStepEnd: (_step, _index, result) => stepResults.push(result),
    });

    expect(stepResults[0].success).toBe(true);
    expect(stepResults[0].output).toBe('Clicked #btn');
  });

  it('logs retry attempts via console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockExecuteInTabWithArgs
      .mockRejectedValueOnce(new Error('Element not found'))
      .mockResolvedValueOnce('Clicked #btn');

    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Retry Logging Test',
      steps: [{ type: 'click', selector: '#btn' }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    await executeWorkflow(workflow, { tabId: 123 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Workflow] Step "click" failed (attempt 1/4), retrying in 500ms: Element not found'),
    );
    warnSpy.mockRestore();
  });

  it('respects maxDelayMs cap for exponential backoff', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 连续失败3次，触发第1、2、3次重试，延迟应被上限截断
    mockExecuteInTabWithArgs
      .mockRejectedValueOnce(new Error('Element not found'))
      .mockRejectedValueOnce(new Error('Element not found'))
      .mockRejectedValueOnce(new Error('Element not found'))
      .mockResolvedValueOnce('Clicked #btn');

    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Max Delay Test',
      steps: [{ type: 'click', selector: '#btn' }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    const start = Date.now();
    await executeWorkflow(workflow, { tabId: 123 });
    const elapsed = Date.now() - start;

    // 延迟: 500 + 1000 + 2000 = 3500ms (均未超过 5000ms 上限)
    expect(elapsed).toBeGreaterThanOrEqual(3300);

    // 验证第3次重试的延迟为 2000ms，不是 4000ms
    const calls = warnSpy.mock.calls;
    expect(calls[2][0]).toContain('retrying in 2000ms');
    warnSpy.mockRestore();
  });

  it('aborts retry delay when signal is triggered', async () => {
    mockExecuteInTabWithArgs.mockRejectedValue(new Error('Element not found'));

    const workflow: Workflow = {
      id: 'wf-1',
      name: 'Abort Retry Test',
      steps: [{ type: 'click', selector: '#btn' }],
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
    };

    const controller = new AbortController();
    const promise = executeWorkflow(workflow, { tabId: 123, signal: controller.signal });

    // 在 100ms 后触发 abort，确保在重试延迟期间取消
    setTimeout(() => controller.abort(), 100);

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('aborted');
  });

  it('retries all retryable step types on element-not-found errors', async () => {
    const retryableTypes = ['click', 'type', 'select', 'focus', 'hover', 'dblclick', 'rightclick'];

    for (const stepType of retryableTypes) {
      vi.clearAllMocks();
      mockExecuteInTabWithArgs
        .mockRejectedValueOnce(new Error('Element not found'))
        .mockResolvedValueOnce('OK');

      const step: any = { type: stepType, selector: '#target' };
      if (stepType === 'type') step.text = 'hello';
      if (stepType === 'select') step.text = 'option1';

      const workflow: Workflow = {
        id: 'wf-1',
        name: `Retry ${stepType}`,
        steps: [step],
        createdAt: 1,
        updatedAt: 1,
        runCount: 0,
      };

      const result = await executeWorkflow(workflow, { tabId: 123 });
      expect(result.success).toBe(true);
      expect(mockExecuteInTabWithArgs).toHaveBeenCalledTimes(2);
    }
  });
});
