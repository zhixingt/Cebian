/**
 * Workflow DSL JSON Schema 与验证器
 *
 * 用途：
 * 1. 导入工作流时验证 JSON 结构
 * 2. AI Planner 生成后校验输出合规性
 * 3. 工作流市场分享前的格式检查
 */

import type { Workflow, WorkflowStep, WorkflowTrigger } from './types';

// ─── JSON Schema 对象（符合 Draft-07）───

export const WORKFLOW_CONDITION_SCHEMA = {
  type: 'object',
  required: ['variable', 'operator', 'value'],
  properties: {
    variable: { type: 'string', minLength: 1 },
    operator: { type: 'string', enum: ['eq', 'ne', 'contains', 'gt', 'lt'] },
    value: { oneOf: [{ type: 'string' }, { type: 'number' }] },
  },
  additionalProperties: false,
} as const;

/** 单步骤的 JSON Schema */
export const WORKFLOW_STEP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['type'],
  properties: {
    type: {
      type: 'string',
      enum: [
        'navigate', 'click', 'type', 'select', 'scroll',
        'keypress', 'wait', 'wait_navigation', 'extract',
        'focus', 'hover', 'dblclick', 'rightclick',
        'assert', 'if', 'export', 'visual_locate',
        'visual_click', 'visual_type',
      ],
    },
  },
  allOf: [
    {
      if: { properties: { type: { const: 'navigate' } } },
      then: {
        required: ['url'],
        properties: {
          url: { type: 'string', minLength: 1 },
          waitFor: { type: 'string' },
        },
      },
    },
    {
      if: { properties: { type: { const: 'click' } } },
      then: {
        required: ['selector'],
        properties: {
          selector: { type: 'string', minLength: 1 },
          timeout: { type: 'number', minimum: 0 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'type' } } },
      then: {
        required: ['selector', 'text'],
        properties: {
          selector: { type: 'string', minLength: 1 },
          text: { type: 'string' },
          clear: { type: 'boolean' },
          timeout: { type: 'number', minimum: 0 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'select' } } },
      then: {
        required: ['selector', 'text'],
        properties: {
          selector: { type: 'string', minLength: 1 },
          text: { type: 'string' },
          timeout: { type: 'number', minimum: 0 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'scroll' } } },
      then: {
        properties: {
          selector: { type: 'string' },
          deltaX: { type: 'number' },
          deltaY: { type: 'number' },
        },
      },
    },
    {
      if: { properties: { type: { const: 'keypress' } } },
      then: {
        required: ['key'],
        properties: {
          selector: { type: 'string' },
          key: { type: 'string', minLength: 1 },
          modifiers: {
            type: 'array',
            items: { type: 'string', enum: ['ctrl', 'shift', 'alt', 'meta'] },
          },
        },
      },
    },
    {
      if: { properties: { type: { const: 'wait' } } },
      then: {
        required: ['timeout'],
        properties: {
          selector: { type: 'string' },
          timeout: { type: 'number', minimum: 0 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'wait_navigation' } } },
      then: {
        properties: {
          timeout: { type: 'number', minimum: 0 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'extract' } } },
      then: {
        required: ['selector', 'toVariable'],
        properties: {
          selector: { type: 'string', minLength: 1 },
          attribute: { type: 'string' },
          toVariable: { type: 'string', minLength: 1, pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$' },
        },
      },
    },
    {
      if: { properties: { type: { const: 'focus' } } },
      then: {
        required: ['selector'],
        properties: {
          selector: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'hover' } } },
      then: {
        required: ['selector'],
        properties: {
          selector: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'dblclick' } } },
      then: {
        required: ['selector'],
        properties: {
          selector: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'rightclick' } } },
      then: {
        required: ['selector'],
        properties: {
          selector: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'assert' } } },
      then: {
        required: ['operator'],
        properties: {
          selector: { type: 'string' },
          variable: { type: 'string' },
          operator: { type: 'string', enum: ['exists', 'not_exists', 'contains', 'eq', 'gt', 'lt'] },
          value: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          timeout: { type: 'number', minimum: 0 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'if' } } },
      then: {
        required: ['condition', 'thenSteps'],
        properties: {
          condition: WORKFLOW_CONDITION_SCHEMA,
          thenSteps: { type: 'array', items: { $ref: '#' } },
          elseSteps: { type: 'array', items: { $ref: '#' } },
        },
      },
    },
    {
      if: { properties: { type: { const: 'export' } } },
      then: {
        required: ['destination'],
        properties: {
          destination: { type: 'string', enum: ['clipboard', 'csv', 'json'] },
          variables: { type: 'array', items: { type: 'string', minLength: 1 } },
          filename: { type: 'string' },
        },
      },
    },
    {
      if: { properties: { type: { const: 'visual_locate' } } },
      then: {
        required: ['description', 'toVariable'],
        properties: {
          description: { type: 'string', minLength: 1 },
          toVariable: { type: 'string', minLength: 1 },
          quality: { type: 'number', minimum: 1, maximum: 100 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'visual_click' } } },
      then: {
        required: ['description'],
        properties: {
          description: { type: 'string', minLength: 1 },
          quality: { type: 'number', minimum: 1, maximum: 100 },
        },
      },
    },
    {
      if: { properties: { type: { const: 'visual_type' } } },
      then: {
        required: ['description', 'text'],
        properties: {
          description: { type: 'string', minLength: 1 },
          text: { type: 'string' },
          clear: { type: 'boolean' },
          quality: { type: 'number', minimum: 1, maximum: 100 },
        },
      },
    },
  ],
  additionalProperties: false,
};

