/**
 * AI Planner — 自然语言生成 Workflow。
 *
 * 调用 LLM 将用户目标拆解为浏览器操作步骤，生成可执行的 Workflow JSON。
 */

import { completeSimple, getModels, type KnownProvider } from '@earendil-works/pi-ai';
import type { Model, Api, Context } from '@earendil-works/pi-ai';
import type { Workflow, WorkflowStep, AssertStep, KeypressStep, ExportStep, WorkflowConditionOperator } from './types';
import { executeInTab } from '@/lib/tab-helpers';
import { resolveSelectedWebModel } from '@/lib/ai-config/web-provider-models';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import { isCustomProvider, findCustomModel } from '@/lib/custom-models';
import type { ActiveModel, ProviderCredentials, CustomProviderConfig } from '@/lib/storage';

// ─── 页面上下文 ───

export interface PageContext {
  title: string;
  url: string;
  elements: PageElement[];
}

export interface PageElement {
  tag: string;
  selector: string;
  text?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * 在指定标签页注入脚本，收集可交互元素信息。
 */
export async function getPageContext(tabId: number): Promise<PageContext> {
  const result = await executeInTab<{
    title: string;
    url: string;
    elements: PageElement[];
  }>(tabId, () => {
    const title = document.title;
    const url = window.location.href;

    const elements: PageElement[] = [];
    const seen = new Set<string>();

    const add = (el: HTMLElement, selector: string) => {
      if (seen.has(selector)) return;
      seen.add(selector);
      const text = (el.textContent ?? '').trim().slice(0, 80) || undefined;
      const type = (el as HTMLInputElement).type || undefined;
      const placeholder = (el as HTMLInputElement).placeholder || undefined;
      const ariaLabel = el.getAttribute('aria-label') || undefined;
      elements.push({
        tag: el.tagName.toLowerCase(),
        selector,
        ...(text ? { text } : {}),
        ...(type ? { type } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(ariaLabel ? { ariaLabel } : {}),
      });
    };

    // 优先收集带 id 的元素
    document.querySelectorAll('button, a, input, textarea, select').forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (el.id) {
        add(htmlEl, `#${el.id}`);
        return;
      }
      // 有 name 属性的表单元素
      if ((el as HTMLInputElement).name) {
        add(htmlEl, `${el.tagName.toLowerCase()}[name="${(el as HTMLInputElement).name}"]`);
        return;
      }
      // aria-label
      const aria = el.getAttribute('aria-label');
      if (aria) {
        add(htmlEl, `${el.tagName.toLowerCase()}[aria-label="${aria}"]`);
        return;
      }
      // placeholder
      const ph = (el as HTMLInputElement).placeholder;
      if (ph) {
        add(htmlEl, `${el.tagName.toLowerCase()}[placeholder="${ph}"]`);
        return;
      }
      // 链接文本
      if (el.tagName === 'A' && el.textContent) {
        const txt = el.textContent.trim();
        if (txt) {
          add(htmlEl, `a:contains("${txt.slice(0, 40)}")`);
          return;
        }
      }
      // 按钮文本
      if (el.tagName === 'BUTTON' && el.textContent) {
        const txt = el.textContent.trim();
        if (txt) {
          add(htmlEl, `button:contains("${txt.slice(0, 40)}")`);
          return;
        }
      }
    });

    // 限制数量，避免 prompt 过长
    return { title, url, elements: elements.slice(0, 30) };
  });

  return result;
}

// ─── Prompt 构建 ───

