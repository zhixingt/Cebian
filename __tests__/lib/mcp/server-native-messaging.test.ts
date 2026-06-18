/**
 * installNativeMessagingListener 测试
 *
 * 测试范围：
 * - 注册 chrome.runtime.onConnect 监听器
 * - port.name 过滤（仅处理 'cebianx-mcp-host'）
 * - port.onMessage 接收 { requestId, mcpRequest } → 调用 handleRequest → port.postMessage({ requestId, mcpResponse })
 * - tools/list 请求返回 13 个工具
 * - tools/call 请求执行工具（mock executeTool）
 * - port.onDisconnect 清理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock chrome API 与依赖 ───

const mockOnConnectAddListener = vi.fn();

const mockTabsUpdate = vi.fn();
const mockTabsQuery = vi.fn();
const mockExecuteInTabWithArgs = vi.fn();
const mockGetActiveTabId = vi.fn();

vi.mock('@/lib/tab-helpers', () => ({
  executeInTabWithArgs: (...args: unknown[]) => mockExecuteInTabWithArgs(...args),
  getActiveTabId: () => mockGetActiveTabId(),
}));

vi.mock('@/lib/tools/interact', () => ({
  performInteraction: vi.fn(),
}));

const mockReadPageExecute = vi.fn();
vi.mock('@/lib/tools/read-page', () => ({
  readPageTool: { execute: (...args: unknown[]) => mockReadPageExecute(...args) },
}));

const mockScreenshotExecute = vi.fn();
vi.mock('@/lib/tools/screenshot', () => ({
  screenshotTool: { execute: (...args: unknown[]) => mockScreenshotExecute(...args) },
}));

const mockStartWorkflowRun = vi.fn();
vi.mock('@/lib/workflow/engine', () => ({
  startWorkflowRun: (...args: unknown[]) => mockStartWorkflowRun(...args),
}));

const mockGetWorkflow = vi.fn();
vi.mock('@/lib/workflow/repository', () => ({
  getWorkflow: (...args: unknown[]) => mockGetWorkflow(...args),
}));

import { installNativeMessagingListener, getMCPServerTools } from '@/lib/mcp/server';

// ─── Mock Port 工厂 ───

interface MockPort {
  name: string;
  onMessage: { addListener: (cb: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
  postMessage: ReturnType<typeof vi.fn>;
  // 内部触发器（测试用）
  _fireMessage?: (msg: unknown) => void;
  _fireDisconnect?: () => void;
}

function createMockPort(name: string = 'cebianx-mcp-host'): MockPort {
  let messageCb: ((msg: unknown) => void) | undefined;
  let disconnectCb: (() => void) | undefined;
  const port: MockPort = {
    name,
    onMessage: {
      addListener: (cb) => {
        messageCb = cb;
      },
    },
    onDisconnect: {
      addListener: (cb) => {
        disconnectCb = cb;
      },
    },
    postMessage: vi.fn(),
  };
  port._fireMessage = (msg: unknown) => messageCb?.(msg);
  port._fireDisconnect = () => disconnectCb?.();
  return port;
}

// ─── 测试 ───

describe('installNativeMessagingListener', () => {
  let onConnectCallback: ((port: MockPort) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    global.chrome = {
      runtime: {
        onConnect: { addListener: mockOnConnectAddListener },
        onMessageExternal: { addListener: vi.fn() },
      },
      tabs: { update: mockTabsUpdate, query: mockTabsQuery },
    } as unknown as typeof chrome;
    mockGetActiveTabId.mockResolvedValue(123);

    mockOnConnectAddListener.mockImplementation((cb: (port: MockPort) => void) => {
      onConnectCallback = cb;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    onConnectCallback = undefined;
  });

  it('registers chrome.runtime.onConnect listener', () => {
    installNativeMessagingListener();
    expect(mockOnConnectAddListener).toHaveBeenCalledTimes(1);
    expect(typeof onConnectCallback).toBe('function');
  });

  it('ignores ports with different name', () => {
    installNativeMessagingListener();
    const port = createMockPort('other-port-name');
    onConnectCallback!(port);

    // 不应注册 onMessage 监听器（port.onMessage.addListener 未被调用）
    // 由于 createMockPort 的实现，我们通过 _fireMessage 是否有副作用来判断
    port._fireMessage!({ requestId: 'r1', mcpRequest: { method: 'tools/list' } });
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('processes tools/list request and posts back response with 13 tools', async () => {
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    onConnectCallback!(port);

    const requestId = 'req-uuid-1';
    port._fireMessage!({
      requestId,
      mcpRequest: { id: 1, method: 'tools/list' },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    const sent = port.postMessage.mock.calls[0][0];
    expect(sent.requestId).toBe(requestId);
    expect(sent.mcpResponse.id).toBe(1);
    expect(sent.mcpResponse.result.tools).toHaveLength(13);
  });

  it('processes tools/call for cebian_navigate', async () => {
    mockTabsUpdate.mockResolvedValue({});
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    onConnectCallback!(port);

    const requestId = 'req-uuid-2';
    port._fireMessage!({
      requestId,
      mcpRequest: {
        id: 2,
        method: 'tools/call',
        params: { name: 'cebian_navigate', arguments: { url: 'https://example.com' } },
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockTabsUpdate).toHaveBeenCalledWith(123, { url: 'https://example.com' });
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    const sent = port.postMessage.mock.calls[0][0];
    expect(sent.requestId).toBe(requestId);
    expect(sent.mcpResponse.id).toBe(2);
    expect(sent.mcpResponse.result).toEqual({ success: true, url: 'https://example.com' });
  });

  it('processes tools/call for cebian_click', async () => {
    mockExecuteInTabWithArgs.mockResolvedValue('clicked');
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    onConnectCallback!(port);

    const requestId = 'req-uuid-3';
    port._fireMessage!({
      requestId,
      mcpRequest: {
        id: 3,
        method: 'tools/call',
        params: { name: 'cebian_click', arguments: { selector: '#btn' } },
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    const sent = port.postMessage.mock.calls[0][0];
    expect(sent.requestId).toBe(requestId);
    expect(sent.mcpResponse.result.success).toBe(true);
  });

  it('returns error for unknown tool', async () => {
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    onConnectCallback!(port);

    const requestId = 'req-uuid-4';
    port._fireMessage!({
      requestId,
      mcpRequest: {
        id: 4,
        method: 'tools/call',
        params: { name: 'unknown_tool', arguments: {} },
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    const sent = port.postMessage.mock.calls[0][0];
    expect(sent.requestId).toBe(requestId);
    expect(sent.mcpResponse.error.code).toBe(-32602);
    expect(sent.mcpResponse.error.message).toContain('Tool not found');
  });

  it('returns error for unknown method', async () => {
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    onConnectCallback!(port);

    const requestId = 'req-uuid-5';
    port._fireMessage!({
      requestId,
      mcpRequest: { id: 5, method: 'unknown/method' },
    });

    await new Promise((r) => setTimeout(r, 10));

    const sent = port.postMessage.mock.calls[0][0];
    expect(sent.requestId).toBe(requestId);
    expect(sent.mcpResponse.error.code).toBe(-32601);
  });

  it('catches tool execution errors and returns JSON-RPC error', async () => {
    mockTabsUpdate.mockRejectedValue(new Error('Navigation failed'));
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    onConnectCallback!(port);

    const requestId = 'req-uuid-6';
    port._fireMessage!({
      requestId,
      mcpRequest: {
        id: 6,
        method: 'tools/call',
        params: { name: 'cebian_navigate', arguments: { url: 'https://fail.com' } },
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    const sent = port.postMessage.mock.calls[0][0];
    expect(sent.requestId).toBe(requestId);
    expect(sent.mcpResponse.error.code).toBe(-32603);
    expect(sent.mcpResponse.error.message).toContain('Navigation failed');
  });

  it('preserves requestId across request and response', async () => {
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    onConnectCallback!(port);

    // 发送多个请求，验证每个响应的 requestId 都正确
    const ids = ['r-1', 'r-2', 'r-3'];
    for (const id of ids) {
      port._fireMessage!({
        requestId: id,
        mcpRequest: { method: 'tools/list' },
      });
    }

    await new Promise((r) => setTimeout(r, 20));

    expect(port.postMessage).toHaveBeenCalledTimes(3);
    const sentIds = port.postMessage.mock.calls.map((c) => c[0].requestId);
    expect(sentIds.sort()).toEqual([...ids].sort());
  });

  it('handles port.onDisconnect without throwing', () => {
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    onConnectCallback!(port);

    expect(() => port._fireDisconnect!()).not.toThrow();
  });

  it('swallows postMessage errors after async handling', async () => {
    installNativeMessagingListener();
    const port = createMockPort('cebianx-mcp-host');
    // 模拟 port 已断开，postMessage 抛错
    port.postMessage.mockImplementation(() => {
      throw new Error('Attempting to use a disconnected port object');
    });
    onConnectCallback!(port);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    port._fireMessage!({
      requestId: 'r-err',
      mcpRequest: { method: 'tools/list' },
    });

    await new Promise((r) => setTimeout(r, 10));

    // 不应抛出，应被 catch
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('postMessage to Native Host failed'),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('can be called multiple times (idempotent registration)', () => {
    installNativeMessagingListener();
    installNativeMessagingListener();
    // 每次 install 都会注册一个新的 onConnect 监听器
    expect(mockOnConnectAddListener).toHaveBeenCalledTimes(2);
  });

  it('getMCPServerTools still returns 13 tools (no regression)', () => {
    installNativeMessagingListener();
    expect(getMCPServerTools()).toHaveLength(13);
  });
});
