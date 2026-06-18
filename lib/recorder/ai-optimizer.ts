/**
 * 录制 AI 优化器 — 基于启发式规则分析录制步骤，生成优化建议。
 *
 * 目标：让技术小白也能创建高质量、可复用的工作流。
 * 策略：纯规则型，即时响应，零 API 成本。
 */

import type { SequenceStep } from './session-to-sequence';

// ─── 建议类型 ───

export type OptimizationType =
  | 'replace_date'
  | 'parametrize_input'
  | 'add_wait_after_action'
  | 'add_wait_after_navigation'
  | 'merge_repeated_clicks'
  | 'add_assert_after_extract';

export interface OptimizationSuggestion {
  id: string;
  type: OptimizationType;
  title: string;
  description: string;
  /** 影响的步骤索引 */
  stepIndices: number[];
  /** 应用优化后的新步骤列表 */
  apply: (steps: SequenceStep[]) => SequenceStep[];
}

// ─── 规则检测 ───

const DATE_PATTERN = /\b(20\d{2}[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01]))\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
const USERNAME_KEYWORDS = /username|user.?name|账号|用户名|登录名/i;
const PASSWORD_KEYWORDS = /password|密码|口令/i;
const DOWNLOAD_KEYWORDS = /下载|导出|download|export|save/i;
const SUBMIT_KEYWORDS = /提交|发送|submit|send|确认|确定|保存/i;

