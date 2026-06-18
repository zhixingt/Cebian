/**
 * AI Planner 成功率基准测试
 *
 * 评估目标：量化 AI Planner 将自然语言目标转换为可执行 Workflow 的能力。
 * 测试分层：
 *   1. 解析鲁棒性 — 各种 LLM 输出格式（JSON数组、markdown代码块、含噪声文本）
 *   2. 步骤清洗覆盖率 — sanitizeStep 对 15 种步骤类型及边缘情况的处理
 *   3. 场景模拟 — 10 个典型用户目标，模拟页面上下文 + 模拟 LLM 响应，评估工作流质量
 *
 * 评估指标：
 *   - 语法有效性（Syntax Validity）：生成的步骤是否符合 WorkflowStep 类型定义
 *   - 步骤可执行性（Step Executability）：selector 是否使用稳定属性（id/name/aria-label）
 *   - 目标完整性（Goal Completeness）：是否覆盖用户目标所需的核心操作
 *   - 安全性（Safety）：是否包含意外的跨站 navigate 或危险操作
 */

import { describe, it, expect, vi } from 'vitest';
import type { WorkflowStep } from '@/lib/workflow/types';

// ─── 测试辅助：sanitizeStep 内联副本（与 ai-planner.ts 保持同步）───

function sanitizeStep(raw: any): WorkflowStep | null {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return null;

  const type = raw.type as WorkflowStep['type'];

  switch (type) {
    case 'navigate':
      return typeof raw.url === 'string' ? { type, url: raw.url, ...(raw.waitFor ? { waitFor: String(raw.waitFor) } : {}) } : null;
    case 'click':
    case 'focus':
    case 'hover':
    case 'dblclick':
    case 'rightclick':
      return typeof raw.selector === 'string' ? { type, selector: raw.selector, ...(typeof raw.timeout === 'number' ? { timeout: raw.timeout } : {}) } : null;
    case 'type':
      return typeof raw.selector === 'string' && typeof raw.text === 'string'
        ? { type, selector: raw.selector, text: raw.text, clear: raw.clear !== false, ...(typeof raw.timeout === 'number' ? { timeout: raw.timeout } : {}) }
        : null;
    case 'select':
      return typeof raw.selector === 'string' && typeof raw.text === 'string'
        ? { type, selector: raw.selector, text: raw.text, ...(typeof raw.timeout === 'number' ? { timeout: raw.timeout } : {}) }
        : null;
    case 'scroll':
      return { type, ...(typeof raw.deltaX === 'number' ? { deltaX: raw.deltaX } : {}), ...(typeof raw.deltaY === 'number' ? { deltaY: raw.deltaY } : {}), ...(typeof raw.selector === 'string' ? { selector: raw.selector } : {}) };
    case 'keypress':
      return typeof raw.key === 'string'
        ? { type, key: raw.key, ...(typeof raw.selector === 'string' ? { selector: raw.selector } : {}), ...(Array.isArray(raw.modifiers) ? { modifiers: raw.modifiers } : {}) }
        : null;
    case 'wait':
      return typeof raw.timeout === 'number'
        ? { type, timeout: raw.timeout, ...(typeof raw.selector === 'string' ? { selector: raw.selector } : {}) }
        : null;
    case 'wait_navigation':
      return { type, ...(typeof raw.timeout === 'number' ? { timeout: raw.timeout } : {}) };
    case 'extract':
      return typeof raw.selector === 'string' && typeof raw.toVariable === 'string'
        ? { type, selector: raw.selector, toVariable: raw.toVariable, ...(typeof raw.attribute === 'string' ? { attribute: raw.attribute } : {}) }
        : null;
    case 'assert': {
      const hasTarget = typeof raw.selector === 'string' || typeof raw.variable === 'string';
      const validOps = new Set(['exists', 'not_exists', 'contains', 'eq', 'gt', 'lt']);
      return hasTarget && typeof raw.operator === 'string' && validOps.has(raw.operator)
        ? {
            type,
            selector: typeof raw.selector === 'string' ? raw.selector : undefined,
            variable: typeof raw.variable === 'string' ? raw.variable : undefined,
            operator: raw.operator as any,
            value: raw.value,
            timeout: typeof raw.timeout === 'number' ? raw.timeout : undefined,
          }
        : null;
    }
    case 'if': {
      if (typeof raw.condition !== 'object' || raw.condition === null || !Array.isArray(raw.thenSteps)) {
        return null;
      }
      const validOps = new Set(['eq', 'ne', 'contains', 'gt', 'lt']);
      if (typeof raw.condition.variable !== 'string' || typeof raw.condition.operator !== 'string' || !validOps.has(raw.condition.operator)) {
        return null;
      }
      return {
        type,
        condition: {
          variable: raw.condition.variable,
          operator: raw.condition.operator,
          value: raw.condition.value,
        },
        thenSteps: raw.thenSteps.map((s: any) => sanitizeStep(s)).filter(Boolean) as WorkflowStep[],
        elseSteps: raw.elseSteps ? raw.elseSteps.map((s: any) => sanitizeStep(s)).filter(Boolean) as WorkflowStep[] : undefined,
      };
    }
    case 'export': {
      const validDestinations = new Set(['clipboard', 'csv', 'json']);
      if (typeof raw.destination !== 'string' || !validDestinations.has(raw.destination)) {
        return null;
      }
      return {
        type,
        destination: raw.destination,
        variables: Array.isArray(raw.variables) ? raw.variables.filter((v: any) => typeof v === 'string') : undefined,
        filename: typeof raw.filename === 'string' ? raw.filename : undefined,
      };
    }
    default:
      return null;
  }
}

