import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import type { Workflow } from '@/lib/workflow/types';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  recordWorkflowRun,
  searchWorkflows,
  getMostUsedWorkflows,
  validateWorkflow,
} from '@/lib/workflow/repository';

// ─── 测试辅助 ───

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const now = Date.now();
  return {
    id: `wf-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: 'Test Workflow',
    description: 'For unit testing',
    steps: [
      { type: 'navigate', url: 'https://example.com' },
      { type: 'click', selector: '#btn' },
    ],
    trigger: { type: 'manual' },
    variables: { q: 'test' },
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    ...overrides,
  };
}

// ─── validateWorkflow ───

describe('validateWorkflow', () => {
  it('通过合法的 Workflow', () => {
    const wf = makeWorkflow();
    expect(() => validateWorkflow(wf)).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => validateWorkflow(null)).toThrow('Workflow must be an object');
  });

  it('rejects empty object', () => {
    expect(() => validateWorkflow({})).toThrow('id must be a non-empty string');
  });

  it('rejects empty id', () => {
    const wf = makeWorkflow({ id: '' });
    expect(() => validateWorkflow(wf)).toThrow('id must be a non-empty string');
  });

  it('rejects empty name', () => {
    const wf = makeWorkflow({ name: '  ' });
    expect(() => validateWorkflow(wf)).toThrow('name must be a non-empty string');
  });

  it('rejects non-array steps', () => {
    const wf = makeWorkflow({ steps: 'bad' as any });
    expect(() => validateWorkflow(wf)).toThrow('steps must be an array');
  });

  it('rejects invalid step type', () => {
    const wf = makeWorkflow({ steps: [{ type: 'fly' } as any] });
    expect(() => validateWorkflow(wf)).toThrow('Unknown step type: fly');
  });

  it('rejects step missing type', () => {
    const wf = makeWorkflow({ steps: [{ selector: '#x' } as any] });
    expect(() => validateWorkflow(wf)).toThrow('Step must have a type field');
  });

  it('accepts assert step with valid operator', () => {
    const wf = makeWorkflow({
      steps: [{ type: 'assert', selector: '#msg', operator: 'contains', value: 'ok' }],
    });
    expect(() => validateWorkflow(wf)).not.toThrow();
  });

  it('rejects assert step with invalid operator', () => {
    const wf = makeWorkflow({
      steps: [{ type: 'assert', selector: '#msg', operator: 'fly' } as any],
    });
    expect(() => validateWorkflow(wf)).toThrow('Assert operator invalid: fly');
  });

  it('accepts if step with nested steps', () => {
    const wf = makeWorkflow({
      steps: [
        {
          type: 'if',
          condition: { variable: 'x', operator: 'eq', value: '1' },
          thenSteps: [{ type: 'click', selector: '#a' }],
          elseSteps: [{ type: 'navigate', url: 'https://example.com' }],
        },
      ],
    });
    expect(() => validateWorkflow(wf)).not.toThrow();
  });

  it('rejects if step with invalid nested step', () => {
    const wf = makeWorkflow({
      steps: [
        {
          type: 'if',
          condition: { variable: 'x', operator: 'eq', value: '1' },
          thenSteps: [{ type: 'fly' } as any],
        },
      ],
    });
    expect(() => validateWorkflow(wf)).toThrow('If.thenSteps[0] invalid: Unknown step type: fly');
  });

  it('rejects if step with invalid condition operator', () => {
    const wf = makeWorkflow({
      steps: [
        {
          type: 'if',
          condition: { variable: 'x', operator: 'fly' as any, value: '1' },
          thenSteps: [],
        },
      ],
    });
    expect(() => validateWorkflow(wf)).toThrow('If step condition operator invalid: fly');
  });

  it('rejects if step missing thenSteps', () => {
    const wf = makeWorkflow({
      steps: [
        {
          type: 'if',
          condition: { variable: 'x', operator: 'eq', value: '1' },
        } as any,
      ],
    });
    expect(() => validateWorkflow(wf)).toThrow('If step must have a thenSteps array');
  });

  it('rejects negative createdAt', () => {
    const wf = makeWorkflow({ createdAt: -1 });
    expect(() => validateWorkflow(wf)).toThrow('createdAt must be a positive integer timestamp');
  });

  it('rejects negative runCount', () => {
    const wf = makeWorkflow({ runCount: -1 });
    expect(() => validateWorkflow(wf)).toThrow('runCount must be a non-negative integer');
  });
});

// ─── CRUD ───

describe('Workflow CRUD', () => {
  beforeEach(async () => {
    await getDb().workflows.clear();
  });

  it('createWorkflow + getWorkflow', async () => {
    const wf = makeWorkflow({ id: 'wf-1', name: '登录流程' });
    await createWorkflow(wf);
    const fetched = await getWorkflow('wf-1');
    expect(fetched).toEqual(wf);
  });

  it('listWorkflows 按 updatedAt 倒序', async () => {
    const wf1 = makeWorkflow({ id: 'wf-1', updatedAt: 1000 });
    const wf2 = makeWorkflow({ id: 'wf-2', updatedAt: 3000 });
    const wf3 = makeWorkflow({ id: 'wf-3', updatedAt: 2000 });
    await createWorkflow(wf1);
    await createWorkflow(wf2);
    await createWorkflow(wf3);
    const list = await listWorkflows();
    expect(list.map((w) => w.id)).toEqual(['wf-2', 'wf-3', 'wf-1']);
  });

  it('updateWorkflow 更新 name 和 steps', async () => {
    const wf = makeWorkflow({ id: 'wf-1' });
    await createWorkflow(wf);
    await new Promise((r) => setTimeout(r, 2)); // 确保 updatedAt 变化
    await updateWorkflow('wf-1', {
      name: '新名称',
      steps: [{ type: 'navigate', url: 'https://new.com' }],
    });
    const fetched = await getWorkflow('wf-1');
    expect(fetched?.name).toBe('新名称');
    expect(fetched?.steps).toEqual([{ type: 'navigate', url: 'https://new.com' }]);
    expect(fetched?.updatedAt).toBeGreaterThan(wf.updatedAt);
  });

  it('updateWorkflow rejects invalid steps', async () => {
    const wf = makeWorkflow({ id: 'wf-1' });
    await createWorkflow(wf);
    await expect(
      updateWorkflow('wf-1', { steps: [{ type: 'fly' } as any] }),
    ).rejects.toThrow('Unknown step type: fly');
  });

  it('deleteWorkflow removes record', async () => {
    const wf = makeWorkflow({ id: 'wf-1' });
    await createWorkflow(wf);
    await deleteWorkflow('wf-1');
    const fetched = await getWorkflow('wf-1');
    expect(fetched).toBeUndefined();
  });

  it('duplicate id throws on create', async () => {
    const wf = makeWorkflow({ id: 'wf-dup' });
    await createWorkflow(wf);
    await expect(createWorkflow(wf)).rejects.toThrow();
  });

  it('empty id query throws', async () => {
    await expect(getWorkflow('')).rejects.toThrow('id cannot be empty');
  });
});

// ─── 运行状态 ───

describe('recordWorkflowRun', () => {
  beforeEach(async () => {
    await getDb().workflows.clear();
  });

  it('records run status successfully', async () => {
    const wf = makeWorkflow({ id: 'wf-1', runCount: 5 });
    await createWorkflow(wf);
    await recordWorkflowRun('wf-1', 'success');
    const fetched = await getWorkflow('wf-1');
    expect(fetched?.runCount).toBe(6);
    expect(fetched?.lastRunStatus).toBe('success');
    expect(fetched?.lastRunAt).toBeGreaterThan(0);
  });

  it('records failure status', async () => {
    const wf = makeWorkflow({ id: 'wf-1' });
    await createWorkflow(wf);
    await recordWorkflowRun('wf-1', 'failure');
    const fetched = await getWorkflow('wf-1');
    expect(fetched?.lastRunStatus).toBe('failure');
  });

  it('throws for non-existent workflow', async () => {
    await expect(recordWorkflowRun('wf-none', 'success')).rejects.toThrow(
      'Workflow wf-none does not exist',
    );
  });
});

// ─── 查询辅助 ───

describe('searchWorkflows', () => {
  beforeEach(async () => {
    await getDb().workflows.clear();
  });

  it('searches by name', async () => {
    await createWorkflow(makeWorkflow({ id: 'a', name: 'Login Flow' }));
    await createWorkflow(makeWorkflow({ id: 'b', name: 'Register Flow' }));
    await createWorkflow(makeWorkflow({ id: 'c', name: 'Data Analysis' }));
    const result = await searchWorkflows('Flow');
    expect(result.map((w) => w.id).sort()).toEqual(['a', 'b']);
  });

  it('searches by description', async () => {
    await createWorkflow(makeWorkflow({ id: 'a', name: 'X', description: 'Daily scheduled crawl' }));
    await createWorkflow(makeWorkflow({ id: 'b', name: 'Y', description: 'One-time task' }));
    const result = await searchWorkflows('scheduled');
    expect(result.map((w) => w.id)).toEqual(['a']);
  });

  it('empty query returns all', async () => {
    await createWorkflow(makeWorkflow({ id: 'a' }));
    await createWorkflow(makeWorkflow({ id: 'b' }));
    const result = await searchWorkflows('');
    expect(result).toHaveLength(2);
  });

  it('no match returns empty array', async () => {
    await createWorkflow(makeWorkflow({ id: 'a', name: 'Login' }));
    const result = await searchWorkflows('nonexistent');
    expect(result).toEqual([]);
  });
});

describe('getMostUsedWorkflows', () => {
  beforeEach(async () => {
    await getDb().workflows.clear();
  });

  it('sorts by runCount descending', async () => {
    await createWorkflow(makeWorkflow({ id: 'a', runCount: 3 }));
    await createWorkflow(makeWorkflow({ id: 'b', runCount: 10 }));
    await createWorkflow(makeWorkflow({ id: 'c', runCount: 5 }));
    const result = await getMostUsedWorkflows();
    expect(result.map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('limit restricts result count', async () => {
    await createWorkflow(makeWorkflow({ id: 'a', runCount: 1 }));
    await createWorkflow(makeWorkflow({ id: 'b', runCount: 2 }));
    await createWorkflow(makeWorkflow({ id: 'c', runCount: 3 }));
    const result = await getMostUsedWorkflows(2);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('c');
  });
});
