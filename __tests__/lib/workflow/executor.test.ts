import { describe, it, expect } from 'vitest';
import type { Workflow, WorkflowStep } from '@/lib/workflow/types';
import { describeStep, STEP_TYPE_LABELS } from '@/lib/workflow/types';

// ─── describeStep ───

describe('describeStep', () => {
  it('describes assert step with selector', () => {
    const step: WorkflowStep = {
      type: 'assert',
      selector: '#msg',
      operator: 'contains',
      value: 'success',
    };
    expect(describeStep(step)).toBe('Assert #msg contains success');
  });

  it('describes assert step with variable', () => {
    const step: WorkflowStep = {
      type: 'assert',
      variable: 'price',
      operator: 'gt',
      value: 100,
    };
    expect(describeStep(step)).toBe('Assert ${price} gt 100');
  });

  it('describes assert exists without value', () => {
    const step: WorkflowStep = {
      type: 'assert',
      selector: '#btn',
      operator: 'exists',
    };
    expect(describeStep(step)).toBe('Assert #btn exists');
  });

  it('describes if step with then branch only', () => {
    const step: WorkflowStep = {
      type: 'if',
      condition: { variable: 'status', operator: 'eq', value: 'ok' },
      thenSteps: [
        { type: 'click', selector: '#btn' },
        { type: 'wait', timeout: 1000 },
      ],
    };
    expect(describeStep(step)).toBe('If ${status} eq ok (2 steps)');
  });

  it('describes if step with else branch', () => {
    const step: WorkflowStep = {
      type: 'if',
      condition: { variable: 'loggedIn', operator: 'eq', value: 'true' },
      thenSteps: [{ type: 'click', selector: '#profile' }],
      elseSteps: [{ type: 'click', selector: '#login' }],
    };
    expect(describeStep(step)).toBe('If ${loggedIn} eq true (1 steps, else 1)');
  });
});

// ─── STEP_TYPE_LABELS ───

describe('STEP_TYPE_LABELS', () => {
  it('includes assert label', () => {
    expect(STEP_TYPE_LABELS.assert).toBe('Assert');
  });

  it('includes if label', () => {
    expect(STEP_TYPE_LABELS.if).toBe('If');
  });
});

// ─── Workflow with nested steps serialization ───

describe('Workflow serialization round-trip', () => {
  it('can stringify and parse workflow with if and assert steps', () => {
    const workflow: Workflow = {
      id: 'wf-test',
      name: 'Test Workflow',
      steps: [
        {
          type: 'if',
          condition: { variable: 'x', operator: 'eq', value: '1' },
          thenSteps: [
            { type: 'assert', selector: '#a', operator: 'exists' },
            { type: 'click', selector: '#a' },
          ],
          elseSteps: [
            { type: 'navigate', url: 'https://example.com' },
          ],
        },
        {
          type: 'assert',
          variable: 'result',
          operator: 'contains',
          value: 'done',
        },
      ],
      trigger: { type: 'manual' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
    };

    const json = JSON.stringify(workflow);
    const parsed = JSON.parse(json) as Workflow;

    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0].type).toBe('if');
    expect((parsed.steps[0] as Extract<WorkflowStep, { type: 'if' }>).thenSteps).toHaveLength(2);
    expect((parsed.steps[0] as Extract<WorkflowStep, { type: 'if' }>).elseSteps).toHaveLength(1);
    expect(parsed.steps[1].type).toBe('assert');
  });
});
