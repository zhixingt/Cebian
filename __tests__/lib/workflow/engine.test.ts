/**
 * Workflow Engine 压力测试 — 断点续跑与长时运行场景
 *
 * 覆盖场景：
 * 1. 正常多步骤执行与每步状态持久化
 * 2. SW 终止后从断点恢复（不重复执行已完成的步骤）
 * 3. 变量在断点续跑后的正确性
 * 4. 多次中断-恢复最终仍能完成
 * 5. recoverRunningWorkflows 批量恢复多个中断的 run
 * 6. 恢复持续失败的 run 被标记为 failure（防止无限重试）
 * 7. 长 Workflow（50 步）状态一致性
 * 8. if/嵌套步骤中的中断恢复行为
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── mock executeWorkflow ───

vi.mock('@/lib/workflow/executor', () => ({
  executeWorkflow: vi.fn(),
}));

import { executeWorkflow } from '@/lib/workflow/executor';
import {
  startWorkflowRun,
  resumeWorkflowRun,
  recoverRunningWorkflows,
} from '@/lib/workflow/engine';
import { getDb } from '@/lib/db';
import type { Workflow, WorkflowRunState } from '@/lib/workflow/types';
import {
  createWorkflow,
  getRunState,
  createRunState,
  updateRunState,
  listRunningStates,
} from '@/lib/workflow/repository';

const mockExecuteWorkflow = vi.mocked(executeWorkflow);

let runIdSeq = 0;

function nextRunId(): string {
  return `run-${++runIdSeq}`;
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const now = Date.now();
  return {
    id: `wf-${now}-${Math.random().toString(36).slice(2, 5)}`,
    name: 'Test Workflow',
    steps: [],
    trigger: { type: 'manual' },
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    ...overrides,
  };
}

/** 模拟正常执行：顺序调用回调并返回成功结果 */
function mockNormalExecution() {
  mockExecuteWorkflow.mockImplementation(async (workflow, options = {}) => {
    const stepResults: { step: any; index: number; success: boolean; output: string; durationMs: number; variables?: Record<string, string> }[] = [];
    const vars = { ...options.variables };
    const start = options.startStepIndex ?? 0;
    for (let i = start; i < workflow.steps.length; i++) {
      options.onStepStart?.(workflow.steps[i], i);
      const result = {
        step: workflow.steps[i],
        index: i,
        success: true,
        output: `step-${i}-ok`,
        durationMs: 10,
        variables: { ...vars },
      };
      stepResults.push(result);
      options.onStepEnd?.(workflow.steps[i], i, result);
    }
    return { success: true, stepResults, variables: vars };
  });
}

/** 模拟执行到指定索引时抛出异常（模拟 SW 终止） */
function mockCrashAtStep(crashIndex: number) {
  mockExecuteWorkflow.mockImplementationOnce(async (workflow, options = {}) => {
    const vars = { ...options.variables };
    const start = options.startStepIndex ?? 0;
    for (let i = start; i < workflow.steps.length; i++) {
      options.onStepStart?.(workflow.steps[i], i);
      if (i === crashIndex) {
        throw new Error('Service Worker terminated');
      }
      const result = {
        step: workflow.steps[i],
        index: i,
        success: true,
        output: `step-${i}-ok`,
        durationMs: 10,
        variables: { ...vars },
      };
      options.onStepEnd?.(workflow.steps[i], i, result);
    }
    return { success: true, stepResults: [], variables: vars };
  });
}

// ─── 测试套件 ───

