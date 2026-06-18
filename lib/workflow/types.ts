/**
 * Workflow DSL 核心类型定义。
 *
 * Workflow 是可持久化、可复用、可编排的自动化单元。
 * 每个 Workflow 由一系列步骤（Step）组成，支持条件分支和变量插值。
 */

// ─── 步骤类型 ───

/** 浏览器导航步骤 */
export type NavigateStep = {
  type: 'navigate';
  url: string;
  /** 可选：导航后等待元素出现 */
  waitFor?: string;
};

/** 点击元素 */
export type ClickStep = {
  type: 'click';
  selector: string;
  timeout?: number;
};

/** 输入文本 */
export type TypeStep = {
  type: 'type';
  selector: string;
  text: string;
  /** 输入前是否清空 */
  clear?: boolean;
  timeout?: number;
};

/** 下拉选择 */
export type SelectStep = {
  type: 'select';
  selector: string;
  text: string;
  timeout?: number;
};

/** 滚动 */
export type ScrollStep = {
  type: 'scroll';
  selector?: string;
  deltaX?: number;
  deltaY?: number;
};

/** 按键 */
export type KeypressStep = {
  type: 'keypress';
  selector?: string;
  key: string;
  modifiers?: Array<'ctrl' | 'shift' | 'alt' | 'meta'>;
};

/** 等待元素出现或超时 */
export type WaitStep = {
  type: 'wait';
  selector?: string;
  timeout: number;
};

/** 等待页面导航完成 */
export type WaitNavigationStep = {
  type: 'wait_navigation';
  timeout?: number;
};

/** 从页面提取数据到变量 */
export type ExtractStep = {
  type: 'extract';
  selector: string;
  /** 提取的属性，默认 textContent */
  attribute?: string;
  /** 结果存入变量名 */
  toVariable: string;
};

/** 聚焦元素 */
export type FocusStep = {
  type: 'focus';
  selector: string;
};

/** 悬停 */
export type HoverStep = {
  type: 'hover';
  selector: string;
};

/** 双击 */
export type DblclickStep = {
  type: 'dblclick';
  selector: string;
};

/** 右键 */
export type RightclickStep = {
  type: 'rightclick';
  selector: string;
};

/** 断言：验证页面状态或变量 */
export type AssertStep = {
  type: 'assert';
  /** 目标元素 CSS 选择器（与 variable 二选一） */
  selector?: string;
  /** 变量名（与 selector 二选一） */
  variable?: string;
  /** 断言操作符 */
  operator: 'exists' | 'not_exists' | 'contains' | 'eq' | 'gt' | 'lt';
  /** 对比值（operator 为 contains/eq/gt/lt 时必填） */
  value?: string | number;
  /** 超时时间（毫秒），默认 5000 */
  timeout?: number;
};

/** 条件分支 */
export interface IfStep {
  type: 'if';
  condition: WorkflowCondition;
  thenSteps: WorkflowStep[];
  elseSteps?: WorkflowStep[];
}

/** 视觉定位：通过 VLM 识别元素坐标 */
export type VisualLocateStep = {
  type: 'visual_locate';
  /** 目标元素的自然语言描述 */
  description: string;
  /** 结果存入变量名 */
  toVariable: string;
  /** 截图质量 1-100，默认 70 */
  quality?: number;
};

/** 视觉点击：通过 VLM 定位并点击元素 */
export type VisualClickStep = {
  type: 'visual_click';
  /** 目标元素的自然语言描述 */
  description: string;
  /** 截图质量 1-100，默认 70 */
  quality?: number;
};

/** 视觉输入：通过 VLM 定位并输入文本 */
export type VisualTypeStep = {
  type: 'visual_type';
  /** 目标元素的自然语言描述 */
  description: string;
  /** 输入的文本内容 */
  text: string;
  /** 输入前是否清空 */
  clear?: boolean;
  /** 截图质量 1-100，默认 70 */
  quality?: number;
};

/** 数据导出：将变量导出到剪贴板或下载为 CSV */
export type ExportStep = {
  type: 'export';
  /** 导出目标：clipboard | csv | json */
  destination: 'clipboard' | 'csv' | 'json';
  /** 要导出的变量名列表，缺省导出所有变量 */
  variables?: string[];
  /** 文件名（csv/json 时有效），支持 {{variable}} 插值 */
  filename?: string;
};

/** 所有步骤类型的联合 */
export type WorkflowStep =
  | NavigateStep
  | ClickStep
  | TypeStep
  | SelectStep
  | ScrollStep
  | KeypressStep
  | WaitStep
  | WaitNavigationStep
  | ExtractStep
  | FocusStep
  | HoverStep
  | DblclickStep
  | RightclickStep
  | AssertStep
  | IfStep
  | ExportStep
  | VisualLocateStep
  | VisualClickStep
  | VisualTypeStep;

