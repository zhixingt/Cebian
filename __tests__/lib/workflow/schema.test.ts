/**
 * Workflow Schema 验证器测试
 */
import { describe, it, expect } from 'vitest';
import {
  validateStepLoose,
  validateWorkflowLoose,
  sanitizeWorkflow,
  WORKFLOW_SCHEMA,
} from '@/lib/workflow/schema';
import type { Workflow, WorkflowStep } from '@/lib/workflow/types';

describe('validateStepLoose', () => {
  it('accepts valid navigate step', () => {
    const result = validateStepLoose({ type: 'navigate', url: 'https://example.com' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects navigate step without url', () => {
    const result = validateStepLoose({ type: 'navigate' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('url');
  });

  it('accepts valid click step', () => {
    const result = validateStepLoose({ type: 'click', selector: '#btn' });
    expect(result.valid).toBe(true);
  });

  it('rejects click step without selector', () => {
    const result = validateStepLoose({ type: 'click' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('selector');
  });

  it('accepts valid type step', () => {
    const result = validateStepLoose({ type: 'type', selector: '#input', text: 'hello' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid extract step with valid variable name', () => {
    const result = validateStepLoose({ type: 'extract', selector: 'h1', toVariable: 'title' });
    expect(result.valid).toBe(true);
  });

  it('rejects extract step with invalid variable name', () => {
    const result = validateStepLoose({ type: 'extract', selector: 'h1', toVariable: '123invalid' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('toVariable');
  });

  it('accepts valid assert step with selector', () => {
    const result = validateStepLoose({ type: 'assert', selector: '#msg', operator: 'exists' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid assert step with variable', () => {
    const result = validateStepLoose({ type: 'assert', variable: 'price', operator: 'gt', value: 100 });
    expect(result.valid).toBe(true);
  });

  it('rejects assert step without selector or variable', () => {
    const result = validateStepLoose({ type: 'assert', operator: 'exists' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('selector or variable');
  });

  it('accepts valid if step with nested steps', () => {
    const result = validateStepLoose({
      type: 'if',
      condition: { variable: 'loggedIn', operator: 'eq', value: 'true' },
      thenSteps: [{ type: 'click', selector: '#profile' }],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects if step with invalid nested step', () => {
    const result = validateStepLoose({
      type: 'if',
      condition: { variable: 'x', operator: 'eq', value: '1' },
      thenSteps: [{ type: 'click' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('thenSteps[0]');
  });

  it('accepts valid export step', () => {
    const result = validateStepLoose({ type: 'export', destination: 'csv', filename: 'data.csv' });
    expect(result.valid).toBe(true);
  });

  it('rejects unknown step type', () => {
    const result = validateStepLoose({ type: 'unknown' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not a valid step type');
  });
});

describe('validateWorkflowLoose', () => {
  const minimalWorkflow = {
    id: 'wf-1',
    name: 'Test Workflow',
    steps: [{ type: 'navigate', url: 'https://example.com' }],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    runCount: 0,
  };

  it('accepts valid minimal workflow', () => {
    const result = validateWorkflowLoose(minimalWorkflow);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects workflow without id', () => {
    const result = validateWorkflowLoose({ ...minimalWorkflow, id: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('id');
  });

  it('rejects workflow without name', () => {
    const result = validateWorkflowLoose({ ...minimalWorkflow, name: '' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('name');
  });

  it('rejects workflow with invalid step', () => {
    const result = validateWorkflowLoose({
      ...minimalWorkflow,
      steps: [{ type: 'click' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('steps[0]');
  });

  it('validates trigger config for cron trigger', () => {
    const result = validateWorkflowLoose({
      ...minimalWorkflow,
      trigger: { type: 'cron' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('expression');
  });

  it('validates trigger config for url trigger', () => {
    const result = validateWorkflowLoose({
      ...minimalWorkflow,
      trigger: { type: 'url' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('pattern');
  });

  it('validates trigger config for dom trigger', () => {
    const result = validateWorkflowLoose({
      ...minimalWorkflow,
      trigger: { type: 'dom' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('selector');
  });

  it('accepts valid cron trigger', () => {
    const result = validateWorkflowLoose({
      ...minimalWorkflow,
      trigger: { type: 'cron', config: { expression: '0 9 * * *' } },
    });
    expect(result.valid).toBe(true);
  });

  it('validates variables are strings', () => {
    const result = validateWorkflowLoose({
      ...minimalWorkflow,
      variables: { keyword: 123 as unknown as string },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('variables');
  });
});

describe('sanitizeWorkflow', () => {
  it('returns null for non-object input', () => {
    expect(sanitizeWorkflow(null)).toBeNull();
    expect(sanitizeWorkflow('string')).toBeNull();
  });

  it('sanitizes minimal valid workflow', () => {
    const raw = {
      id: 'wf-1',
      name: 'Test',
      steps: [{ type: 'navigate', url: 'https://example.com' }],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      runCount: 0,
    };
    const result = sanitizeWorkflow(raw);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Test');
    expect(result!.steps).toHaveLength(1);
  });

  it('generates new id for empty id', () => {
    const raw = {
      id: '',
      name: 'Test',
      steps: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      runCount: 0,
    };
    const result = sanitizeWorkflow(raw);
    expect(result).not.toBeNull();
    expect(result!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('filters out invalid steps', () => {
    const raw = {
      id: 'wf-1',
      name: 'Test',
      steps: [
        { type: 'click', selector: '#btn' },
        { type: 'invalid' },
        { type: 'click' },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      runCount: 0,
    };
    const result = sanitizeWorkflow(raw);
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0].type).toBe('click');
  });

  it('sanitizes if step with nested steps', () => {
    const raw = {
      id: 'wf-1',
      name: 'Test',
      steps: [
        {
          type: 'if',
          condition: { variable: 'x', operator: 'eq', value: '1' },
          thenSteps: [{ type: 'click', selector: '#a' }],
          elseSteps: [{ type: 'invalid' }],
        },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      runCount: 0,
    };
    const result = sanitizeWorkflow(raw);
    expect(result!.steps).toHaveLength(1);
    const ifStep = result!.steps[0] as Extract<WorkflowStep, { type: 'if' }>;
    expect(ifStep.thenSteps).toHaveLength(1);
    expect(ifStep.elseSteps).toHaveLength(0);
  });

  it('fills defaults for missing fields', () => {
    const raw = {
      name: 'Test',
      steps: [],
    };
    const result = sanitizeWorkflow(raw);
    expect(result).not.toBeNull();
    expect(result!.runCount).toBe(0);
    expect(result!.createdAt).toBeGreaterThan(0);
  });

  it('preserves lastRunStatus if valid', () => {
    const raw = {
      id: 'wf-1',
      name: 'Test',
      steps: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      runCount: 5,
      lastRunStatus: 'success',
    };
    const result = sanitizeWorkflow(raw);
    expect(result!.lastRunStatus).toBe('success');
    expect(result!.runCount).toBe(5);
  });

  it('discards invalid lastRunStatus', () => {
    const raw = {
      id: 'wf-1',
      name: 'Test',
      steps: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      runCount: 0,
      lastRunStatus: 'unknown',
    };
    const result = sanitizeWorkflow(raw);
    expect(result!.lastRunStatus).toBeUndefined();
  });
});

describe('WORKFLOW_SCHEMA', () => {
  it('is a valid JSON Schema draft-07 object', () => {
    expect(WORKFLOW_SCHEMA.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(WORKFLOW_SCHEMA.type).toBe('object');
    expect(WORKFLOW_SCHEMA.required).toContain('id');
    expect(WORKFLOW_SCHEMA.required).toContain('name');
    expect(WORKFLOW_SCHEMA.required).toContain('steps');
  });

  it('has step schema with all 19 step types', () => {
    const stepSchema = (WORKFLOW_SCHEMA.properties.steps as Record<string, unknown>).items as Record<string, unknown>;
    const stepProps = stepSchema.properties as Record<string, unknown> | undefined;
    const typeProp = stepProps?.type as Record<string, unknown> | undefined;
    const types = typeProp?.enum as string[] | undefined;
    expect(types).toBeDefined();
    expect(types!).toHaveLength(19);
    expect(types!).toContain('navigate');
    expect(types!).toContain('if');
    expect(types!).toContain('export');
    expect(types!).toContain('visual_locate');
    expect(types!).toContain('visual_click');
    expect(types!).toContain('visual_type');
  });
});
