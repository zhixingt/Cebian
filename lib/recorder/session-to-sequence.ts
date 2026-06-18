/**
 * 将 RecordedSession 转换为 interact 工具的 sequence 步骤。
 *
 * 录制事件 → 可回放步骤的映射：
 * - interaction/click   → click
 * - interaction/input   → type（先 clear 再 type）
 * - interaction/change  → select
 * - interaction/scroll  → scroll
 * - interaction/keypress → keypress（repeat 展开为多次）
 * - interaction/submit  → click（表单提交按钮）
 * - tab/navigated       → wait_navigation
 * - mutation/appeared   → wait（等待元素出现）
 *
 * 其他事件（tab focus_changed/reloaded/created/closed、mutation disappeared）被跳过。
 */

import type {
  RecordedSession,
  RecordedEvent,
  InteractionEvent,
  TabEvent,
  MutationEvent,
} from './types';

// ─── 导出类型 ───

/** interact 工具 sequence 步骤 */
export type SequenceStep = {
  action: 'click' | 'type' | 'clear' | 'select' | 'scroll' | 'keypress'
    | 'wait' | 'wait_navigation' | 'focus' | 'hover' | 'dblclick' | 'rightclick';
  selector?: string;
  text?: string;
  key?: string;
  modifiers?: Array<'ctrl' | 'shift' | 'alt' | 'meta'>;
  deltaX?: number;
  deltaY?: number;
  timeout?: number;
};

export type SessionToSequenceOptions = {
  /** 是否在 type 前自动插入 clear 步骤（默认 true） */
  clearBeforeType?: boolean;
  /** 是否将 tab/navigated 转换为 wait_navigation 步骤（默认 true） */
  includeNavigation?: boolean;
  /** 是否将 mutation/appeared 转换为 wait 步骤（默认 false，因为 selector 不可靠） */
  includeMutations?: boolean;
  /** 是否启用智能优化：合并连续输入/滚动、去重点击（默认 true） */
  smartOptimize?: boolean;
};

// ─── 转换逻辑 ───

export function sessionToSequence(
  session: RecordedSession,
  options: SessionToSequenceOptions = {},
): SequenceStep[] {
  const {
    clearBeforeType = true,
    includeNavigation = true,
    includeMutations = false,
    smartOptimize = true,
  } = options;

  const steps: SequenceStep[] = [];

  for (const event of session.events) {
    switch (event.kind) {
      case 'interaction':
        pushInteractionSteps(steps, event, clearBeforeType);
        break;
      case 'tab':
        if (includeNavigation) {
          pushTabStep(steps, event);
        }
        break;
      case 'mutation':
        if (includeMutations) {
          pushMutationSteps(steps, event);
        }
        break;
    }
  }

  return smartOptimize ? optimizeSteps(steps) : steps;
}

// ─── 内部辅助 ───

function pushInteractionSteps(
  steps: SequenceStep[],
  event: InteractionEvent,
  clearBeforeType: boolean,
): void {
  switch (event.action) {
    case 'click':
      steps.push({ action: 'click', selector: event.target.selector || undefined });
      break;

    case 'input': {
      const selector = event.target.selector || undefined;
      // type 前先 clear，确保输入框内容正确
      if (clearBeforeType && selector) {
        steps.push({ action: 'clear', selector });
      }
      steps.push({ action: 'type', selector, text: event.value });
      break;
    }

    case 'change':
      steps.push({ action: 'select', selector: event.target.selector || undefined, text: event.value });
      break;

    case 'scroll':
      if (event.scroll) {
        steps.push({
          action: 'scroll',
          selector: event.target.selector || undefined,
          deltaX: event.scroll.deltaX,
          deltaY: event.scroll.deltaY,
        });
      }
      break;

    case 'keypress': {
      const selector = event.target.selector || undefined;
      const key = event.key;
      const modifiers = event.modifiers;
      // repeat: 展开为多次 keypress
      const count = event.repeat ?? 1;
      for (let i = 0; i < count; i++) {
        steps.push({ action: 'keypress', selector, key, modifiers });
      }
      break;
    }

    case 'submit':
      // submit 映射为 click 提交按钮
      steps.push({ action: 'click', selector: event.target.selector || undefined });
      break;
  }
}