describe('Workflow Engine 压力测试', () => {
  beforeEach(async () => {
    await getDb().workflows.clear();
    await getDb().workflowRunStates.clear();
    mockExecuteWorkflow.mockReset();
    runIdSeq = 0;
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: vi.fn(() => nextRunId()) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 1. 正常多步骤执行与状态持久化 ───

  it('正常执行 10 步 workflow，每步状态都被持久化', async () => {
    mockNormalExecution();

    const steps = Array.from({ length: 10 }, (_, i) => ({
      type: 'click' as const,
      selector: `#btn-${i}`,
    }));
    const workflow = makeWorkflow({ id: 'wf-10', steps });
    await createWorkflow(workflow);

    const result = await startWorkflowRun(workflow);

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(10);

    const finalState = await getRunState(result.runId);
    expect(finalState?.status).toBe('success');
    expect(finalState?.currentStepIndex).toBe(10);
    expect(finalState?.endedAt).toBeGreaterThan(0);
  });

  // ─── 2. SW 终止后从断点恢复 ───

  it('执行到第 3 步时 SW 终止，恢复后从第 3 步开始且不重复执行前面步骤', async () => {
    // 第一次：执行到索引 2 时崩溃
    mockCrashAtStep(2);
    // 恢复时正常执行
    mockNormalExecution();

    const steps = Array.from({ length: 5 }, (_, i) => ({
      type: 'click' as const,
      selector: `#btn-${i}`,
    }));
    const workflow = makeWorkflow({ id: 'wf-resume', steps });
    await createWorkflow(workflow);

    // 启动执行，会在第 3 步（索引 2）崩溃
    await expect(startWorkflowRun(workflow)).rejects.toThrow('Service Worker terminated');

    // 此时状态应为 running，currentStepIndex 应为 2（onStepStart 已触发）
    // 实际上 onStepStart 索引 2 被调用后崩溃，onStepEnd 未被调用
    // 因此 currentStepIndex 应该还是 2（由 onStepStart 设置）
    const state1 = await getRunState('run-1');
    expect(state1?.status).toBe('running');
    expect(state1?.currentStepIndex).toBe(2);

    // 恢复执行
    const resumed = await resumeWorkflowRun(state1!);

    expect(resumed.success).toBe(true);
    // 恢复时应从索引 2 开始，执行 3 步（索引 2,3,4）
    expect(resumed.stepResults).toHaveLength(3);
    expect(resumed.stepResults[0].index).toBe(2);
    expect(resumed.stepResults[2].index).toBe(4);

    const finalState = await getRunState('run-1');
    expect(finalState?.status).toBe('success');
    expect(finalState?.currentStepIndex).toBe(5);
  });

  // ─── 3. 变量在断点续跑后的正确性 ───

  it('断点续跑后前面步骤设置的变量仍然可用', async () => {
    // 第一次：执行到索引 2 时崩溃
    mockExecuteWorkflow.mockImplementationOnce(async (workflow, options = {}) => {
      const start = options.startStepIndex ?? 0;
      const vars = { ...options.variables };
      for (let i = start; i < workflow.steps.length; i++) {
        options.onStepStart?.(workflow.steps[i], i);
        if (i === 2) {
          throw new Error('Service Worker terminated');
        }
        // 模拟 extract 步骤设置变量
        if (workflow.steps[i].type === 'extract') {
          vars.price = '199';
        }
        const result = {
          step: workflow.steps[i],
          index: i,
          success: true,
          output: `step-${i}-ok`,
          durationMs: 10,
          variables: { ...vars },
        };
        options.onStepEnd?.(workflow.steps[i], i, result);
      }
      return { success: true, stepResults: [], variables: vars };
    });

    // 恢复时正常执行，但需验证接收到的变量包含 price
    mockExecuteWorkflow.mockImplementationOnce(async (workflow, options = {}) => {
      // 验证恢复时变量被正确传入
      const vars = options.variables ?? {};
      expect(vars.price).toBe('199');

      const stepResults: any[] = [];
      const start = options.startStepIndex ?? 0;
      for (let i = start; i < workflow.steps.length; i++) {
        options.onStepStart?.(workflow.steps[i], i);
        const result = {
          step: workflow.steps[i],
          index: i,
          success: true,
          output: `step-${i}-ok`,
          durationMs: 10,
          variables: { ...vars },
        };
        stepResults.push(result);
        options.onStepEnd?.(workflow.steps[i], i, result);
      }
      return { success: true, stepResults, variables: vars };
    });

    const steps = [
      { type: 'navigate' as const, url: 'https://example.com' },
      { type: 'extract' as const, selector: '#price', toVariable: 'price' },
      { type: 'click' as const, selector: '#btn-2' },
      { type: 'click' as const, selector: '#btn-3' },
    ];
    const workflow = makeWorkflow({ id: 'wf-vars', steps });
    await createWorkflow(workflow);

    await expect(startWorkflowRun(workflow)).rejects.toThrow('Service Worker terminated');

    const state = await getRunState('run-1');
    expect(state?.variables.price).toBe('199');

    await resumeWorkflowRun(state!);
  });

  // ─── 4. 多次中断-恢复最终完成 ───

  it('10 步 workflow 在第 3 步和第 7 步中断，两次恢复后最终成功', async () => {
    mockCrashAtStep(3);
    mockCrashAtStep(7);
    mockNormalExecution();

    const steps = Array.from({ length: 10 }, (_, i) => ({
      type: 'click' as const,
      selector: `#btn-${i}`,
    }));
    const workflow = makeWorkflow({ id: 'wf-multi', steps });
    await createWorkflow(workflow);

    // 第一次启动，第 3 步崩溃
    await expect(startWorkflowRun(workflow)).rejects.toThrow('Service Worker terminated');
    let state = await getRunState('run-1');
    expect(state?.currentStepIndex).toBe(3);

    // 第一次恢复，第 7 步崩溃
    await expect(resumeWorkflowRun(state!)).rejects.toThrow('Service Worker terminated');
    state = await getRunState('run-1');
    expect(state?.currentStepIndex).toBe(7);

    // 第二次恢复，最终成功
    const result = await resumeWorkflowRun(state!);
    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(3); // 索引 7,8,9

    const finalState = await getRunState('run-1');
    expect(finalState?.status).toBe('success');
    expect(finalState?.currentStepIndex).toBe(10);
  });

  // ─── 5. recoverRunningWorkflows 批量恢复 ───

  it('recoverRunningWorkflows 批量恢复 3 个中断的 run', async () => {
    mockNormalExecution();

    const steps = [
      { type: 'navigate' as const, url: 'https://a.com' },
      { type: 'click' as const, selector: '#btn' },
    ];

    for (let i = 0; i < 3; i++) {
      const wf = makeWorkflow({ id: `wf-batch-${i}`, steps });
      await createWorkflow(wf);
      await createRunState({
        workflowId: wf.id,
        runId: `run-batch-${i}`,
        status: 'running',
        currentStepIndex: 1,
        variables: {},
        startedAt: Date.now(),
      });
    }

    await recoverRunningWorkflows();

    for (let i = 0; i < 3; i++) {
      const state = await getRunState(`run-batch-${i}`);
      expect(state?.status).toBe('success');
      expect(state?.endedAt).toBeGreaterThan(0);
    }
  });

  // ─── 6. 恢复持续失败的 run 被标记为 failure ───

  it('恢复时持续抛出异常的 run 被标记为 failure，防止无限重试', async () => {
    mockExecuteWorkflow.mockImplementation(async () => {
      throw new Error('Persistent SW crash');
    });

    const steps = [{ type: 'click' as const, selector: '#btn' }];
    const wf = makeWorkflow({ id: 'wf-fail', steps });
    await createWorkflow(wf);
    await createRunState({
      workflowId: wf.id,
      runId: 'run-fail-1',
      status: 'running',
      currentStepIndex: 0,
      variables: {},
      startedAt: Date.now(),
    });

    await recoverRunningWorkflows();

    const state = await getRunState('run-fail-1');
    expect(state?.status).toBe('failure');
    expect(state?.error).toContain('Persistent SW crash');
    expect(state?.endedAt).toBeGreaterThan(0);
  });

  // ─── 7. 长 Workflow（50 步）状态一致性 ───

  it('50 步长 workflow 的状态更新保持正确且最终成功', async () => {
    mockNormalExecution();

    const steps = Array.from({ length: 50 }, (_, i) => ({
      type: 'click' as const,
      selector: `#item-${i}`,
    }));
    const workflow = makeWorkflow({ id: 'wf-long', steps });
    await createWorkflow(workflow);

    const result = await startWorkflowRun(workflow);

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(50);

    const finalState = await getRunState(result.runId);
    expect(finalState?.status).toBe('success');
    expect(finalState?.currentStepIndex).toBe(50);

    // 验证所有中间状态都被正确更新（最终 currentStepIndex 应为 50）
    expect(mockExecuteWorkflow).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteWorkflow.mock.calls[0][1] as any;
    expect(callArgs.startStepIndex).toBeUndefined();
  });

  // ─── 8. if/嵌套步骤中的中断恢复行为 ───

  it('if 步骤内部子步骤执行时中断，恢复后重新执行整个 if 步骤', async () => {
    // if 步骤在 executor 中是原子操作：子步骤不单独触发 onStepStart/onStepEnd
    // 因此 engine 的 currentStepIndex 指向 if 步骤本身
    mockExecuteWorkflow.mockImplementationOnce(async (workflow, options = {}) => {
      const start = options.startStepIndex ?? 0;
      for (let i = start; i < workflow.steps.length; i++) {
        options.onStepStart?.(workflow.steps[i], i);
        if (i === 1) {
          // 模拟 if 步骤执行中崩溃
          throw new Error('SW terminated inside if-step');
        }
        const result = {
          step: workflow.steps[i],
          index: i,
          success: true,
          output: `step-${i}-ok`,
          durationMs: 10,
          variables: { ...options.variables },
        };
        options.onStepEnd?.(workflow.steps[i], i, result);
      }
      return { success: true, stepResults: [], variables: options.variables ?? {} };
    });

    mockNormalExecution();

    const steps: any[] = [
      { type: 'navigate', url: 'https://example.com' },
      {
        type: 'if',
        condition: { variable: 'x', operator: 'eq', value: '1' },
        thenSteps: [
          { type: 'click', selector: '#a' },
          { type: 'click', selector: '#b' },
        ],
      },
      { type: 'click', selector: '#c' },
    ];
    const workflow = makeWorkflow({ id: 'wf-if', steps });
    await createWorkflow(workflow);

    await expect(startWorkflowRun(workflow)).rejects.toThrow('SW terminated inside if-step');

    const state = await getRunState('run-1');
    expect(state?.status).toBe('running');
    // if 步骤的 onStepStart 被调用后崩溃，currentStepIndex 应为 1
    expect(state?.currentStepIndex).toBe(1);

    const result = await resumeWorkflowRun(state!);
    expect(result.success).toBe(true);

    // 恢复后从索引 1（if 步骤）开始执行
    expect(result.stepResults[0].index).toBe(1);
    expect(result.stepResults[1].index).toBe(2);

    const finalState = await getRunState('run-1');
    expect(finalState?.status).toBe('success');
  });

  // ─── 9. startStepIndex 边界：从最后一步恢复后成功 ───

  it('从最后一步（索引等于 steps.length - 1）恢复后执行最后一步并成功', async () => {
    mockNormalExecution();

    const steps = [
      { type: 'click' as const, selector: '#a' },
      { type: 'click' as const, selector: '#b' },
    ];
    const wf = makeWorkflow({ id: 'wf-last', steps });
    await createWorkflow(wf);
    await createRunState({
      workflowId: wf.id,
      runId: 'run-last',
      status: 'running',
      currentStepIndex: 1,
      variables: {},
      startedAt: Date.now(),
    });

    const result = await resumeWorkflowRun({
      workflowId: wf.id,
      runId: 'run-last',
      status: 'running',
      currentStepIndex: 1,
      variables: {},
      startedAt: Date.now(),
    });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].index).toBe(1);

    const finalState = await getRunState('run-last');
    expect(finalState?.status).toBe('success');
    expect(finalState?.currentStepIndex).toBe(2);
  });

  // ─── 10. 空 workflow 立即成功 ───

  it('0 步 workflow 立即返回成功', async () => {
    mockNormalExecution();

    const workflow = makeWorkflow({ id: 'wf-empty', steps: [] });
    await createWorkflow(workflow);

    const result = await startWorkflowRun(workflow);
    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(0);

    const finalState = await getRunState(result.runId);
    expect(finalState?.status).toBe('success');
    expect(finalState?.currentStepIndex).toBe(0);
  });
});