/** Workflow 触发器 Schema */
export const WORKFLOW_TRIGGER_SCHEMA = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['manual', 'cron', 'url', 'dom'] },
    config: {},
  },
  allOf: [
    {
      if: { properties: { type: { const: 'cron' } } },
      then: {
        required: ['config'],
        properties: {
          config: {
            type: 'object',
            required: ['expression'],
            properties: {
              expression: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
      },
    },
    {
      if: { properties: { type: { const: 'url' } } },
      then: {
        required: ['config'],
        properties: {
          config: {
            type: 'object',
            required: ['pattern'],
            properties: {
              pattern: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
      },
    },
    {
      if: { properties: { type: { const: 'dom' } } },
      then: {
        required: ['config'],
        properties: {
          config: {
            type: 'object',
            required: ['selector'],
            properties: {
              selector: { type: 'string', minLength: 1 },
              timeout: { type: 'number', minimum: 0 },
            },
            additionalProperties: false,
          },
        },
      },
    },
  ],
  additionalProperties: false,
} as const;

/** 完整 Workflow JSON Schema */
export const WORKFLOW_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['id', 'name', 'steps', 'createdAt', 'updatedAt', 'runCount'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 1000 },
    steps: {
      type: 'array',
      items: WORKFLOW_STEP_SCHEMA,
    },
    trigger: WORKFLOW_TRIGGER_SCHEMA,
    variables: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    createdAt: { type: 'number', minimum: 0 },
    updatedAt: { type: 'number', minimum: 0 },
    runCount: { type: 'number', minimum: 0 },
    lastRunAt: { type: 'number', minimum: 0 },
    lastRunStatus: { type: 'string', enum: ['success', 'failure', 'cancelled'] },
  },
  additionalProperties: false,
} as const;

// ─── 轻量运行时验证器（不依赖外部 AJV 库，减少 bundle 体积）───

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** 验证单个步骤（返回结构化错误，不抛异常） */
export function validateStepLoose(step: unknown, path = 'step'): ValidationResult {
  const errors: string[] = [];
  if (!step || typeof step !== 'object') {
    return { valid: false, errors: [`${path} must be an object`] };
  }
  const s = step as Record<string, unknown>;
  const type = s.type;
  if (typeof type !== 'string') {
    return { valid: false, errors: [`${path}.type is required and must be a string`] };
  }

  const validTypes = new Set([
    'navigate', 'click', 'type', 'select', 'scroll', 'keypress',
    'wait', 'wait_navigation', 'extract', 'focus', 'hover',
    'dblclick', 'rightclick', 'assert', 'if', 'export',
    'visual_locate', 'visual_click', 'visual_type',
  ]);
  if (!validTypes.has(type)) {
    return { valid: false, errors: [`${path}.type "${type}" is not a valid step type`] };
  }

  // 类型专属校验
  switch (type) {
    case 'navigate': {
      if (typeof s.url !== 'string' || s.url.length === 0) {
        errors.push(`${path}.url is required and must be a non-empty string`);
      }
      break;
    }
    case 'click':
    case 'focus':
    case 'hover':
    case 'dblclick':
    case 'rightclick': {
      if (typeof s.selector !== 'string' || s.selector.length === 0) {
        errors.push(`${path}.selector is required and must be a non-empty string`);
      }
      break;
    }
    case 'type':
    case 'select': {
      if (typeof s.selector !== 'string' || s.selector.length === 0) {
        errors.push(`${path}.selector is required and must be a non-empty string`);
      }
      if (typeof s.text !== 'string') {
        errors.push(`${path}.text is required and must be a string`);
      }
      break;
    }
    case 'wait': {
      if (typeof s.timeout !== 'number' || s.timeout < 0) {
        errors.push(`${path}.timeout is required and must be a non-negative number`);
      }
      break;
    }
    case 'keypress': {
      if (typeof s.key !== 'string' || s.key.length === 0) {
        errors.push(`${path}.key is required and must be a non-empty string`);
      }
      break;
    }
    case 'extract': {
      if (typeof s.selector !== 'string' || s.selector.length === 0) {
        errors.push(`${path}.selector is required and must be a non-empty string`);
      }
      if (typeof s.toVariable !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s.toVariable)) {
        errors.push(`${path}.toVariable is required and must be a valid variable name`);
      }
      break;
    }
    case 'assert': {
      if (!['exists', 'not_exists', 'contains', 'eq', 'gt', 'lt'].includes(s.operator as string)) {
        errors.push(`${path}.operator must be one of: exists, not_exists, contains, eq, gt, lt`);
      }
      if (!s.selector && !s.variable) {
        errors.push(`${path} requires either selector or variable`);
      }
      break;
    }
    case 'if': {
      if (!s.condition || typeof s.condition !== 'object') {
        errors.push(`${path}.condition is required and must be an object`);
      } else {
        const c = s.condition as Record<string, unknown>;
        if (typeof c.variable !== 'string') {
          errors.push(`${path}.condition.variable is required`);
        }
        if (!['eq', 'ne', 'contains', 'gt', 'lt'].includes(c.operator as string)) {
          errors.push(`${path}.condition.operator must be one of: eq, ne, contains, gt, lt`);
        }
      }
      if (!Array.isArray(s.thenSteps)) {
        errors.push(`${path}.thenSteps is required and must be an array`);
      } else {
        for (let i = 0; i < s.thenSteps.length; i++) {
          const r = validateStepLoose(s.thenSteps[i], `${path}.thenSteps[${i}]`);
          if (!r.valid) errors.push(...r.errors);
        }
      }
      if (s.elseSteps !== undefined) {
        if (!Array.isArray(s.elseSteps)) {
          errors.push(`${path}.elseSteps must be an array`);
        } else {
          for (let i = 0; i < s.elseSteps.length; i++) {
            const r = validateStepLoose(s.elseSteps[i], `${path}.elseSteps[${i}]`);
            if (!r.valid) errors.push(...r.errors);
          }
        }
      }
      break;
    }
    case 'export': {
      if (!['clipboard', 'csv', 'json'].includes(s.destination as string)) {
        errors.push(`${path}.destination must be one of: clipboard, csv, json`);
      }
      break;
    }
    case 'visual_locate': {
      if (typeof s.description !== 'string' || s.description.length === 0) {
        errors.push(`${path}.description is required and must be a non-empty string`);
      }
      if (typeof s.toVariable !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s.toVariable)) {
        errors.push(`${path}.toVariable is required and must be a valid variable name`);
      }
      break;
    }
    case 'visual_click': {
      if (typeof s.description !== 'string' || s.description.length === 0) {
        errors.push(`${path}.description is required and must be a non-empty string`);
      }
      break;
    }
    case 'visual_type': {
      if (typeof s.description !== 'string' || s.description.length === 0) {
        errors.push(`${path}.description is required and must be a non-empty string`);
      }
      if (typeof s.text !== 'string') {
        errors.push(`${path}.text is required and must be a string`);
      }
      break;
    }
    default:
      break;
  }

  return { valid: errors.length === 0, errors };
}

/** 验证完整 Workflow 对象（返回结构化错误，不抛异常） */
export function validateWorkflowLoose(wf: unknown): ValidationResult {
  const errors: string[] = [];
  if (!wf || typeof wf !== 'object') {
    return { valid: false, errors: ['Workflow must be an object'] };
  }
  const w = wf as Record<string, unknown>;

  if (typeof w.id !== 'string' || w.id.length === 0) {
    errors.push('id is required and must be a non-empty string');
  }
  if (typeof w.name !== 'string' || w.name.trim().length === 0) {
    errors.push('name is required and must be a non-empty string');
  }
  if (!Array.isArray(w.steps)) {
    errors.push('steps is required and must be an array');
  } else {
    for (let i = 0; i < w.steps.length; i++) {
      const r = validateStepLoose(w.steps[i], `steps[${i}]`);
      if (!r.valid) errors.push(...r.errors);
    }
  }
  if (typeof w.createdAt !== 'number') {
    errors.push('createdAt is required and must be a number');
  }
  if (typeof w.updatedAt !== 'number') {
    errors.push('updatedAt is required and must be a number');
  }
  if (typeof w.runCount !== 'number') {
    errors.push('runCount is required and must be a number');
  }

  // 触发器校验（可选）
  if (w.trigger !== undefined) {
    if (typeof w.trigger !== 'object' || w.trigger === null) {
      errors.push('trigger must be an object');
    } else {
      const t = w.trigger as Record<string, unknown>;
      if (!['manual', 'cron', 'url', 'dom'].includes(t.type as string)) {
        errors.push('trigger.type must be one of: manual, cron, url, dom');
      }
      if (t.type === 'cron' && (!t.config || typeof (t.config as Record<string, unknown>).expression !== 'string')) {
        errors.push('trigger.config.expression is required for cron trigger');
      }
      if (t.type === 'url' && (!t.config || typeof (t.config as Record<string, unknown>).pattern !== 'string')) {
        errors.push('trigger.config.pattern is required for url trigger');
      }
      if (t.type === 'dom' && (!t.config || typeof (t.config as Record<string, unknown>).selector !== 'string')) {
        errors.push('trigger.config.selector is required for dom trigger');
      }
    }
  }

  // 变量名校验
  if (w.variables !== undefined) {
    if (typeof w.variables !== 'object' || w.variables === null) {
      errors.push('variables must be an object');
    } else {
      for (const [k, v] of Object.entries(w.variables as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          errors.push(`variables["${k}"] must be a string`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 清理并规范化导入的 Workflow（移除未知字段、填充默认值） */
export function sanitizeWorkflow(raw: unknown): Workflow | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;

  const steps: WorkflowStep[] = [];
  if (Array.isArray(r.steps)) {
    for (const s of r.steps) {
      const step = sanitizeStep(s);
      if (step) steps.push(step);
    }
  }

  const trigger = sanitizeTrigger(r.trigger);

  const now = Date.now();
  return {
    id: typeof r.id === 'string' && r.id.length > 0 ? r.id : crypto.randomUUID(),
    name: typeof r.name === 'string' && r.name.length > 0 ? r.name : 'Untitled Workflow',
    description: typeof r.description === 'string' ? r.description : undefined,
    steps,
    trigger,
    variables: sanitizeVariables(r.variables),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
    runCount: typeof r.runCount === 'number' ? r.runCount : 0,
    lastRunAt: typeof r.lastRunAt === 'number' ? r.lastRunAt : undefined,
    lastRunStatus: ['success', 'failure', 'cancelled'].includes(r.lastRunStatus as string)
      ? (r.lastRunStatus as 'success' | 'failure' | 'cancelled')
      : undefined,
  };
}

function sanitizeStep(raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const type = s.type;
  if (typeof type !== 'string') return null;

  const base = { type } as Record<string, unknown>;

  switch (type) {
    case 'navigate': {
      if (typeof s.url !== 'string') return null;
      base.url = s.url;
      if (typeof s.waitFor === 'string') base.waitFor = s.waitFor;
      return base as WorkflowStep;
    }
    case 'click': {
      if (typeof s.selector !== 'string') return null;
      base.selector = s.selector;
      if (typeof s.timeout === 'number') base.timeout = s.timeout;
      return base as WorkflowStep;
    }
    case 'type': {
      if (typeof s.selector !== 'string' || typeof s.text !== 'string') return null;
      base.selector = s.selector;
      base.text = s.text;
      if (typeof s.clear === 'boolean') base.clear = s.clear;
      if (typeof s.timeout === 'number') base.timeout = s.timeout;
      return base as WorkflowStep;
    }
    case 'select': {
      if (typeof s.selector !== 'string' || typeof s.text !== 'string') return null;
      base.selector = s.selector;
      base.text = s.text;
      if (typeof s.timeout === 'number') base.timeout = s.timeout;
      return base as WorkflowStep;
    }
    case 'scroll': {
      if (typeof s.selector === 'string') base.selector = s.selector;
      if (typeof s.deltaX === 'number') base.deltaX = s.deltaX;
      if (typeof s.deltaY === 'number') base.deltaY = s.deltaY;
      return base as WorkflowStep;
    }
    case 'keypress': {
      if (typeof s.key !== 'string') return null;
      base.key = s.key;
      if (typeof s.selector === 'string') base.selector = s.selector;
      if (Array.isArray(s.modifiers)) base.modifiers = s.modifiers.filter((m) => ['ctrl', 'shift', 'alt', 'meta'].includes(m as string));
      return base as WorkflowStep;
    }
    case 'wait': {
      if (typeof s.timeout !== 'number') return null;
      base.timeout = s.timeout;
      if (typeof s.selector === 'string') base.selector = s.selector;
      return base as WorkflowStep;
    }
    case 'wait_navigation': {
      if (typeof s.timeout === 'number') base.timeout = s.timeout;
      return base as WorkflowStep;
    }
    case 'extract': {
      if (typeof s.selector !== 'string' || typeof s.toVariable !== 'string') return null;
      base.selector = s.selector;
      base.toVariable = s.toVariable;
      if (typeof s.attribute === 'string') base.attribute = s.attribute;
      return base as WorkflowStep;
    }
    case 'focus':
    case 'hover':
    case 'dblclick':
    case 'rightclick': {
      if (typeof s.selector !== 'string') return null;
      base.selector = s.selector;
      return base as WorkflowStep;
    }
    case 'assert': {
      if (!['exists', 'not_exists', 'contains', 'eq', 'gt', 'lt'].includes(s.operator as string)) return null;
      base.operator = s.operator;
      if (typeof s.selector === 'string') base.selector = s.selector;
      if (typeof s.variable === 'string') base.variable = s.variable;
      if (s.value !== undefined) base.value = s.value;
      if (typeof s.timeout === 'number') base.timeout = s.timeout;
      return base as WorkflowStep;
    }
    case 'if': {
      if (!s.condition || typeof s.condition !== 'object') return null;
      const c = s.condition as Record<string, unknown>;
      if (typeof c.variable !== 'string' || !['eq', 'ne', 'contains', 'gt', 'lt'].includes(c.operator as string)) return null;
      base.condition = {
        variable: c.variable,
        operator: c.operator,
        value: typeof c.value === 'string' || typeof c.value === 'number' ? c.value : String(c.value ?? ''),
      };
      if (Array.isArray(s.thenSteps)) {
        base.thenSteps = s.thenSteps.map(sanitizeStep).filter(Boolean) as WorkflowStep[];
      } else {
        base.thenSteps = [];
      }
      if (Array.isArray(s.elseSteps)) {
        base.elseSteps = s.elseSteps.map(sanitizeStep).filter(Boolean) as WorkflowStep[];
      }
      return base as WorkflowStep;
    }
    case 'export': {
      if (!['clipboard', 'csv', 'json'].includes(s.destination as string)) return null;
      base.destination = s.destination;
      if (Array.isArray(s.variables)) base.variables = s.variables.filter((v) => typeof v === 'string') as string[];
      if (typeof s.filename === 'string') base.filename = s.filename;
      return base as WorkflowStep;
    }
    case 'visual_locate': {
      if (typeof s.description !== 'string') return null;
      base.description = s.description;
      if (typeof s.toVariable === 'string') base.toVariable = s.toVariable;
      if (typeof s.quality === 'number') base.quality = s.quality;
      return base as WorkflowStep;
    }
    case 'visual_click': {
      if (typeof s.description !== 'string') return null;
      base.description = s.description;
      if (typeof s.quality === 'number') base.quality = s.quality;
      return base as WorkflowStep;
    }
    case 'visual_type': {
      if (typeof s.description !== 'string' || typeof s.text !== 'string') return null;
      base.description = s.description;
      base.text = s.text;
      if (typeof s.quality === 'number') base.quality = s.quality;
      if (typeof s.clear === 'boolean') base.clear = s.clear;
      return base as WorkflowStep;
    }
    default:
      return null;
  }
}

function sanitizeTrigger(raw: unknown): WorkflowTrigger | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  const type = t.type;
  if (typeof type !== 'string' || !['manual', 'cron', 'url', 'dom'].includes(type)) return undefined;

  const trigger: WorkflowTrigger = { type: type as WorkflowTrigger['type'] };
  if (typeof t.config === 'object' && t.config !== null) {
    trigger.config = t.config as WorkflowTrigger['config'];
  }
  return trigger;
}

function sanitizeVariables(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') result[k] = v;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
