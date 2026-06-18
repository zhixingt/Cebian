/**
 * 将 RecordedSession 转换为持久化 Workflow。
 *
 * 复用 session-to-sequence.ts 的优化逻辑，将 SequenceStep[] 二次映射为
 * WorkflowStep[]，并填充 Workflow 元数据（id、name、timestamp 等）。
 */

import type { RecordedSession } from '@/lib/recorder/types';
import { sessionToSequence } from '@/lib/recorder/session-to-sequence';
import type { SequenceStep } from '@/lib/recorder/session-to-sequence';
import type { Workflow, WorkflowStep } from './types';

// ─── SequenceStep → WorkflowStep ───

/**
 * 将单个 SequenceStep 映射为 WorkflowStep。
 * 注意：SequenceStep 中的 `clear` 会合并到相邻的 `type` 中，
 * 不会作为独立 WorkflowStep 输出。
 */
function mapSequenceStep(step: SequenceStep): WorkflowStep | null {
  switch (step.action) {
    case 'click':
      return { type: 'click', selector: step.selector!, timeout: step.timeout };
    case 'type':
      return {
        type: 'type',
        selector: step.selector!,
        text: step.text!,
        clear: false,
        timeout: step.timeout,
      };
    case 'clear':
      // clear 在 WorkflowStep 中不独立存在，由相邻 type 的 clear: true 承载
      return null;
    case 'select':
      return { type: 'select', selector: step.selector!, text: step.text!, timeout: step.timeout };
    case 'scroll':
      return { type: 'scroll', selector: step.selector, deltaX: step.deltaX, deltaY: step.deltaY };
    case 'keypress':
      return { type: 'keypress', selector: step.selector, key: step.key!, modifiers: step.modifiers };
    case 'wait':
      return { type: 'wait', selector: step.selector, timeout: step.timeout ?? 5000 };
    case 'wait_navigation':
      return { type: 'wait_navigation', timeout: step.timeout };
    case 'focus':
      return { type: 'focus', selector: step.selector! };
    case 'hover':
      return { type: 'hover', selector: step.selector! };
    case 'dblclick':
      return { type: 'dblclick', selector: step.selector! };
    case 'rightclick':
      return { type: 'rightclick', selector: step.selector! };
    default:
      return null;
  }
}

/**
 * 将 SequenceStep[] 转换为 WorkflowStep[]。
 * 核心差异处理：SequenceStep 中的 clear 是独立动作，
 * WorkflowStep 将其内化为 type 步骤的 clear 属性。
 */
export function sequenceToWorkflowSteps(sequence: SequenceStep[]): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  let i = 0;
  while (i < sequence.length) {
    const curr = sequence[i];
    const next = sequence[i + 1];

    // 合并相邻的 clear + type 对为单个 TypeStep（clear: true）
    if (
      curr.action === 'clear' &&
      next?.action === 'type' &&
      curr.selector === next.selector
    ) {
      steps.push({
        type: 'type',
        selector: next.selector!,
        text: next.text!,
        clear: true,
        timeout: next.timeout,
      });
      i += 2;
      continue;
    }

    // 跳过孤立的 clear（无法合并到相邻 type）
    if (curr.action === 'clear') {
      i++;
      continue;
    }

    const mapped = mapSequenceStep(curr);
    if (mapped) steps.push(mapped);
    i++;
  }
  return steps;
}

// ─── RecordedSession → Workflow ───

export type SessionToWorkflowOptions = {
  /** 自定义 Workflow 名称，缺省自动生成 */
  name?: string;
  /** 自定义描述 */
  description?: string;
  /** 是否包含导航步骤（默认 true） */
  includeNavigation?: boolean;
  /** 是否包含 mutation 步骤（默认 false） */
  includeMutations?: boolean;
};

/**
 * 从 RecordedSession 生成 Workflow。
 *
 * 流程：
 * 1. RecordedSession → SequenceStep[]（复用 sessionToSequence 优化逻辑）
 * 2. SequenceStep[] → WorkflowStep[]（clear 合并、字段映射）
 * 3. 填充 Workflow 元数据
 */
export function sessionToWorkflow(
  session: RecordedSession,
  options: SessionToWorkflowOptions = {},
): Workflow {
  const {
    name,
    description,
    includeNavigation = true,
    includeMutations = false,
  } = options;

  const sequence = sessionToSequence(session, {
    includeNavigation,
    includeMutations,
    smartOptimize: true,
  });

  const steps = sequenceToWorkflowSteps(sequence);
  const now = Date.now();

  // 自动生成名称：取第一个导航 URL 的 hostname 或页面标题
  const autoName = deriveWorkflowName(session);

  return {
    id: generateWorkflowId(),
    name: name?.trim() || autoName,
    description: description?.trim() || `Recorded on ${new Date(now).toLocaleString()}`,
    steps,
    trigger: { type: 'manual' },
    createdAt: now,
    updatedAt: now,
    runCount: 0,
  };
}

// ─── 辅助 ───

function generateWorkflowId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function deriveWorkflowName(session: RecordedSession): string {
  // 优先取第一个导航事件的 URL hostname
  const navEvent = session.events.find(
    (e) => e.kind === 'tab' && (e as any).event === 'navigated',
  );
  if (navEvent) {
    try {
      const url = new URL(navEvent.url);
      return `${url.hostname} Workflow`;
    } catch {
      // URL 解析失败，回退
    }
  }
  // 回退：取第一个事件的 URL hostname
  if (session.events[0]) {
    try {
      const url = new URL(session.events[0].url);
      return `${url.hostname} Workflow`;
    } catch {
      // ignore
    }
  }
  return `Workflow ${new Date(session.startedAt).toLocaleDateString()}`;
}