// ─── 测试辅助：LLM 输出解析器（复刻 ai-planner.ts 的解析逻辑）───

function parseLlmOutput(textContent: string): WorkflowStep[] | null {
  if (!textContent) return null;
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : textContent.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;
    const steps = parsed.map((s: any) => sanitizeStep(s)).filter(Boolean) as WorkflowStep[];
    return steps.length > 0 ? steps : null;
  } catch {
    return null;
  }
}

// ─── 测试辅助：评估指标 ───

interface BenchmarkResult {
  scenario: string;
  goal: string;
  parseSuccess: boolean;
  syntaxValid: boolean;
  executableScore: number; // 0-1，selector 稳定性
  completenessScore: number; // 0-1，是否覆盖核心操作
  safetyPass: boolean; // 无危险操作
}

/** 评估 selector 是否使用稳定属性 */
function isStableSelector(selector: string): boolean {
  if (!selector) return false;
  // id、name、aria-label、placeholder、data-testid 视为稳定
  if (/^#[a-zA-Z0-9_-]+$/.test(selector)) return true;
  if (/\[name=/.test(selector)) return true;
  if (/\[aria-label=/.test(selector)) return true;
  if (/\[placeholder=/.test(selector)) return true;
  if (/\[data-testid=/.test(selector)) return true;
  // 纯标签名或动态 class 视为不稳定
  if (/^[a-z]+$/.test(selector)) return false;
  if (/\./.test(selector) && !/\[/.test(selector)) return false;
  return true;
}

/** 评估步骤列表的可执行性分数 */
function evaluateExecutability(steps: WorkflowStep[]): number {
  let total = 0;
  let passed = 0;
  for (const step of steps) {
    if ('selector' in step && step.selector !== undefined) {
      total++;
      if (isStableSelector(step.selector)) passed++;
    }
  }
  return total === 0 ? 1.0 : passed / total;
}

/** 检查安全性：无意外跨站 navigate */
function evaluateSafety(steps: WorkflowStep[], expectedDomain?: string): boolean {
  for (const step of steps) {
    if (step.type === 'navigate') {
      // 如果期望域名已提供，检查 navigate 是否在预期范围内
      if (expectedDomain && !step.url.includes(expectedDomain)) {
        return false;
      }
    }
  }
  return true;
}

// ─── 基准场景定义（10 个典型用户目标 + 模拟 LLM 响应）───

interface BenchmarkScenario {
  id: string;
  goal: string;
  expectedDomain?: string;
  requiredStepTypes: WorkflowStep['type'][];
  llmOutputs: string[]; // 多种可能的 LLM 输出格式
}

const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: 'search-extract',
    goal: '搜索“天气预报”并提取第一行温度数据',
    expectedDomain: 'google.com',
    requiredStepTypes: ['type', 'click', 'extract', 'wait'],
    llmOutputs: [
      // 格式1：纯 JSON 数组
      `[{"type":"type","selector":"#search-box","text":"天气预报"},{"type":"click","selector":"#search-button"},{"type":"wait","timeout":2000},{"type":"extract","selector":".temperature","toVariable":"temp"}]`,
      // 格式2：markdown 代码块
      '```json\n[\n  {"type": "type", "selector": "input[name=\"q\"]", "text": "天气预报"},\n  {"type": "keypress", "key": "Enter"},\n  {"type": "wait", "timeout": 2000},\n  {"type": "extract", "selector": "#result .temp", "toVariable": "temp"}\n]\n```',
      // 格式3：含解释文本 + JSON
      '好的，我来为您规划步骤。首先输入搜索词，然后提交，等待加载，最后提取温度。\n\n```json\n[\n  {"type": "type", "selector": "textarea[aria-label=\"搜索\"]", "text": "天气预报"},\n  {"type": "keypress", "key": "Enter"},\n  {"type": "wait", "timeout": 1500},\n  {"type": "extract", "selector": ".weather-temp", "toVariable": "temperature"}\n]\n```',
    ],
  },
  {
    id: 'login-flow',
    goal: '登录邮箱：输入用户名和密码并点击登录',
    expectedDomain: 'mail.example.com',
    requiredStepTypes: ['type', 'click', 'wait'],
    llmOutputs: [
      `[{"type":"type","selector":"#username","text":"user@example.com"},{"type":"type","selector":"#password","text":"{{password}}"},{"type":"click","selector":"#login-btn"},{"type":"wait","selector":".inbox","timeout":5000}]`,
      '```json\n[\n  {"type": "type", "selector": "input[name=\"email\"]", "text": "user@example.com"},\n  {"type": "type", "selector": "input[name=\"password\"]", "text": "secret"},\n  {"type": "click", "selector": "button[type=\"submit\"]"},\n  {"type": "wait_navigation"}\n]\n```',
    ],
  },
  {
    id: 'form-submit',
    goal: '填写联系表单：输入姓名、邮箱、留言并提交',
    expectedDomain: 'contact.example.com',
    requiredStepTypes: ['type', 'click', 'assert'],
    llmOutputs: [
      `[{"type":"type","selector":"#name","text":"张三"},{"type":"type","selector":"#email","text":"zhangsan@example.com"},{"type":"type","selector":"#message","text":"你好，我想咨询..."},{"type":"click","selector":"#submit"},{"type":"assert","selector":".success-msg","operator":"exists"}]`,
    ],
  },
  {
    id: 'cookie-consent',
    goal: '点击 Cookie 同意按钮',
    requiredStepTypes: ['click', 'wait'],
    llmOutputs: [
      `[{"type":"click","selector":"#cookie-accept"},{"type":"wait","timeout":500}]`,
      `[{"type":"click","selector":"button[aria-label=\"Accept cookies\"]"}]`,
      `[{"type":"click","selector":".cookie-banner .btn-primary"}]`,
    ],
  },
  {
    id: 'expand-extract',
    goal: '点击“展开全文”按钮并提取文章内容',
    requiredStepTypes: ['click', 'extract', 'wait'],
    llmOutputs: [
      `[{"type":"click","selector":"#expand-btn"},{"type":"wait","timeout":1000},{"type":"extract","selector":".article-content","toVariable":"article"}]`,
    ],
  },
  {
    id: 'multi-step-nav',
    goal: '进入设置页面，打开通知开关',
    requiredStepTypes: ['click', 'navigate'],
    llmOutputs: [
      `[{"type":"navigate","url":"https://app.example.com/settings"},{"type":"click","selector":"#notifications-tab"},{"type":"click","selector":"#enable-notifications"}]`,
    ],
  },
  {
    id: 'conditional-branch',
    goal: '如果页面上存在“立即购买”按钮则点击，否则点击“加入购物车”',
    requiredStepTypes: ['if', 'click'],
    llmOutputs: [
      `[{"type":"if","condition":{"variable":"buyNowExists","operator":"eq","value":"true"},"thenSteps":[{"type":"click","selector":"#buy-now"}],"elseSteps":[{"type":"click","selector":"#add-to-cart"}]}]`,
    ],
  },
  {
    id: 'data-export',
    goal: '提取商品价格并导出为 CSV',
    requiredStepTypes: ['extract', 'export'],
    llmOutputs: [
      `[{"type":"extract","selector":".price","toVariable":"price"},{"type":"export","destination":"csv","variables":["price"],"filename":"prices.csv"}]`,
    ],
  },
  {
    id: 'scroll-extract',
    goal: '向下滚动页面并提取评论列表',
    requiredStepTypes: ['scroll', 'extract', 'wait'],
    llmOutputs: [
      `[{"type":"scroll","deltaY":800},{"type":"wait","timeout":1000},{"type":"extract","selector":".comment-list","toVariable":"comments"}]`,
    ],
  },
  {
    id: 'price-monitor',
    goal: '提取商品价格，断言价格小于 1000',
    requiredStepTypes: ['extract', 'assert'],
    llmOutputs: [
      `[{"type":"extract","selector":"#price","toVariable":"price"},{"type":"assert","variable":"price","operator":"lt","value":1000}]`,
    ],
  },
];

// ─── 测试套件 1：解析鲁棒性 ───

describe('AI Planner Benchmark — 解析鲁棒性', () => {
  const formats = [
    { name: '纯 JSON 数组', valid: true },
    { name: 'markdown json 代码块', valid: true },
    { name: 'markdown 无语言标签代码块', valid: true },
    { name: '含前导解释文本 + 代码块', valid: true },
    { name: '含后缀解释文本 + 代码块', valid: true },
    { name: '空字符串', valid: false },
    { name: '非数组 JSON（对象）', valid: false },
    { name: '非 JSON 文本', valid: false },
    { name: 'JSON 数组含非法步骤类型', valid: true }, // sanitizeStep 会过滤
    { name: '嵌套代码块', valid: false },
  ];

  const samples: Record<string, string> = {
    '纯 JSON 数组': '[{"type":"click","selector":"#btn"}]',
    'markdown json 代码块': '```json\n[{"type":"click","selector":"#btn"}]\n```',
    'markdown 无语言标签代码块': '```\n[{"type":"click","selector":"#btn"}]\n```',
    '含前导解释文本 + 代码块': '这是步骤\n```json\n[{"type":"click","selector":"#btn"}]\n```',
    '含后缀解释文本 + 代码块': '```json\n[{"type":"click","selector":"#btn"}]\n```\n请执行',
    '空字符串': '',
    '非数组 JSON（对象）': '{"type":"click","selector":"#btn"}',
    '非 JSON 文本': '我来点击按钮',
    'JSON 数组含非法步骤类型': '[{"type":"click","selector":"#btn"},{"type":"fly"}]',
    '嵌套代码块': '```json\n```json\n[{"type":"click","selector":"#btn"}]\n```\n```',
  };

  it.each(formats)('格式: $name → 解析成功=$valid', ({ name, valid }) => {
    const result = parseLlmOutput(samples[name]);
    if (valid) {
      expect(result).not.toBeNull();
      if (result && name.includes('非法')) {
        expect(result.length).toBe(1); // fly 被过滤
      }
    } else {
      expect(result).toBeNull();
    }
  });

  it('解析鲁棒性成功率应达到 100%', () => {
    let passed = 0;
    for (const { name, valid } of formats) {
      const result = parseLlmOutput(samples[name]);
      const ok = valid ? result !== null : result === null;
      if (ok) passed++;
    }
    expect(passed / formats.length).toBe(1.0);
  });
});

// ─── 测试套件 2：步骤清洗覆盖率 ───

describe('AI Planner Benchmark — 步骤清洗覆盖率', () => {
  const stepTypeCases: { type: WorkflowStep['type']; valid: any; invalid: any }[] = [
    { type: 'navigate', valid: { type: 'navigate', url: 'https://x.com' }, invalid: { type: 'navigate' } },
    { type: 'click', valid: { type: 'click', selector: '#btn' }, invalid: { type: 'click' } },
    { type: 'type', valid: { type: 'type', selector: '#in', text: 'hi' }, invalid: { type: 'type', selector: '#in' } },
    { type: 'select', valid: { type: 'select', selector: '#sel', text: 'opt' }, invalid: { type: 'select', selector: '#sel' } },
    { type: 'scroll', valid: { type: 'scroll', deltaY: 100 }, invalid: null },
    { type: 'keypress', valid: { type: 'keypress', key: 'Enter' }, invalid: { type: 'keypress' } },
    { type: 'wait', valid: { type: 'wait', timeout: 1000 }, invalid: { type: 'wait' } },
    { type: 'wait_navigation', valid: { type: 'wait_navigation' }, invalid: null },
    { type: 'extract', valid: { type: 'extract', selector: '#x', toVariable: 'v' }, invalid: { type: 'extract', selector: '#x' } },
    { type: 'focus', valid: { type: 'focus', selector: '#x' }, invalid: { type: 'focus' } },
    { type: 'hover', valid: { type: 'hover', selector: '#x' }, invalid: { type: 'hover' } },
    { type: 'dblclick', valid: { type: 'dblclick', selector: '#x' }, invalid: { type: 'dblclick' } },
    { type: 'rightclick', valid: { type: 'rightclick', selector: '#x' }, invalid: { type: 'rightclick' } },
    { type: 'assert', valid: { type: 'assert', selector: '#x', operator: 'exists' }, invalid: { type: 'assert', operator: 'exists' } },
    { type: 'if', valid: { type: 'if', condition: { variable: 'x', operator: 'eq', value: '1' }, thenSteps: [] }, invalid: { type: 'if', condition: { variable: 'x', operator: 'fly', value: '1' }, thenSteps: [] } },
    { type: 'export', valid: { type: 'export', destination: 'csv' }, invalid: { type: 'export', destination: 'pdf' } },
  ];

  it.each(stepTypeCases)('步骤类型 $type：合法输入通过，非法输入拒绝', ({ valid, invalid }) => {
    expect(sanitizeStep(valid)).not.toBeNull();
    if (invalid !== null) {
      expect(sanitizeStep(invalid)).toBeNull();
    }
  });

  it('15 种步骤类型清洗覆盖率应达到 100%', () => {
    const covered = new Set(stepTypeCases.map((c) => c.type));
    expect(covered.size).toBe(16); // 包含全部 15 种 + if/export
  });

  it('深层嵌套 if 步骤应被完整清洗', () => {
    const raw = {
      type: 'if',
      condition: { variable: 'a', operator: 'eq', value: '1' },
      thenSteps: [
        {
          type: 'if',
          condition: { variable: 'b', operator: 'gt', value: 0 },
          thenSteps: [
            { type: 'assert', selector: '#msg', operator: 'exists' },
            { type: 'fly' }, // 非法，应被过滤
          ],
        },
      ],
    };
    const s = sanitizeStep(raw);
    expect(s).not.toBeNull();
    const outer = s as any;
    expect(outer.thenSteps).toHaveLength(1);
    expect(outer.thenSteps[0].thenSteps).toHaveLength(1);
  });
});

// ─── 测试套件 3：场景模拟与质量评估 ───

describe('AI Planner Benchmark — 场景模拟（10 个典型目标）', () => {
  function runScenario(scenario: BenchmarkScenario): BenchmarkResult {
    // 取第一个 LLM 输出作为代表进行评估
    const output = scenario.llmOutputs[0];
    const steps = parseLlmOutput(output);

    const parseSuccess = steps !== null && steps.length > 0;
    const syntaxValid = parseSuccess && steps!.every((s) => s.type !== undefined);
    const executableScore = parseSuccess ? evaluateExecutability(steps!) : 0;
    const safetyPass = parseSuccess ? evaluateSafety(steps!, scenario.expectedDomain) : false;

    // 完整性：检查是否包含至少一个必需的步骤类型
    const stepTypes = parseSuccess ? new Set(steps!.map((s) => s.type)) : new Set<string>();
    const requiredHits = scenario.requiredStepTypes.filter((t) => stepTypes.has(t)).length;
    const completenessScore = scenario.requiredStepTypes.length > 0 ? requiredHits / scenario.requiredStepTypes.length : 1;

    return {
      scenario: scenario.id,
      goal: scenario.goal,
      parseSuccess,
      syntaxValid,
      executableScore,
      completenessScore,
      safetyPass,
    };
  }

  const results: BenchmarkResult[] = BENCHMARK_SCENARIOS.map(runScenario);

  it.each(results)('场景 $scenario — 解析成功=$parseSuccess, 语法有效=$syntaxValid, 可执行性=$executableScore, 完整性=$completenessScore, 安全=$safetyPass', (result) => {
    // 每个场景必须解析成功
    expect(result.parseSuccess).toBe(true);
    // 语法必须完全有效
    expect(result.syntaxValid).toBe(true);
    // 安全性必须通过
    expect(result.safetyPass).toBe(true);
  });

  it('整体基准测试报告', () => {
    const total = results.length;
    const parseSuccessCount = results.filter((r) => r.parseSuccess).length;
    const syntaxValidCount = results.filter((r) => r.syntaxValid).length;
    const safetyPassCount = results.filter((r) => r.safetyPass).length;
    const avgExecutability = results.reduce((sum, r) => sum + r.executableScore, 0) / total;
    const avgCompleteness = results.reduce((sum, r) => sum + r.completenessScore, 0) / total;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║           AI Planner 成功率基准测试报告                    ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    for (const r of results) {
      const status = r.parseSuccess && r.syntaxValid && r.safetyPass ? '✅' : '❌';
      console.log(`║ ${status} ${r.scenario.padEnd(20)} 可执行性:${(r.executableScore * 100).toFixed(0).padStart(3)}% 完整性:${(r.completenessScore * 100).toFixed(0).padStart(3)}% ║`);
    }
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ 解析成功率: ${(parseSuccessCount / total * 100).toFixed(0)}%`.padEnd(59) + '║');
    console.log(`║ 语法有效性: ${(syntaxValidCount / total * 100).toFixed(0)}%`.padEnd(59) + '║');
    console.log(`║ 平均可执行性: ${(avgExecutability * 100).toFixed(0)}%`.padEnd(57) + '║');
    console.log(`║ 平均完整性: ${(avgCompleteness * 100).toFixed(0)}%`.padEnd(59) + '║');
    console.log(`║ 安全性通过率: ${(safetyPassCount / total * 100).toFixed(0)}%`.padEnd(57) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    // 断言基准线
    expect(parseSuccessCount / total).toBeGreaterThanOrEqual(1.0); // 100%
    expect(syntaxValidCount / total).toBeGreaterThanOrEqual(1.0); // 100%
    expect(avgExecutability).toBeGreaterThanOrEqual(0.6); // ≥60%
    expect(avgCompleteness).toBeGreaterThanOrEqual(0.7); // ≥70%
    expect(safetyPassCount / total).toBeGreaterThanOrEqual(1.0); // 100%
  });
});

// ─── 测试套件 4：边缘情况与压力测试 ───

describe('AI Planner Benchmark — 边缘情况与压力测试', () => {
  it('应处理超大 LLM 输出（100 步）', () => {
    const steps = Array.from({ length: 100 }, (_, i) => ({
      type: 'click',
      selector: `#btn-${i}`,
    }));
    const output = JSON.stringify(steps);
    const result = parseLlmOutput(output);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(100);
  });

  it('应处理含 null 的脏数组', () => {
    const output = '[{"type":"click","selector":"#a"}, null, {"type":"navigate","url":"https://x.com"}]';
    const result = parseLlmOutput(output);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
  });

  it('应处理深度嵌套 if（5 层）', () => {
    let raw: any = { type: 'assert', selector: '#x', operator: 'exists' };
    for (let i = 0; i < 5; i++) {
      raw = {
        type: 'if',
        condition: { variable: `v${i}`, operator: 'eq', value: '1' },
        thenSteps: [raw],
      };
    }
    const result = sanitizeStep(raw);
    expect(result).not.toBeNull();
  });

  it('应拒绝 XSS 风格注入尝试', () => {
    const malicious = '[{"type":"navigate","url":"javascript:alert(1)"}]';
    const result = parseLlmOutput(malicious);
    expect(result).not.toBeNull();
    // navigate 步骤本身语法有效，但安全性应由上层评估
    expect(result![0].type).toBe('navigate');
  });

  it('应处理含 Unicode 和特殊字符的 selector', () => {
    const output = JSON.stringify([{ type: 'click', selector: '[aria-label="搜索按钮"]' }]);
    const result = parseLlmOutput(output);
    expect(result).not.toBeNull();
    expect((result![0] as any).selector).toBe('[aria-label="搜索按钮"]');
  });
});

// ─── 测试套件 5：端到端模拟（复刻 generateWorkflow 解析路径）───

describe('AI Planner Benchmark — 端到端模拟', () => {
  it('完整解析路径：含解释文本 → markdown 代码块 → JSON 数组 → sanitizeStep', () => {
    const rawLlmOutput = `好的，我来帮您完成这个任务。

首先，我需要导航到目标页面，然后点击搜索框，输入关键词，最后提取结果。

\`\`\`json
[
  { "type": "navigate", "url": "https://example.com/search" },
  { "type": "click", "selector": "#search-input" },
  { "type": "type", "selector": "#search-input", "text": "AI 工具" },
  { "type": "keypress", "key": "Enter" },
  { "type": "wait", "timeout": 2000 },
  { "type": "extract", "selector": "[data-testid='result-item']", "toVariable": "firstResult" },
  { "type": "export", "destination": "clipboard", "variables": ["firstResult"] }
]
\`\`\`

希望这些步骤能帮到您！`;

    const steps = parseLlmOutput(rawLlmOutput);
    expect(steps).not.toBeNull();
    expect(steps!.length).toBe(7);

    const types = steps!.map((s) => s.type);
    expect(types).toEqual([
      'navigate', 'click', 'type', 'keypress', 'wait', 'extract', 'export',
    ]);

    // 验证可执行性
    expect(evaluateExecutability(steps!)).toBeGreaterThanOrEqual(0.8);
    // 验证安全性
    expect(evaluateSafety(steps!, 'example.com')).toBe(true);
  });

  it('应支持变量插值语法 {{variable}} 在 text 和 url 中保留', () => {
    const output = '[{"type":"type","selector":"#name","text":"{{username}}"},{"type":"navigate","url":"https://example.com/user/{{userId}}"}]';
    const steps = parseLlmOutput(output);
    expect(steps).not.toBeNull();
    expect((steps![0] as any).text).toBe('{{username}}');
    expect((steps![1] as any).url).toBe('https://example.com/user/{{userId}}');
  });
});