function pushTabStep(steps: SequenceStep[], event: TabEvent): void {
  if (event.event === 'navigated') {
    steps.push({ action: 'wait_navigation' });
  }
  // 其他 tab 事件（focus_changed/reloaded/created/closed）跳过
}

function pushMutationSteps(steps: SequenceStep[], event: MutationEvent): void {
  for (const change of event.changes) {
    if (change.op === 'appeared') {
      // mutation 事件没有 selector，只有 tag/role/label
      // 使用 role + label 构建伪 selector（不保证可靠）
      const selector = buildMutationSelector(change);
      if (selector) {
        steps.push({ action: 'wait', selector, timeout: 5000 });
      }
    }
  }
}

function buildMutationSelector(change: {
  tag: string;
  role?: string;
  label?: string;
}): string | undefined {
  // 优先用 role，其次用 label，最后用 tag
  // 属性值中的双引号需要转义，避免生成无效 CSS 选择器
  if (change.role) {
    return `[role="${change.role.replace(/"/g, '\\"')}"]`;
  }
  if (change.label) {
    return `[aria-label="${change.label.replace(/"/g, '\\"')}"]`;
  }
  // 纯 tag 太宽泛（如 div、span），不生成 selector
  const genericTags = new Set(['div', 'span', 'p', 'section', 'article', 'main', 'header', 'footer', 'nav']);
  if (!genericTags.has(change.tag.toLowerCase())) {
    return change.tag.toLowerCase();
  }
  return undefined;
}

// ─── 智能优化 ───

/**
 * 对原始步骤进行智能优化：
 * 1. 合并同一元素的连续 type（input 事件每次发送完整值，只保留最终值）
 * 2. 合并同一元素的连续 scroll（累加 delta）
 * 3. 去除连续重复 click（同一 selector 连续点击视为误操作）
 * 4. 去除无后续 type 的孤立 clear
 */
function optimizeSteps(steps: SequenceStep[]): SequenceStep[] {
  // Pass 1: 合并同一 selector 的连续 clear+type 对
  // input 事件每次携带完整值，所以连续的 clear+type("a") + clear+type("ab")
  // 可以优化为 clear+type("ab")（只保留最后一组）。
  // 当遇到非当前 selector 的 clear+type 对或其他 action 时立即停止合并，
  // 防止跨越其他交互动作误合并。
  const merged: SequenceStep[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    // 检测 clear+type 对
    if (
      step.action === 'clear' &&
      i + 1 < steps.length &&
      steps[i + 1].action === 'type' &&
      step.selector === steps[i + 1].selector
    ) {
      const selector = step.selector;
      let lastTypeStep = steps[i + 1];
      let j = i + 2;
      // 线性扫描：跳过所有同 selector 的连续 clear+type 对
      while (
        j + 1 < steps.length &&
        steps[j].action === 'clear' &&
        steps[j + 1].action === 'type' &&
        steps[j].selector === selector &&
        steps[j + 1].selector === selector
      ) {
        lastTypeStep = steps[j + 1];
        j += 2;
      }
      // 只保留最后一组 clear+type
      merged.push({ action: 'clear', selector });
      merged.push({ ...lastTypeStep });
      i = j;
    } else {
      merged.push(step);
      i++;
    }
  }

  // Pass 2: 合并连续 scroll（同 selector，累加 delta）
  const scrollMerged = merged.reduce<SequenceStep[]>((acc, step) => {
    const prev = acc[acc.length - 1];
    if (prev && step.action === 'scroll' && prev.action === 'scroll' && prev.selector === step.selector) {
      prev.deltaX = (prev.deltaX ?? 0) + (step.deltaX ?? 0);
      prev.deltaY = (prev.deltaY ?? 0) + (step.deltaY ?? 0);
      return acc;
    }
    return [...acc, step];
  }, []);

  // Pass 3: 去除连续重复 click（同 selector）
  const deduped = scrollMerged.reduce<SequenceStep[]>((acc, step) => {
    const prev = acc[acc.length - 1];
    if (prev && step.action === 'click' && prev.action === 'click' && prev.selector === step.selector) {
      return acc;
    }
    return [...acc, step];
  }, []);

  // Pass 4: 去除无后续 type 的孤立 clear
  return deduped.filter((step, idx, arr) => {
    if (step.action === 'clear') {
      const next = arr[idx + 1];
      return next?.action === 'type' && next.selector === step.selector;
    }
    return true;
  });
}
