/**
 * Workflow Repository — 基于 Dexie 的 CRUD 与查询层。
 *
 * 所有操作均为异步，错误以抛出异常的形式传递。
 * 调用方应自行处理 Dexie/DOMException。
 */

import { getDb, type FlatWorkflow } from '../db';
import type { Workflow, WorkflowStep, WorkflowRunStatus, WorkflowRunRecord, WorkflowRunStepRecord, WorkflowRunState } from './types';

// ─── 验证 ───

class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

function assertString(val: unknown, field: string): asserts val is string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new WorkflowValidationError(`${field} must be a non-empty string`);
  }
}

function assertArray(val: unknown, field: string): asserts val is unknown[] {
  if (!Array.isArray(val)) {
    throw new WorkflowValidationError(`${field} must be an array`);
  }
}

function assertStep(step: unknown): asserts step is WorkflowStep {
  if (typeof step !== 'object' || step === null) {
    throw new WorkflowValidationError('Step must be an object');
  }
  const s = step as Record<string, unknown>;
  if (typeof s.type !== 'string') {
    throw new WorkflowValidationError('Step must have a type field');
  }
  const validTypes = new Set([
    'navigate', 'click', 'type', 'select', 'scroll', 'keypress',
    'wait', 'wait_navigation', 'extract', 'focus', 'hover', 'dblclick', 'rightclick',
    'assert', 'if', 'export',
  ]);
  if (!validTypes.has(s.type)) {
    throw new WorkflowValidationError(`Unknown step type: ${s.type}`);
  }

  // 递归验证 if 步骤的子步骤
  if (s.type === 'if') {
    if (typeof s.condition !== 'object' || s.condition === null) {
      throw new WorkflowValidationError('If step must have a condition object');
    }
    const cond = s.condition as Record<string, unknown>;
    if (typeof cond.variable !== 'string') {
      throw new WorkflowValidationError('If step condition must have a variable string');
    }
    const validOps = new Set(['eq', 'ne', 'contains', 'gt', 'lt']);
    if (typeof cond.operator !== 'string' || !validOps.has(cond.operator)) {
      throw new WorkflowValidationError(`If step condition operator invalid: ${cond.operator}`);
    }

    if (!Array.isArray(s.thenSteps)) {
      throw new WorkflowValidationError('If step must have a thenSteps array');
    }
    s.thenSteps.forEach((subStep: unknown, idx: number) => {
      try {
        assertStep(subStep);
      } catch (e) {
        throw new WorkflowValidationError(`If.thenSteps[${idx}] invalid: ${(e as Error).message}`);
      }
    });

    if (s.elseSteps !== undefined) {
      if (!Array.isArray(s.elseSteps)) {
        throw new WorkflowValidationError('If step elseSteps must be an array');
      }
      s.elseSteps.forEach((subStep: unknown, idx: number) => {
        try {
          assertStep(subStep);
        } catch (e) {
          throw new WorkflowValidationError(`If.elseSteps[${idx}] invalid: ${(e as Error).message}`);
        }
      });
    }
  }

  // 校验 assert 操作符
  if (s.type === 'assert') {
    const validAssertOps = new Set(['exists', 'not_exists', 'contains', 'eq', 'gt', 'lt']);
    if (typeof s.operator !== 'string' || !validAssertOps.has(s.operator)) {
      throw new WorkflowValidationError(`Assert operator invalid: ${s.operator}`);
    }
  }

  // 校验 export 目标
  if (s.type === 'export') {
    const validDestinations = new Set(['clipboard', 'csv', 'json']);
    if (typeof s.destination !== 'string' || !validDestinations.has(s.destination)) {
      throw new WorkflowValidationError(`Export destination invalid: ${s.destination}`);
    }
    if (s.variables !== undefined && !Array.isArray(s.variables)) {
      throw new WorkflowValidationError('Export variables must be an array of strings');
    }
  }
}

function toFlat(w: Workflow): import('../db').FlatWorkflow {
  return w as import('../db').FlatWorkflow;
}

function fromFlat(w: import('../db').FlatWorkflow): Workflow {
  return w as Workflow;
}

/** Validates Workflow structural integrity */
export function validateWorkflow(workflow: unknown): asserts workflow is Workflow {
  if (typeof workflow !== 'object' || workflow === null) {
    throw new WorkflowValidationError('Workflow must be an object');
  }
  const w = workflow as Record<string, unknown>;

  assertString(w.id, 'id');
  assertString(w.name, 'name');
  assertArray(w.steps, 'steps');
  w.steps.forEach((step, idx) => {
    try {
      assertStep(step);
    } catch (e) {
      throw new WorkflowValidationError(`Step[${idx}] invalid: ${(e as Error).message}`);
    }
  });

  if (typeof w.createdAt !== 'number' || w.createdAt <= 0) {
    throw new WorkflowValidationError('createdAt must be a positive integer timestamp');
  }
  if (typeof w.updatedAt !== 'number' || w.updatedAt <= 0) {
    throw new WorkflowValidationError('updatedAt must be a positive integer timestamp');
  }
  if (typeof w.runCount !== 'number' || w.runCount < 0) {
    throw new WorkflowValidationError('runCount must be a non-negative integer');
  }
}