function buildPlannerPrompt(goal: string, ctx: PageContext): string {
  const elementList = ctx.elements
    .map((e) => {
      let line = `- ${e.selector} (${e.tag}`;
      if (e.text) line += `, text: "${e.text}"`;
      if (e.type) line += `, type: ${e.type}`;
      if (e.placeholder) line += `, placeholder: "${e.placeholder}"`;
      if (e.ariaLabel) line += `, aria-label: "${e.ariaLabel}"`;
      line += ')';
      return line;
    })
    .join('\n');

  return `你是一个浏览器自动化专家。请将用户的目标拆解为精确的浏览器操作步骤。

## 用户目标
${goal}

## 当前页面
标题：${ctx.title}
URL：${ctx.url}

## 可交互元素（优先使用这些 selector）
${elementList || '（暂无提取到可交互元素）'}

## 可用步骤类型
- navigate: 打开指定URL，参数：url
- click: 点击元素，参数：selector
- type: 输入文本，参数：selector, text, clear(默认true)
- select: 下拉选择，参数：selector, text
- scroll: 滚动页面或元素，参数：selector(可选), deltaX, deltaY
- keypress: 按键，参数：key, selector(可选)
- wait: 等待元素出现或固定时长，参数：selector(可选), timeout(毫秒)
- wait_navigation: 等待页面导航完成，参数：timeout(可选)
- extract: 提取数据到变量，参数：selector, toVariable, attribute(可选，默认textContent)
- focus: 聚焦元素，参数：selector
- hover: 悬停元素，参数：selector
- dblclick: 双击元素，参数：selector
- rightclick: 右键点击元素，参数：selector
- assert: 断言验证，参数：selector 或 variable, operator(exists|not_exists|contains|eq|gt|lt), value(可选), timeout(默认5000)
- if: 条件分支，参数：condition{variable, operator(eq|ne|contains|gt|lt), value}, thenSteps[], elseSteps(可选)
- export: 数据导出，参数：destination(clipboard|csv|json), variables(可选，变量名数组), filename(可选，支持{{variable}}插值)

## 约束
1. selector 优先使用 id、name、aria-label，避免动态 class。
2. 如果操作表单，先聚焦/点击输入框，再 type，需要提交时按 Enter。
3. 操作后如果需要等待页面加载，添加 wait_navigation。
4. 如果目标是提取数据，使用 extract 步骤并将结果存入变量。
5. 需要验证页面状态时（如确认提交成功），使用 assert 步骤检查元素存在或文本包含。
6. 需要根据条件执行不同操作时，使用 if 步骤，condition 引用之前 extract 的变量名。
7. 支持变量插值：text 或 url 中可使用 {{variableName}} 引用之前 extract 的变量。
8. 如果工作流需要保存抓取结果，在最后一步添加 export 步骤，将 extract 的变量导出到 clipboard 或 csv。
9. 每步必须是一个有效的 JSON 对象，包含 type 和所需参数。
10. 不要输出任何解释，只输出步骤数组的 JSON。
11. 如果目标在当前页面无法完成，输出一个包含 navigate 到合适页面的步骤。

## 输出格式
只输出 JSON 数组，不要 markdown 代码块，不要额外说明：
[
  { "type": "click", "selector": "#search-button" },
  { "type": "wait", "timeout": 1000 }
]`;
}

// ─── LLM 调用 ───

export interface PlannerOptions {
  /** 目标标签页 ID，缺省时取当前 active tab */
  tabId?: number;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 使用 LLM 根据自然语言目标生成 Workflow。
 *
 * @param model  pi-ai Model 对象（来自 ModelSelector 或用户配置）
 * @param goal   用户描述的目标
 * @param options 可选配置
 * @returns 生成的 Workflow（未持久化，无 id）或 null
 */
export async function generateWorkflow(
  model: Model<Api>,
  goal: string,
  options: PlannerOptions = {},
): Promise<Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'runCount'> | null> {
  const tabId = options.tabId ?? (await getActiveTabId());

  // 1. 收集页面上下文
  let ctx: PageContext;
  try {
    ctx = await getPageContext(tabId);
  } catch (err) {
    console.warn('[AIPlanner] Failed to get page context, proceeding without it:', err);
    ctx = { title: '', url: '', elements: [] };
  }

  // 2. 构建 Prompt
  const prompt = buildPlannerPrompt(goal, ctx);

  // 3. 调用 LLM
  const context: Context = {
    messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
  };

  const result = await completeSimple(model, context, {
    signal: options.signal,
    maxTokens: 4096,
    temperature: 0.2,
  });

  // 4. 解析结果
  const textContent = result.content.find((c) => c.type === 'text')?.text ?? '';
  if (!textContent) {
    console.error('[AIPlanner] LLM returned no text content');
    return null;
  }

  // 尝试从 markdown 代码块中提取 JSON
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : textContent.trim();

  let steps: WorkflowStep[];
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      console.error('[AIPlanner] LLM returned non-array JSON');
      return null;
    }
    steps = parsed.map((s: unknown) => sanitizeStep(s)).filter(Boolean) as WorkflowStep[];
  } catch (err) {
    console.error('[AIPlanner] Failed to parse LLM output as JSON:', err, '\nRaw:', textContent);
    return null;
  }

  if (steps.length === 0) {
    console.error('[AIPlanner] No valid steps generated');
    return null;
  }

  return {
    name: goal.slice(0, 60),
    description: `AI 生成：${goal}`,
    steps,
    trigger: { type: 'manual' },
    variables: {},
  };
}

// ─── 步骤清洗 ───

