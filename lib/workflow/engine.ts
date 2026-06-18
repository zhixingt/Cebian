/**
 * Workflow Engine — Resumable execution with per-step persistence.
 *
 * MV3 Service Workers can be terminated at any time. This engine writes
 * the current run state to Dexie after every step so that on SW restart
 * we can detect incomplete runs and resume from the last completed step.
 */

import { executeWorkflow, type ExecutionResult, type ExecutorOptions } from './executor';
import type { Workflow, WorkflowRunState } from './types';
import {
  createRunState,
  updateRunState,
  getWorkflow,
} from './repository';

// ─── Public API ───

/**
 * Start a new workflow run with automatic state persistence.
 * Returns the execution result together with the generated runId.
 */
export async function startWorkflowRun(
  workflow: Workflow,
  options?: Pick<ExecutorOptions, 'tabId' | 'signal' | 'onStepStart' | 'onStepEnd' | 'variables'>,
): Promise<ExecutionResult & { runId: string }> {
  const runId = crypto.randomUUID();

  // 合并变量：workflow.variables < options.variables
  const variables = { ...workflow.variables, ...options?.variables };

  await createRunState({
    workflowId: workflow.id,
    runId,
    status: 'running',
    currentStepIndex: 0,
    variables,
    startedAt: Date.now(),
  });

  const result = await executeWorkflow(workflow, {
    ...options,
    variables,
    onStepStart: (_step, index) => {
      void updateRunState(runId, {
        currentStepIndex: index,
        status: 'running',
      });
    },
    onStepEnd: (_step, index, stepResult) => {
      if (stepResult.success) {
        void updateRunState(runId, {
          currentStepIndex: index + 1,
          status: 'running',
          variables: stepResult.variables,
        });
      }
    },
  });

  await updateRunState(runId, {
    status: result.success ? 'success' : 'failure',
    endedAt: Date.now(),
    error: result.error,
    variables: result.variables,
  });

  return { ...result, runId };
}

/**
 * Resume a workflow from a previously persisted run state.
 * Used on Service Worker restart to recover interrupted runs.
 */
export async function resumeWorkflowRun(
  runState: WorkflowRunState,
): Promise<ExecutionResult & { runId: string }> {
  const workflow = await getWorkflow(runState.workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${runState.workflowId} not found; cannot resume run ${runState.runId}`);
  }

  await updateRunState(runState.runId, {
    status: 'running',
  });

  const result = await executeWorkflow(workflow, {
    tabId: undefined, // rely on active tab when resuming
    startStepIndex: runState.currentStepIndex,
    variables: runState.variables,
    onStepStart: (_step, index) => {
      void updateRunState(runState.runId, {
        currentStepIndex: index,
        status: 'running',
      });
    },
    onStepEnd: (_step, index, stepResult) => {
      if (stepResult.success) {
        void updateRunState(runState.runId, {
          currentStepIndex: index + 1,
          status: 'running',
          variables: stepResult.variables,
        });
      }
    },
  });

  await updateRunState(runState.runId, {
    status: result.success ? 'success' : 'failure',
    endedAt: Date.now(),
    error: result.error,
    variables: result.variables,
  });

  return { ...result, runId: runState.runId };
}

/**
 * Check for any runs that were marked 'running' in the database and
 * attempt to resume them. Should be called once per Service Worker
 * startup (e.g. in background/index.ts).
 */
export async function recoverRunningWorkflows(): Promise<void> {
  const { listRunningStates } = await import('./repository');
  const states = await listRunningStates();
  if (states.length === 0) return;

  console.log('[WorkflowEngine] Recovering', states.length, 'interrupted workflow run(s)');

  for (const state of states) {
    try {
      await resumeWorkflowRun(state);
    } catch (err) {
      console.error('[WorkflowEngine] Failed to resume run', state.runId, err);
      // Mark as failed so we don't retry indefinitely on every SW boot
      const { updateRunState } = await import('./repository');
      await updateRunState(state.runId, {
        status: 'failure',
        endedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
