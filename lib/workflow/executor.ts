/**
 * Workflow Executor — 顺序执行 Workflow 步骤的最小可用实现。
 *
 * 复用 interact.ts 的 performInteraction 在页面中执行原子操作，
 * wait_navigation 则直接调用 tab-helpers 中的 waitForNavigation。
 *
 * 支持条件分支（if/else）和断言（assert）步骤的嵌套执行。
 */

import { performInteraction } from '@/lib/tools/interact';
import { visualLocate, type VlmModelConfig } from '@/lib/tools/visual-locate';
import { executeInTabWithArgs, waitForNavigation } from '@/lib/tab-helpers';
import { buildExportData, formatExportData, interpolateExportFilename, dataUrlFromText } from './export-utils';
import { customProviders, providerCredentials } from '@/lib/storage';
import type { Workflow, WorkflowStep, IfStep, WorkflowCondition } from './types';

// ─── 类型 ───

export interface StepResult {
  step: WorkflowStep;
  index: number;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  /** 该步骤执行结束时的变量快照 */
  variables?: Record<string, string>;
}

export interface ExecutionResult {
  success: boolean;
  stepResults: StepResult[];
  error?: string;
  /** 执行结束时的所有变量（含内置变量和用户自定义变量） */
  variables?: Record<string, string>;
}

export interface ExecutorOptions {
  /** 目标标签页 ID，缺省时取当前 active tab */
  tabId?: number;
  /** 每步开始回调 */
  onStepStart?: (step: WorkflowStep, index: number) => void;
  /** 每步结束回调 */
  onStepEnd?: (step: WorkflowStep, index: number, result: StepResult) => void;
  /** 中断信号 */
  signal?: AbortSignal;
  /** 运行时变量，覆盖 workflow.variables */
  variables?: Record<string, string>;
  /** 从指定步骤索引开始执行（用于断点续跑） */
  startStepIndex?: number;
}

// ─── 执行入口 ───

/**
 * 顺序执行 Workflow 的所有步骤。
 *
 * 执行策略：
 * - 遇到失败的步骤立即中断（fail-fast），返回已执行步骤的结果
 * - 每步执行前检查 signal，支持外部取消
 * - 所有结果按步骤顺序收集
 * - 条件分支（if）步骤作为原子单位：内部子步骤不单独触发 onStepStart/onStepEnd，
 *   但会整体成功或失败，保持持久化层（currentStepIndex）语义简单
 */
export async function executeWorkflow(
  workflow: Workflow,
  options: ExecutorOptions = {},
): Promise<ExecutionResult> {
  const tabId = options.tabId ?? (await getActiveTabId());
  const stepResults: StepResult[] = [];

  // 合并变量：workflow.variables < options.variables < 内置变量
  const vars = buildVariables(workflow.variables, options.variables);
  const startIndex = Math.max(0, options.startStepIndex ?? 0);

  for (let i = startIndex; i < workflow.steps.length; i++) {
    options.signal?.throwIfAborted();
    const step = interpolateStep(workflow.steps[i], vars);
    options.onStepStart?.(step, i);

    const startTime = Date.now();
    try {
      const output = await executeStep(step, tabId, vars, options.signal);
      const result: StepResult = {
        step,
        index: i,
        success: true,
        output,
        durationMs: Date.now() - startTime,
        variables: { ...vars },
      };
      stepResults.push(result);
      options.onStepEnd?.(step, i, result);
    } catch (err) {
      const result: StepResult = {
        step,
        index: i,
        success: false,
        error: (err as Error).message,
        durationMs: Date.now() - startTime,
        variables: { ...vars },
      };
      stepResults.push(result);
      options.onStepEnd?.(step, i, result);
      return {
        success: false,
        stepResults,
        error: `Step ${i + 1} failed: ${(err as Error).message}`,
        variables: vars,
      };
    }
  }

  return { success: true, stepResults, variables: vars };
}

// ─── 单步执行 ───

/** 需要重试的步骤类型（动态页面元素可能延迟加载） */
const RETRYABLE_STEP_TYPES = new Set([
  'click', 'type', 'select', 'focus', 'hover', 'dblclick', 'rightclick', 'extract',
]);

/** 步骤重试配置（指数退避） */
const STEP_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
};

