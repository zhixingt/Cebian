/**
 * Workflow 导入/导出 — 工作流市场基础。
 *
 * 支持两种格式：
 * - .json：纯 Workflow DSL JSON（向后兼容）
 * - .ceb：CebianX 扩展格式（workflow + readme 打包，本质为 JSON）
 */

import type { Workflow } from './types';
import { validateWorkflowLoose, sanitizeWorkflow } from './schema';

// ─── .ceb 格式定义 ───

export interface CebFormat {
  version: string;
  workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'lastRunAt' | 'lastRunStatus'>;
  readme?: string;
}

// ─── 导出 ───

export function exportWorkflowToJson(workflow: Workflow): string {
  const exportable: CebFormat['workflow'] = {
    name: workflow.name,
    description: workflow.description,
    steps: workflow.steps,
    trigger: workflow.trigger,
    variables: workflow.variables,
  };
  return JSON.stringify({ version: '1.0', ...exportable }, null, 2);
}

export function exportWorkflowToCeb(workflow: Workflow, readme?: string): string {
  const ceb: CebFormat = {
    version: '1.0',
    workflow: {
      name: workflow.name,
      description: workflow.description,
      steps: workflow.steps,
      trigger: workflow.trigger,
      variables: workflow.variables,
    },
    readme: readme ?? workflow.description,
  };
  return JSON.stringify(ceb, null, 2);
}

export function downloadWorkflowJson(workflow: Workflow): void {
  const json = exportWorkflowToJson(workflow);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeName = safeFilename(workflow.name);
  triggerDownload(url, `${safeName}.json`);
  URL.revokeObjectURL(url);
}

export function downloadWorkflowCeb(workflow: Workflow, readme?: string): void {
  const ceb = exportWorkflowToCeb(workflow, readme);
  const blob = new Blob([ceb], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeName = safeFilename(workflow.name);
  triggerDownload(url, `${safeName}.ceb`);
  URL.revokeObjectURL(url);
}

// ─── 导入 ───

export interface ImportResult {
  success: boolean;
  workflow?: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>;
  readme?: string;
  error?: string;
}

export function parseWorkflowJson(jsonText: string): ImportResult {
  try {
    const parsed = JSON.parse(jsonText);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { success: false, error: 'Invalid JSON: not an object' };
    }

    // 检测 .ceb 格式（包含 workflow 字段）
    const workflowPayload = parsed.workflow ?? parsed;
    const readme = parsed.readme ?? undefined;

    const now = Date.now();
    const forValidation = {
      id: workflowPayload.id ?? 'import-temp-id',
      name: workflowPayload.name,
      steps: workflowPayload.steps,
      createdAt: workflowPayload.createdAt ?? now,
      updatedAt: workflowPayload.updatedAt ?? now,
      runCount: workflowPayload.runCount ?? 0,
      description: workflowPayload.description,
      trigger: workflowPayload.trigger,
      variables: workflowPayload.variables,
      lastRunAt: workflowPayload.lastRunAt,
      lastRunStatus: workflowPayload.lastRunStatus,
    };

    const validation = validateWorkflowLoose(forValidation);
    if (!validation.valid) {
      return { success: false, error: `Validation failed: ${validation.errors.join('; ')}` };
    }

    const sanitized = sanitizeWorkflow(forValidation);
    if (!sanitized) {
      return { success: false, error: 'Sanitization failed: unable to normalize workflow' };
    }

    const workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'runCount'> = {
      name: sanitized.name,
      description: sanitized.description,
      steps: sanitized.steps,
      trigger: sanitized.trigger ?? { type: 'manual' },
      variables: sanitized.variables ?? {},
    };

    return { success: true, workflow, readme };
  } catch (err) {
    return { success: false, error: `Parse error: ${(err as Error).message}` };
  }
}

export async function readWorkflowFile(file: File): Promise<ImportResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(parseWorkflowJson(String(reader.result)));
    };
    reader.onerror = () => {
      resolve({ success: false, error: 'Failed to read file' });
    };
    reader.readAsText(file);
  });
}

// ─── 辅助 ───

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-');
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