function sanitizeStep(raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== 'string') return null;

  const type = r.type as WorkflowStep['type'];

  switch (type) {
    case 'navigate':
      return typeof r.url === 'string' ? { type, url: r.url, ...(typeof r.waitFor === 'string' ? { waitFor: r.waitFor } : {}) } : null;
    case 'click':
    case 'focus':
    case 'hover':
    case 'dblclick':
    case 'rightclick':
      return typeof r.selector === 'string' ? { type, selector: r.selector, ...(typeof r.timeout === 'number' ? { timeout: r.timeout } : {}) } : null;
    case 'type':
      return typeof r.selector === 'string' && typeof r.text === 'string'
        ? { type, selector: r.selector, text: r.text, clear: r.clear !== false, ...(typeof r.timeout === 'number' ? { timeout: r.timeout } : {}) }
        : null;
    case 'select':
      return typeof r.selector === 'string' && typeof r.text === 'string'
        ? { type, selector: r.selector, text: r.text, ...(typeof r.timeout === 'number' ? { timeout: r.timeout } : {}) }
        : null;
    case 'scroll':
      return { type, ...(typeof r.deltaX === 'number' ? { deltaX: r.deltaX } : {}), ...(typeof r.deltaY === 'number' ? { deltaY: r.deltaY } : {}), ...(typeof r.selector === 'string' ? { selector: r.selector } : {}) };
    case 'keypress':
      return typeof r.key === 'string'
        ? { type, key: r.key, ...(typeof r.selector === 'string' ? { selector: r.selector } : {}), ...(Array.isArray(r.modifiers) ? { modifiers: r.modifiers as KeypressStep['modifiers'] } : {}) }
        : null;
    case 'wait':
      return typeof r.timeout === 'number'
        ? { type, timeout: r.timeout, ...(typeof r.selector === 'string' ? { selector: r.selector } : {}) }
        : null;
    case 'wait_navigation':
      return { type, ...(typeof r.timeout === 'number' ? { timeout: r.timeout } : {}) };
    case 'extract':
      return typeof r.selector === 'string' && typeof r.toVariable === 'string'
        ? { type, selector: r.selector, toVariable: r.toVariable, ...(typeof r.attribute === 'string' ? { attribute: r.attribute } : {}) }
        : null;
    case 'assert': {
      const hasTarget = typeof r.selector === 'string' || typeof r.variable === 'string';
      const validOps = new Set(['exists', 'not_exists', 'contains', 'eq', 'gt', 'lt']);
      return hasTarget && typeof r.operator === 'string' && validOps.has(r.operator)
        ? {
            type,
            selector: typeof r.selector === 'string' ? r.selector : undefined,
            variable: typeof r.variable === 'string' ? r.variable : undefined,
            operator: r.operator as AssertStep['operator'],
            value: typeof r.value === 'string' || typeof r.value === 'number' ? r.value : undefined,
            timeout: typeof r.timeout === 'number' ? r.timeout : undefined,
          }
        : null;
    }
    case 'if': {
      const cond = r.condition;
      if (!cond || typeof cond !== 'object') return null;
      const c = cond as Record<string, unknown>;
      if (!Array.isArray(r.thenSteps)) return null;
      const validOps = new Set(['eq', 'ne', 'contains', 'gt', 'lt']);
      if (typeof c.variable !== 'string' || typeof c.operator !== 'string' || !validOps.has(c.operator)) {
        return null;
      }
      return {
        type,
        condition: {
          variable: c.variable,
          operator: c.operator as WorkflowConditionOperator,
          value: typeof c.value === 'string' || typeof c.value === 'number' ? c.value : '',
        },
        thenSteps: r.thenSteps.map((s: unknown) => sanitizeStep(s)).filter(Boolean) as WorkflowStep[],
        elseSteps: Array.isArray(r.elseSteps) ? r.elseSteps.map((s: unknown) => sanitizeStep(s)).filter(Boolean) as WorkflowStep[] : undefined,
      };
    }
    case 'export': {
      const validDestinations = new Set(['clipboard', 'csv', 'json']);
      if (typeof r.destination !== 'string' || !validDestinations.has(r.destination)) {
        return null;
      }
      return {
        type,
        destination: r.destination as ExportStep['destination'],
        variables: Array.isArray(r.variables) ? r.variables.filter((v: unknown): v is string => typeof v === 'string') : undefined,
        filename: typeof r.filename === 'string' ? r.filename : undefined,
      };
    }
    default:
      return null;
  }
}

// ─── Model 解析 ───

/**
 * 根据用户当前选中的 activeModel 解析出可用的 pi-ai Model 对象。
 *
 * @returns Model 对象，或 null（未选择模型或模型不可用）
 */
export async function resolvePlannerModel(
  modelCfg: ActiveModel | null,
  creds: ProviderCredentials,
  customProvs: CustomProviderConfig[],
): Promise<Model<Api> | null> {
  if (!modelCfg) return null;

  if (modelCfg.provider === 'web') {
    const providers = await getWebProviderRepository().list();
    const webModel = resolveSelectedWebModel(modelCfg, providers);
    return webModel ? (webModel as unknown as Model<Api>) : null;
  }

  let model: Model<Api> | undefined;

  if (isCustomProvider(modelCfg.provider)) {
    model = findCustomModel(customProvs, modelCfg.provider, modelCfg.modelId) ?? undefined;
  } else {
    try {
      const models = getModels(modelCfg.provider as KnownProvider) as Model<Api>[];
      model = models.find((m) => m.id === modelCfg.modelId);
    } catch {
      return null;
    }
  }

  return model ?? null;
}

// ─── 辅助 ───

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');
  return tab.id;
}
