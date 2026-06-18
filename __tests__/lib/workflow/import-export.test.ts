/**
 * Workflow 导入/导出单元测试
 *
 * 覆盖 .json 和 .ceb 两种格式的导入导出。
 */

import { describe, it, expect } from 'vitest';
import {
  exportWorkflowToJson,
  exportWorkflowToCeb,
  parseWorkflowJson,
  type CebFormat,
} from '@/lib/workflow/import-export';
import type { Workflow } from '@/lib/workflow/types';

const mockWorkflow: Workflow = {
  id: 'wf-1',
  name: 'Test Workflow',
  description: 'A test workflow',
  steps: [
    { type: 'navigate', url: 'https://example.com' },
    { type: 'click', selector: '#btn' },
  ],
  trigger: { type: 'manual' },
  variables: { key: 'value' },
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  runCount: 5,
};

// ─── 导出 ───

describe('exportWorkflowToJson', () => {
  it('生成有效的 JSON 字符串，不含运行时字段', () => {
    const json = exportWorkflowToJson(mockWorkflow);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('Test Workflow');
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.id).toBeUndefined();
    expect(parsed.runCount).toBeUndefined();
    expect(parsed.createdAt).toBeUndefined();
  });
});

describe('exportWorkflowToCeb', () => {
  it('生成 .ceb 格式，包含 workflow 和 readme', () => {
    const ceb = exportWorkflowToCeb(mockWorkflow, '# README\nThis is a test.');
    const parsed: CebFormat = JSON.parse(ceb);
    expect(parsed.version).toBe('1.0');
    expect(parsed.workflow.name).toBe('Test Workflow');
    expect(parsed.readme).toBe('# README\nThis is a test.');
  });

  it('无 readme 时默认使用 description', () => {
    const ceb = exportWorkflowToCeb(mockWorkflow);
    const parsed: CebFormat = JSON.parse(ceb);
    expect(parsed.readme).toBe('A test workflow');
  });
});

// ─── 导入 ───

describe('parseWorkflowJson', () => {
  it('解析纯 JSON workflow', () => {
    const json = exportWorkflowToJson(mockWorkflow);
    const result = parseWorkflowJson(json);
    expect(result.success).toBe(true);
    expect(result.workflow!.name).toBe('Test Workflow');
    expect(result.workflow!.steps).toHaveLength(2);
    expect(result.readme).toBeUndefined();
  });

  it('解析 .ceb 格式', () => {
    const ceb = exportWorkflowToCeb(mockWorkflow, '# Test');
    const result = parseWorkflowJson(ceb);
    expect(result.success).toBe(true);
    expect(result.workflow!.name).toBe('Test Workflow');
    expect(result.readme).toBe('# Test');
  });

  it('无效 JSON 返回错误', () => {
    const result = parseWorkflowJson('not json');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Parse error/);
  });

  it('非对象 JSON 返回错误', () => {
    const result = parseWorkflowJson('[]');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid JSON/);
  });

  it('缺少 name 返回验证错误', () => {
    const result = parseWorkflowJson('{}');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Validation failed/);
  });
});