// ─── 条件分支 ───

export type WorkflowConditionOperator = 'eq' | 'ne' | 'contains' | 'gt' | 'lt';

export interface WorkflowCondition {
  variable: string;
  operator: WorkflowConditionOperator;
  value: string | number;
}

// ─── 触发器 ───

export type WorkflowTriggerType = 'manual' | 'cron' | 'url' | 'dom';

export interface WorkflowTriggerConfig {
  manual: Record<string, never>;
  cron: { expression: string };
  url: { pattern: string };
  dom: { selector: string; timeout?: number };
}

export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  config?: WorkflowTriggerConfig[WorkflowTriggerType];
}

// ─── Workflow 实体 ───

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  /** 触发器配置，缺省为 manual */
  trigger?: WorkflowTrigger;
  /** 变量默认值 */
  variables?: Record<string, string>;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 运行次数 */
  runCount: number;
  /** 最后运行时间 */
  lastRunAt?: number;
  /** 最后运行状态 */
  lastRunStatus?: 'success' | 'failure' | 'cancelled';
}

// ─── 运行时状态 ───

export type WorkflowRunStatus = 'idle' | 'running' | 'paused' | 'success' | 'failure' | 'cancelled';

export interface WorkflowRunState {
  workflowId: string;
  runId: string;
  status: WorkflowRunStatus;
  currentStepIndex: number;
  variables: Record<string, string>;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

// ─── 运行历史记录 ───

export interface WorkflowRunStepRecord {
  step: WorkflowStep;
  index: number;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: Extract<WorkflowRunStatus, 'success' | 'failure' | 'cancelled'>;
  steps: WorkflowRunStepRecord[];
  /** 执行结束时的变量快照 */
  variables?: Record<string, string>;
  startedAt: number;
  endedAt: number;
  error?: string;
}

// ─── 步骤辅助 ───

/** 步骤类型的可读标签（英文，UI 层通过 i18n 映射为本地语言） */
export const STEP_TYPE_LABELS: Record<WorkflowStep['type'], string> = {
  navigate: 'Navigate',
  click: 'Click',
  type: 'Type',
  select: 'Select',
  scroll: 'Scroll',
  keypress: 'Keypress',
  wait: 'Wait',
  wait_navigation: 'Wait Navigation',
  extract: 'Extract',
  focus: 'Focus',
  hover: 'Hover',
  dblclick: 'Double Click',
  rightclick: 'Right Click',
  assert: 'Assert',
  if: 'If',
  export: 'Export',
  visual_locate: 'Visual Locate',
  visual_click: 'Visual Click',
  visual_type: 'Visual Type',
};

/** 提取步骤的简要描述，用于 UI 展示 */
export function describeStep(step: WorkflowStep): string {
  switch (step.type) {
    case 'navigate':
      return `Navigate to ${step.url}`;
    case 'click':
      return `Click ${step.selector}`;
    case 'type':
      return `Type "${step.text}" into ${step.selector}`;
    case 'select':
      return `Select "${step.text}" in ${step.selector}`;
    case 'scroll':
      return `Scroll ${step.selector ?? 'page'} (${step.deltaX ?? 0}, ${step.deltaY ?? 0})`;
    case 'keypress':
      return `Press ${step.key}`;
    case 'wait':
      return `Wait ${step.selector ?? ''} ${step.timeout}ms`;
    case 'wait_navigation':
      return 'Wait for navigation';
    case 'extract':
      return `Extract from ${step.selector} to $${step.toVariable}`;
    case 'focus':
      return `Focus ${step.selector}`;
    case 'hover':
      return `Hover ${step.selector}`;
    case 'dblclick':
      return `Double click ${step.selector}`;
    case 'rightclick':
      return `Right click ${step.selector}`;
    case 'assert': {
      const target = step.selector ?? `\${${step.variable ?? ''}}`;
      return `Assert ${target} ${step.operator}${step.value !== undefined ? ` ${step.value}` : ''}`;
    }
    case 'if':
      return `If \${${step.condition.variable}} ${step.condition.operator} ${step.condition.value} (${step.thenSteps.length} steps${step.elseSteps ? `, else ${step.elseSteps.length}` : ''})`;
    case 'export':
      return `Export ${step.variables?.join(', ') ?? 'all variables'} to ${step.destination}`;
    case 'visual_locate':
      return `Visual locate "${step.description}" to $${step.toVariable}`;
    case 'visual_click':
      return `Visual click "${step.description}"`;
    case 'visual_type':
      return `Visual type "${step.text}" into "${step.description}"`;
    default:
      return 'Unknown step';
  }
}