// ─── CRUD ───

export async function createWorkflow(workflow: Workflow): Promise<void> {
  validateWorkflow(workflow);
  await getDb().workflows.add(toFlat(workflow));
}

export async function getWorkflow(id: string): Promise<Workflow | undefined> {
  if (!id) throw new WorkflowValidationError('id cannot be empty');
  const w = await getDb().workflows.get(id);
  return w ? fromFlat(w) : undefined;
}

export async function listWorkflows(): Promise<Workflow[]> {
  const items = await getDb().workflows.orderBy('updatedAt').reverse().toArray();
  return items.map(fromFlat);
}

export async function updateWorkflow(
  id: string,
  changes: Partial<Omit<Workflow, 'id' | 'createdAt'>>,
): Promise<void> {
  if (!id) throw new WorkflowValidationError('id cannot be empty');
  if (changes.steps) {
    assertArray(changes.steps, 'steps');
    changes.steps.forEach((step, idx) => {
      try {
        assertStep(step);
      } catch (e) {
        throw new WorkflowValidationError(`Step[${idx}] invalid: ${(e as Error).message}`);
      }
    });
  }
  await getDb().workflows.update(id, { ...changes, updatedAt: Date.now() } as Partial<FlatWorkflow>);
}

export async function deleteWorkflow(id: string): Promise<void> {
  if (!id) throw new WorkflowValidationError('id cannot be empty');
  await getDb().workflows.delete(id);
}

// ─── 运行状态更新 ───

export async function recordWorkflowRun(
  id: string,
  status: Extract<WorkflowRunStatus, 'success' | 'failure' | 'cancelled'>,
): Promise<void> {
  if (!id) throw new WorkflowValidationError('id cannot be empty');
  const workflow = await getDb().workflows.get(id);
  if (!workflow) throw new WorkflowValidationError(`Workflow ${id} does not exist`);

  await getDb().workflows.update(id, {
    runCount: workflow.runCount + 1,
    lastRunAt: Date.now(),
    lastRunStatus: status,
  } as Partial<FlatWorkflow>);
}

// ─── 查询辅助 ───

export async function searchWorkflows(query: string): Promise<Workflow[]> {
  const q = query.trim().toLowerCase();
  if (!q) return listWorkflows();
  const all = await getDb().workflows.toArray();
  return all
    .filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.description ?? '').toLowerCase().includes(q),
    )
    .map(fromFlat);
}

export async function getMostUsedWorkflows(limit = 5): Promise<Workflow[]> {
  const items = await getDb().workflows.orderBy('runCount').reverse().limit(limit).toArray();
  return items.map(fromFlat);
}

// ─── WorkflowRun 历史记录 ───

export async function createWorkflowRun(record: WorkflowRunRecord): Promise<void> {
  await getDb().workflowRuns.add(record);
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunRecord | undefined> {
  return getDb().workflowRuns.get(id);
}

export async function listWorkflowRuns(workflowId?: string): Promise<WorkflowRunRecord[]> {
  if (workflowId) {
    return getDb().workflowRuns.where('workflowId').equals(workflowId).sortBy('startedAt');
  }
  return getDb().workflowRuns.orderBy('startedAt').reverse().toArray();
}

export async function deleteWorkflowRun(id: string): Promise<void> {
  await getDb().workflowRuns.delete(id);
}

export async function clearWorkflowRuns(workflowId: string): Promise<void> {
  const runs = await getDb().workflowRuns.where('workflowId').equals(workflowId).primaryKeys();
  await getDb().workflowRuns.bulkDelete(runs);
}

// ─── WorkflowRunState (runtime resumable state) ───

export async function createRunState(state: WorkflowRunState): Promise<void> {
  await getDb().workflowRunStates.add(state);
}

export async function getRunState(runId: string): Promise<WorkflowRunState | undefined> {
  return getDb().workflowRunStates.get(runId);
}

export async function updateRunState(
  runId: string,
  changes: Partial<Omit<WorkflowRunState, 'runId'>>,
): Promise<void> {
  await getDb().workflowRunStates.update(runId, changes);
}

export async function deleteRunState(runId: string): Promise<void> {
  await getDb().workflowRunStates.delete(runId);
}

export async function listRunningStates(): Promise<WorkflowRunState[]> {
  return getDb().workflowRunStates.where('status').equals('running').toArray();
}