/** 生成唯一建议 ID */
function makeId(): string {
  return `opt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

/** 深拷贝步骤 */
function cloneSteps(steps: SequenceStep[]): SequenceStep[] {
  return steps.map((s) => ({ ...s }));
}

// ─── 具体优化规则 ───

/**
 * 规则 1：检测固定日期文本，建议替换为 {{today}}
 */
function detectDateReplacements(steps: SequenceStep[]): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.action === 'type' && step.text && DATE_PATTERN.test(step.text)) {
      suggestions.push({
        id: makeId(),
        type: 'replace_date',
        title: '替换固定日期为动态变量',
        description: `第 ${i + 1} 步输入了固定日期 "${step.text}"，建议替换为 {{today}}，让工作流每天运行时自动使用当天日期。`,
        stepIndices: [i],
        apply: (baseSteps) => {
          const next = cloneSteps(baseSteps);
          const target = next[i];
          if (target.action === 'type') {
            target.text = target.text!.replace(DATE_PATTERN, '{{today}}');
          }
          return next;
        },
      });
    }
  }
  return suggestions;
}

/**
 * 规则 2：检测疑似用户名/密码/邮箱输入，建议参数化
 */
function detectParametrizeInputs(steps: SequenceStep[]): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.action !== 'type' || !step.text) continue;

    const text = step.text;
    const selector = step.selector || '';

    // 检测邮箱
    if (EMAIL_PATTERN.test(text)) {
      suggestions.push({
        id: makeId(),
        type: 'parametrize_input',
        title: '将邮箱提取为参数',
        description: `第 ${i + 1} 步输入了邮箱地址，建议提取为 {{email}} 参数，运行时由用户填写。`,
        stepIndices: [i],
        apply: (baseSteps) => {
          const next = cloneSteps(baseSteps);
          const target = next[i];
          if (target.action === 'type') {
            target.text = '{{email}}';
          }
          return next;
        },
      });
      continue;
    }

    // 检测用户名输入框
    if (USERNAME_KEYWORDS.test(selector) && text.length >= 3 && text.length <= 32) {
      suggestions.push({
        id: makeId(),
        type: 'parametrize_input',
        title: '将用户名提取为参数',
        description: `第 ${i + 1} 步输入了用户名 "${text.slice(0, 20)}"，建议提取为 {{username}} 参数。`,
        stepIndices: [i],
        apply: (baseSteps) => {
          const next = cloneSteps(baseSteps);
          const target = next[i];
          if (target.action === 'type') {
            target.text = '{{username}}';
          }
          return next;
        },
      });
      continue;
    }

    // 检测密码输入框
    if (PASSWORD_KEYWORDS.test(selector) && text.length >= 4) {
      suggestions.push({
        id: makeId(),
        type: 'parametrize_input',
        title: '将密码提取为参数',
        description: `第 ${i + 1} 步输入了密码，建议提取为 {{password}} 参数，避免硬编码敏感信息。`,
        stepIndices: [i],
        apply: (baseSteps) => {
          const next = cloneSteps(baseSteps);
          const target = next[i];
          if (target.action === 'type') {
            target.text = '{{password}}';
          }
          return next;
        },
      });
      continue;
    }
  }
  return suggestions;
}

/**
 * 规则 3：检测下载/导出/提交操作后缺少等待，建议添加 wait
 */
function detectMissingWaits(steps: SequenceStep[]): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const nextStep = steps[i + 1];

    if (step.action !== 'click' || !step.selector) continue;

    const selector = step.selector;
    const isDownloadAction = DOWNLOAD_KEYWORDS.test(selector);
    const isSubmitAction = SUBMIT_KEYWORDS.test(selector);

    if ((isDownloadAction || isSubmitAction) && nextStep.action !== 'wait' && nextStep.action !== 'wait_navigation') {
      suggestions.push({
        id: makeId(),
        type: 'add_wait_after_action',
        title: `在"${isDownloadAction ? '下载' : '提交'}"后添加等待`,
        description: `第 ${i + 1} 步点击了"${isDownloadAction ? '下载/导出' : '提交/保存'}"按钮，建议在其后增加 3 秒等待，确保操作完成。`,
        stepIndices: [i, i + 1],
        apply: (baseSteps) => {
          const next = cloneSteps(baseSteps);
          next.splice(i + 1, 0, {
            action: 'wait',
            timeout: 3000,
            selector: undefined,
            deltaX: undefined,
            deltaY: undefined,
            key: undefined,
            modifiers: undefined,
            text: undefined,
          } as SequenceStep);
          return next;
        },
      });
    }
  }
  return suggestions;
}

/**
 * 规则 4：检测导航操作后缺少 wait_navigation
 */
function detectMissingWaitNavigation(steps: SequenceStep[]): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const nextStep = steps[i + 1];

    if (step.action === 'click' && nextStep.action !== 'wait_navigation' && nextStep.action !== 'wait') {
      // 启发式：链接点击（a 标签）大概率导致导航
      if (step.selector && /a\[|link|href|导航/.test(step.selector)) {
        suggestions.push({
          id: makeId(),
          type: 'add_wait_after_navigation',
          title: '在链接点击后添加页面加载等待',
          description: `第 ${i + 1} 步点击了链接，建议在其后增加 wait_navigation，确保新页面加载完成后再执行后续操作。`,
          stepIndices: [i, i + 1],
          apply: (baseSteps) => {
            const next = cloneSteps(baseSteps);
            next.splice(i + 1, 0, {
              action: 'wait_navigation',
              timeout: 5000,
              selector: undefined,
              deltaX: undefined,
              deltaY: undefined,
              key: undefined,
              modifiers: undefined,
              text: undefined,
            } as SequenceStep);
            return next;
          },
        });
      }
    }
  }
  return suggestions;
}

/**
 * 规则 5：检测连续重复点击，建议合并或参数化
 */
function detectRepeatedClicks(steps: SequenceStep[]): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  let i = 0;
  while (i < steps.length) {
    if (steps[i].action !== 'click') {
      i++;
      continue;
    }
    const selector = steps[i].selector;
    if (!selector) {
      i++;
      continue;
    }

    // 查找连续相同 selector 的点击
    let count = 1;
    let j = i + 1;
    while (j < steps.length && steps[j].action === 'click' && steps[j].selector === selector) {
      count++;
      j++;
    }

    if (count >= 3) {
      const startIdx = i;
      const endIdx = j;
      suggestions.push({
        id: makeId(),
        type: 'merge_repeated_clicks',
        title: `合并 ${count} 次重复点击`,
        description: `第 ${startIdx + 1} 到 ${endIdx} 步连续点击了相同元素，建议在工作流编辑器中将其改为循环执行，提升可维护性。`,
        stepIndices: Array.from({ length: endIdx - startIdx }, (_, k) => startIdx + k),
        apply: (baseSteps) => {
          // 规则型优化不做结构性大改，仅保留第一个并添加 wait 提示
          const next = cloneSteps(baseSteps);
          const kept = next[startIdx];
          const replacement: SequenceStep[] = [
            kept,
            {
              action: 'wait',
              timeout: 1000,
              selector: undefined,
              deltaX: undefined,
              deltaY: undefined,
              key: undefined,
              modifiers: undefined,
              text: undefined,
            } as SequenceStep,
          ];
          next.splice(startIdx, endIdx - startIdx, ...replacement);
          return next;
        },
      });
      i = endIdx;
    } else {
      i++;
    }
  }
  return suggestions;
}

// ─── 入口 ───

/**
 * 分析录制步骤，生成所有可用的优化建议。
 */
export function analyzeOptimizations(steps: SequenceStep[]): OptimizationSuggestion[] {
  const all: OptimizationSuggestion[] = [];
  all.push(...detectDateReplacements(steps));
  all.push(...detectParametrizeInputs(steps));
  all.push(...detectMissingWaits(steps));
  all.push(...detectMissingWaitNavigation(steps));
  all.push(...detectRepeatedClicks(steps));
  return all;
}
