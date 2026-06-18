/**
 * MCP Server 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 模拟 chrome.runtime
const mockAddListener = vi.fn();
const mockTabsUpdate = vi.fn();
const mockTabsQuery = vi.fn();

// 模拟 tab-helpers
const mockExecuteInTabWithArgs = vi.fn();
const mockGetActiveTabId = vi.fn();

vi.mock('@/lib/tab-helpers', () => ({
  executeInTabWithArgs: (...args: unknown[]) => mockExecuteInTabWithArgs(...args),
  getActiveTabId: () => mockGetActiveTabId(),
}));

// 模拟 interact
vi.mock('@/lib/tools/interact', () => ({
  performInteraction: vi.fn(),
}));

// 模拟 read-page
const mockReadPageExecute = vi.fn();
vi.mock('@/lib/tools/read-page', () => ({
  readPageTool: { execute: (...args: unknown[]) => mockReadPageExecute(...args) },
}));

// 模拟 screenshot
const mockScreenshotExecute = vi.fn();
vi.mock('@/lib/tools/screenshot', () => ({
  screenshotTool: { execute: (...args: unknown[]) => mockScreenshotExecute(...args) },
}));

// 模拟 workflow engine
const mockStartWorkflowRun = vi.fn();
vi.mock('@/lib/workflow/engine', () => ({
  startWorkflowRun: (...args: unknown[]) => mockStartWorkflowRun(...args),
}));

// 模拟 workflow repository
const mockGetWorkflow = vi.fn();
vi.mock('@/lib/workflow/repository', () => ({
  getWorkflow: (...args: unknown[]) => mockGetWorkflow(...args),
}));

import { installMcpServerListener, getMCPServerTools } from '@/lib/mcp/server';

describe('MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.chrome = {
      runtime: { onMessageExternal: { addListener: mockAddListener } },
      tabs: { update: mockTabsUpdate, query: mockTabsQuery },
    } as unknown as typeof chrome;
    mockGetActiveTabId.mockResolvedValue(123);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMCPServerTools', () => {
    it('returns 13 tools', () => {
      const tools = getMCPServerTools();
      expect(tools).toHaveLength(13);
      const names = tools.map((t) => t.name);
      expect(names).toEqual([
        'cebian_navigate',
        'cebian_click',
        'cebian_type',
        'cebian_extract',
        'cebian_read_page',
        'cebian_screenshot',
        'cebian_scroll',
        'cebian_wait',
        'cebian_select',
        'cebian_hover',
        'cebian_focus',
        'cebian_keypress',
        'cebian_run_workflow',
      ]);
    });
  });

  describe('installMcpServerListener', () => {
    it('registers chrome.runtime.onMessageExternal listener', () => {
      installMcpServerListener();
      expect(mockAddListener).toHaveBeenCalledTimes(1);
      expect(typeof mockAddListener.mock.calls[0][0]).toBe('function');
    });
  });

  describe('message handling via registered listener', () => {
    let listener: (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean;

    beforeEach(() => {
      installMcpServerListener();
      listener = mockAddListener.mock.calls[0][0];
    });

    it('rejects messages without sender id or url', () => {
      const sendResponse = vi.fn();
      const result = listener({}, {}, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({
        error: { code: -32000, message: 'Rejected: untrusted sender' },
      });
    });

    it('handles tools/list and returns 13 tools', async () => {
      const sendResponse = vi.fn();
      const result = listener(
        { id: 1, method: 'tools/list' },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true); // async

      // 等待异步处理
      await new Promise((r) => setTimeout(r, 10));
      expect(sendResponse).toHaveBeenCalledTimes(1);
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.id).toBe(1);
      expect(resp.result.tools).toHaveLength(13);
    });

    it('handles tools/call for cebian_navigate', async () => {
      mockTabsUpdate.mockResolvedValue({});
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 2,
          method: 'tools/call',
          params: { name: 'cebian_navigate', arguments: { url: 'https://example.com' } },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockTabsUpdate).toHaveBeenCalledWith(123, { url: 'https://example.com' });
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.id).toBe(2);
      expect(resp.result).toEqual({ success: true, url: 'https://example.com' });
    });

    it('handles tools/call for cebian_click', async () => {
      mockExecuteInTabWithArgs.mockResolvedValue('Clicked #btn');
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 3,
          method: 'tools/call',
          params: { name: 'cebian_click', arguments: { selector: '#btn' } },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.id).toBe(3);
      expect(resp.result.success).toBe(true);
    });

    it('handles tools/call for cebian_type with clear', async () => {
      mockExecuteInTabWithArgs.mockResolvedValue('OK');
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 4,
          method: 'tools/call',
          params: { name: 'cebian_type', arguments: { selector: '#input', text: 'hello', clear: true } },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      // 应该先执行 clear，再执行 type
      expect(mockExecuteInTabWithArgs).toHaveBeenCalledTimes(2);
      expect(mockExecuteInTabWithArgs.mock.calls[0][2]).toEqual([{ action: 'clear', selector: '#input' }]);
      expect(mockExecuteInTabWithArgs.mock.calls[1][2]).toEqual([{ action: 'type', selector: '#input', text: 'hello' }]);
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.result.success).toBe(true);
    });

    it('handles tools/call for cebian_extract', async () => {
      mockExecuteInTabWithArgs.mockResolvedValue('extracted text');
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 5,
          method: 'tools/call',
          params: { name: 'cebian_extract', arguments: { selector: '#data' } },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.result.success).toBe(true);
      expect(resp.result.data).toBe('extracted text');
    });

    it('handles tools/call for cebian_read_page', async () => {
      mockReadPageExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Page content here' }],
        details: {},
      });
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 6,
          method: 'tools/call',
          params: { name: 'cebian_read_page', arguments: { mode: 'article' } },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.result.success).toBe(true);
      expect(resp.result.content).toBe('Page content here');
    });

    it('handles tools/call for cebian_screenshot', async () => {
      mockScreenshotExecute.mockResolvedValue({
        content: [{ type: 'image', imageUrl: 'data:image/png;base64,abc' }],
        details: {},
      });
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 7,
          method: 'tools/call',
          params: { name: 'cebian_screenshot', arguments: {} },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.result.success).toBe(true);
      expect(resp.result.imageUrl).toBe('data:image/png;base64,abc');
    });

    it('handles tools/call for cebian_run_workflow', async () => {
      mockGetWorkflow.mockResolvedValue({ id: 'wf-1', name: 'Test', steps: [] });
      mockStartWorkflowRun.mockResolvedValue({ success: true, runId: 'run-1' });
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 8,
          method: 'tools/call',
          params: { name: 'cebian_run_workflow', arguments: { workflowId: 'wf-1' } },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockGetWorkflow).toHaveBeenCalledWith('wf-1');
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.result.success).toBe(true);
      expect(resp.result.runId).toBe('run-1');
    });

    it('returns error for unknown tool', async () => {
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 9,
          method: 'tools/call',
          params: { name: 'unknown_tool', arguments: {} },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.error.code).toBe(-32602);
      expect(resp.error.message).toContain('Tool not found');
    });

    it('returns error for unknown method', async () => {
      const sendResponse = vi.fn();
      const result = listener(
        { id: 10, method: 'unknown/method' },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.error.code).toBe(-32601);
      expect(resp.error.message).toContain('Method not found');
    });

    it('catches tool execution errors and returns JSON-RPC error', async () => {
      mockTabsUpdate.mockRejectedValue(new Error('Navigation failed'));
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 11,
          method: 'tools/call',
          params: { name: 'cebian_navigate', arguments: { url: 'https://fail.com' } },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.error.code).toBe(-32603);
      expect(resp.error.message).toContain('Navigation failed');
    });

    it('returns error when workflow not found', async () => {
      mockGetWorkflow.mockResolvedValue(null);
      const sendResponse = vi.fn();
      const result = listener(
        {
          id: 12,
          method: 'tools/call',
          params: { name: 'cebian_run_workflow', arguments: { workflowId: 'missing' } },
        },
        { id: 'ext-id' },
        sendResponse,
      );
      expect(result).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      const resp = sendResponse.mock.calls[0][0] as any;
      expect(resp.error.code).toBe(-32603);
      expect(resp.error.message).toContain('Workflow not found');
    });
  });
});