async function executeStep(
  step: WorkflowStep,
  tabId: number,
  vars: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();

  // 对易失性 DOM 操作启用自动重试
  if (RETRYABLE_STEP_TYPES.has(step.type)) {
    return await executeStepWithRetry(step, tabId, vars, signal);
  }

  switch (step.type) {
    case 'navigate': {
      await chrome.tabs.update(tabId, { url: step.url });
      return `Navigated to ${step.url}`;
    }

    case 'wait_navigation': {
      const result = await waitForNavigation(tabId, step.timeout ?? 3000);
      return result;
    }

    case 'scroll':
    case 'keypress':
    case 'wait': {
      const params = buildInteractParams(step);
      const result = await executeInTabWithArgs(
        tabId,
        performInteraction,
        [params],
      );
      if (result === undefined) {
        throw new Error('in-page execution returned no result (likely an uncaught exception)');
      }
      if (typeof result === 'string' && result.startsWith('Error:')) {
        throw new Error(result.slice('Error:'.length).trim());
      }
      return result as string;
    }

    case 'assert': {
      return await executeAssertStep(step, tabId, vars, signal);
    }

    case 'if': {
      return await executeIfStep(step, tabId, vars, signal);
    }

    case 'export': {
      return await executeExportStep(step, vars);
    }

    case 'visual_locate': {
      return await executeVisualLocateStep(step, tabId, vars);
    }

    case 'visual_click': {
      return await executeVisualClickStep(step, tabId, vars);
    }

    case 'visual_type': {
      return await executeVisualTypeStep(step, tabId, vars);
    }

    default: {
      throw new Error(`Unsupported step type: ${step.type}`);
    }
  }
}

/** 带重试的单步执行 */
async function executeStepWithRetry(
  step: WorkflowStep,
  tabId: number,
  vars: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  let lastError = '';
  for (let attempt = 0; attempt <= STEP_RETRY_CONFIG.maxRetries; attempt++) {
    signal?.throwIfAborted();
    try {
      if (step.type === 'extract') {
        const result = await executeInTabWithArgs(
          tabId,
          performExtract,
          [step.selector, step.attribute ?? 'textContent'],
        );
        if (result === null) {
          throw new Error(`Element not found: ${step.selector}`);
        }
        // 将提取结果写入运行时变量表，供后续步骤和断点续跑使用
        if (step.toVariable) {
          vars[step.toVariable] = String(result);
        }
        return `Extracted ${step.attribute ?? 'textContent'} from ${step.selector}: ${String(result).slice(0, 200)}`;
      }

      const params = buildInteractParams(step);
      const result = await executeInTabWithArgs(
        tabId,
        performInteraction,
        [params],
      );
      if (result === undefined) {
        throw new Error('in-page execution returned no result (likely an uncaught exception)');
      }
      if (typeof result === 'string' && result.startsWith('Error:')) {
        throw new Error(result.slice('Error:'.length).trim());
      }
      return result as string;
    } catch (err) {
      lastError = (err as Error).message;
      const isRetryable = isRetryableError(lastError);
      if (!isRetryable || attempt === STEP_RETRY_CONFIG.maxRetries) {
        throw err;
      }
      const delay = Math.min(
        STEP_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
        STEP_RETRY_CONFIG.maxDelayMs,
      );
      console.warn(
        `[Workflow] Step "${step.type}" failed (attempt ${attempt + 1}/${STEP_RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms: ${lastError}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(lastError);
}

/** 判断错误是否适合重试 */
function isRetryableError(errorMessage: string): boolean {
  const retryablePatterns = [
    /element not found/i,
    /no element matches/i,
    /timed out waiting/i,
    /unable to find/i,
    /cannot find/i,
    /not visible/i,
    /detached from dom/i,
    /element could not be scrolled into view/i,
  ];
  return retryablePatterns.some((p) => p.test(errorMessage));
}

// ─── 断言执行 ───

async function executeAssertStep(
  step: Extract<WorkflowStep, { type: 'assert' }>,
  tabId: number,
  vars: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = step.timeout ?? 5000;
  const start = Date.now();
  let lastError = '';

  while (Date.now() - start < timeout) {
    signal?.throwIfAborted();

    let actualValue: string | null = null;
    let targetDesc: string;

    if (step.selector) {
      const query = await executeInTabWithArgs(
        tabId,
        performAssertQuery,
        [step.selector],
      ) as { exists: boolean; text: string | null } | undefined;
      targetDesc = step.selector;
      if (query) {
        if (step.operator === 'exists') {
          if (query.exists) return `Assert passed: ${targetDesc} exists`;
        } else if (step.operator === 'not_exists') {
          if (!query.exists) return `Assert passed: ${targetDesc} not exists`;
        } else if (query.exists) {
          actualValue = query.text;
        }
      }
    } else if (step.variable) {
      targetDesc = `\${${step.variable}}`;
      actualValue = vars[step.variable] ?? null;
    } else {
      throw new Error('Assert step requires either selector or variable');
    }

    if (evaluateAssert(step.operator, actualValue, step.value)) {
      return `Assert passed: ${targetDesc} ${step.operator}${step.value !== undefined ? ` ${step.value}` : ''}`;
    }

    lastError = `Expected ${step.operator}${step.value !== undefined ? ` ${step.value}` : ''}, got ${actualValue ?? 'null'}`;

    // 等待后重试（最短间隔 200ms）
    const elapsed = Date.now() - start;
    if (elapsed < timeout) {
      await new Promise((r) => setTimeout(r, Math.min(200, timeout - elapsed)));
    }
  }

  throw new Error(`Assert failed after ${timeout}ms: ${lastError}`);
}

function evaluateAssert(
  operator: string,
  actual: string | null,
  expected: unknown,
): boolean {
  switch (operator) {
    case 'exists':
      return actual !== null;
    case 'not_exists':
      return actual === null;
    case 'contains':
      return actual !== null && actual.includes(String(expected));
    case 'eq':
      return actual === String(expected);
    case 'gt':
      return actual !== null && parseFloat(actual) > Number(expected);
    case 'lt':
      return actual !== null && parseFloat(actual) < Number(expected);
    default:
      return false;
  }
}

function performAssertQuery(selector: string): { exists: boolean; text: string | null } {
  try {
    const el = document.querySelector(selector);
    if (!el) return { exists: false, text: null };
    return { exists: true, text: el.textContent ?? '' };
  } catch {
    return { exists: false, text: null };
  }
}

// ─── 条件分支执行 ───

async function executeIfStep(
  step: IfStep,
  tabId: number,
  vars: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  const conditionMet = evaluateCondition(step.condition, vars);
  const branch = conditionMet ? step.thenSteps : (step.elseSteps ?? []);
  const branchName = conditionMet ? 'then' : 'else';

  for (let i = 0; i < branch.length; i++) {
    signal?.throwIfAborted();
    const subStep = interpolateStep(branch[i], vars);
    await executeStep(subStep, tabId, vars, signal);
  }

  return `If condition ${conditionMet ? 'met' : 'not met'}, executed ${branch.length} ${branchName} steps`;
}

function evaluateCondition(
  condition: WorkflowCondition,
  vars: Record<string, string>,
): boolean {
  const actual = vars[condition.variable] ?? '';
  const expected = String(condition.value);

  switch (condition.operator) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'contains':
      return actual.includes(expected);
    case 'gt':
      return parseFloat(actual) > Number(condition.value);
    case 'lt':
      return parseFloat(actual) < Number(condition.value);
    default:
      return false;
  }
}

// ─── 导出执行 ───

async function executeExportStep(
  step: Extract<WorkflowStep, { type: 'export' }>,
  vars: Record<string, string>,
): Promise<string> {
  const data = buildExportData(vars, step.variables);

  if (Object.keys(data).length === 0) {
    return 'Export skipped: no variables to export';
  }

  const filename = interpolateExportFilename(step.filename ?? `export.${step.destination}`, vars);
  const text = formatExportData(data, step.destination);

  switch (step.destination) {
    case 'clipboard': {
      await writeToClipboardOrDownload(text, filename.replace(/\.\w+$/, '.txt'));
      return `Exported ${Object.keys(data).length} variables to clipboard`;
    }

    case 'csv': {
      await downloadDataUrl(dataUrlFromText(text, 'text/csv;charset=utf-8;'), filename);
      return `Exported ${Object.keys(data).length} variables to ${filename}`;
    }

    case 'json': {
      await downloadDataUrl(dataUrlFromText(text, 'application/json'), filename);
      return `Exported ${Object.keys(data).length} variables to ${filename}`;
    }

    default:
      throw new Error(`Unknown export destination: ${step.destination}`);
  }
}

/**
 * 跨上下文安全下载。
 * - 优先使用 chrome.downloads（Service Worker / background 可用）
 * - 回退到 DOM 锚点点击（sidepanel / 前端上下文）
 */
async function downloadDataUrl(dataUrl: string, filename: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
    return;
  }

  // 前端上下文回退
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 写入剪贴板，在 Service Worker 中自动降级为下载 .txt 文件。
 */
async function writeToClipboardOrDownload(text: string, fallbackFilename: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 剪贴板权限被拒绝，降级为下载
    }
  }

  // Service Worker 或无剪贴板权限时，下载为文本文件
  await downloadDataUrl(dataUrlFromText(text, 'text/plain'), fallbackFilename);
}

// ─── 参数映射 ───

function buildInteractParams(step: WorkflowStep): Parameters<typeof performInteraction>[0] {
  switch (step.type) {
    case 'click':
      return { action: 'click', selector: step.selector, timeout: step.timeout };
    case 'type':
      return { action: 'type', selector: step.selector, text: step.text, timeout: step.timeout };
    case 'select':
      return { action: 'select', selector: step.selector, text: step.text, timeout: step.timeout };
    case 'scroll':
      return { action: 'scroll', selector: step.selector, deltaX: step.deltaX, deltaY: step.deltaY };
    case 'keypress':
      return { action: 'keypress', selector: step.selector, key: step.key, modifiers: step.modifiers };
    case 'wait':
      return { action: 'wait', selector: step.selector, timeout: step.timeout };
    case 'focus':
      return { action: 'focus', selector: step.selector };
    case 'hover':
      return { action: 'hover', selector: step.selector };
    case 'dblclick':
      return { action: 'dblclick', selector: step.selector };
    case 'rightclick':
      return { action: 'rightclick', selector: step.selector };
    default:
      throw new Error(`Cannot map step type to interact params: ${step.type}`);
  }
}

// ─── 视觉定位执行 ───

async function executeVisualLocateStep(
  step: Extract<WorkflowStep, { type: 'visual_locate' }>,
  tabId: number,
  vars: Record<string, string>,
): Promise<string> {
  const model = await resolveVlmModel();
  if (!model) {
    throw new Error('No VLM model configured. Add a custom model with image input support (image: true) in settings.');
  }

  const description = step.description.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  const result = await visualLocate({ description, tabId, model, quality: step.quality });

  if (!result.success || result.x == null || result.y == null) {
    throw new Error(`Visual localization failed: ${result.error ?? 'unknown error'}`);
  }

  vars[step.toVariable + '_x'] = String(result.x);
  vars[step.toVariable + '_y'] = String(result.y);
  vars[step.toVariable + '_confidence'] = String(result.confidence ?? '');
  vars[step.toVariable] = JSON.stringify({ x: result.x, y: result.y, confidence: result.confidence });
  return `Visual located "${description}" at (${result.x}, ${result.y}) confidence=${result.confidence ?? 'N/A'}`;
}

/** 视觉点击执行 */
async function executeVisualClickStep(
  step: Extract<WorkflowStep, { type: 'visual_click' }>,
  tabId: number,
  vars: Record<string, string>,
): Promise<string> {
  const model = await resolveVlmModel();
  if (!model) {
    throw new Error('No VLM model configured. Add a custom model with image input support (image: true) in settings.');
  }

  const description = step.description.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  const result = await visualLocate({ description, tabId, model, quality: step.quality });

  if (!result.success || result.x == null || result.y == null) {
    throw new Error(`Visual localization failed: ${result.error ?? 'unknown error'}`);
  }

  const params = { action: 'click' as const, x: result.x, y: result.y, tabId };
  const interactResult = await executeInTabWithArgs(tabId, performInteraction, [params]);
  if (interactResult === undefined) {
    throw new Error('in-page execution returned no result');
  }
  if (typeof interactResult === 'string' && interactResult.startsWith('Error:')) {
    throw new Error(interactResult.slice('Error:'.length).trim());
  }
  return `Visual clicked "${description}" at (${result.x}, ${result.y})`;
}

/** 视觉输入执行 */
async function executeVisualTypeStep(
  step: Extract<WorkflowStep, { type: 'visual_type' }>,
  tabId: number,
  vars: Record<string, string>,
): Promise<string> {
  const model = await resolveVlmModel();
  if (!model) {
    throw new Error('No VLM model configured. Add a custom model with image input support (image: true) in settings.');
  }

  const description = step.description.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  const text = step.text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  const result = await visualLocate({ description, tabId, model, quality: step.quality });

  if (!result.success || result.x == null || result.y == null) {
    throw new Error(`Visual localization failed: ${result.error ?? 'unknown error'}`);
  }

  const params = {
    action: 'type' as const,
    x: result.x,
    y: result.y,
    text,
    tabId,
  };
  const interactResult = await executeInTabWithArgs(tabId, performInteraction, [params]);
  if (interactResult === undefined) {
    throw new Error('in-page execution returned no result');
  }
  if (typeof interactResult === 'string' && interactResult.startsWith('Error:')) {
    throw new Error(interactResult.slice('Error:'.length).trim());
  }
  return `Visual typed "${text}" into "${description}" at (${result.x}, ${result.y})`;
}

/** 从用户配置中解析 VLM 模型（优先找 image=true 的自定义模型） */
async function resolveVlmModel(): Promise<VlmModelConfig | null> {
  try {
    const cps = await customProviders.getValue() ?? [];
      for (const cp of cps) {
        for (const m of cp.models) {
          if (m.image) {
            const credentials = await providerCredentials.getValue() ?? {};
            const cred = credentials[cp.id];
          if (cred?.authType === 'apiKey') {
            return {
              baseUrl: cp.baseUrl,
              apiKey: cred.apiKey,
              modelId: m.modelId,
              maxTokens: m.maxTokens ?? 512,
            };
          }
        }
      }
    }
  } catch { /* swallow */ }
  return null;
}

// ─── 页面内执行函数（必须在文件底部定义，不依赖外部作用域）───

function performExtract(selector: string, attribute: string): string | null {
  try {
    const el = document.querySelector(selector);
    if (!el) return null;
    if (attribute === 'textContent') return el.textContent ?? '';
    if (attribute === 'innerHTML') return (el as HTMLElement).innerHTML ?? '';
    return el.getAttribute(attribute) ?? '';
  } catch {
    return null;
  }
}

// ─── 变量插值 ───

function buildVariables(
  workflowVars?: Record<string, string>,
  runtimeVars?: Record<string, string>,
): Record<string, string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    today: `${yyyy}-${mm}-${dd}`,
    timestamp: String(Date.now()),
    date: `${yyyy}-${mm}-${dd}`,
    year: String(yyyy),
    month: mm,
    day: dd,
    ...workflowVars,
    ...runtimeVars,
  };
}

function interpolateStep(step: WorkflowStep, vars: Record<string, string>): WorkflowStep {
  const replace = (str: string): string =>
    str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

  // 递归处理子步骤（用于 if 步骤）
  const interpolateSteps = (steps: WorkflowStep[]): WorkflowStep[] =>
    steps.map((st) => interpolateStep(st, vars));

  switch (step.type) {
    case 'navigate':
      return { ...step, url: replace(step.url) };
    case 'click':
    case 'focus':
    case 'hover':
    case 'dblclick':
    case 'rightclick':
      return { ...step, selector: replace(step.selector) };
    case 'type':
      return { ...step, selector: replace(step.selector), text: replace(step.text) };
    case 'select':
      return { ...step, selector: replace(step.selector), text: replace(step.text) };
    case 'scroll':
      return step.selector ? { ...step, selector: replace(step.selector) } : { ...step };
    case 'keypress':
      return {
        ...step,
        selector: step.selector ? replace(step.selector) : step.selector,
        key: replace(step.key),
      };
    case 'wait':
      return step.selector ? { ...step, selector: replace(step.selector) } : { ...step };
    case 'extract':
      return {
        ...step,
        selector: replace(step.selector),
        toVariable: replace(step.toVariable),
        attribute: step.attribute ? replace(step.attribute) : step.attribute,
      };
    case 'assert':
      return {
        ...step,
        selector: step.selector ? replace(step.selector) : step.selector,
        variable: step.variable ? replace(step.variable) : step.variable,
        value: step.value !== undefined && typeof step.value === 'string' ? replace(step.value) : step.value,
      };
    case 'visual_locate':
      return { ...step, description: replace(step.description), toVariable: replace(step.toVariable) };
    case 'visual_click':
      return { ...step, description: replace(step.description) };
    case 'visual_type':
      return { ...step, description: replace(step.description), text: replace(step.text) };
    case 'if':
      return {
        ...step,
        condition: {
          ...step.condition,
          variable: replace(step.condition.variable),
          value: typeof step.condition.value === 'string' ? replace(step.condition.value) : step.condition.value,
        },
        thenSteps: interpolateSteps(step.thenSteps),
        elseSteps: step.elseSteps ? interpolateSteps(step.elseSteps) : step.elseSteps,
      };
    case 'export':
      return step.filename ? { ...step, filename: replace(step.filename) } : { ...step };
    case 'wait_navigation':
      return { ...step };
  }
}

// ─── 辅助 ───

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');
  return tab.id;
}
