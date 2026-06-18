/**
 * CebianX MCP Server — 将浏览器能力反向暴露给外部客户端。
 *
 * 传输层：
 * 1. chrome.runtime.onMessageExternal — 其他 Chrome 扩展可通过此通道调用
 * 2. chrome.runtime.onConnect (Native Messaging) — Native Messaging Host 通过
 *    `chrome.runtime.connectNative` 建立的 Port，用于 Hermes 等外部进程经
 *    Native Messaging Host 桥接调用
 *
 * 请求/响应遵循简化版 JSON-RPC 格式。
 *
 * 注意：MV3 Service Worker 无法监听 TCP 端口，因此不支持标准 SSE/stdio 传输。
 * Native Messaging Host（scripts/cebianx-mcp-native-host.ts）内部运行 HTTP
 * Server 接收 Hermes 请求，通过 stdin/stdout（Native Messaging 协议）与
 * 扩展 Port 通信。
 */

import { performInteraction } from '@/lib/tools/interact';
import { executeInTabWithArgs, getActiveTabId } from '@/lib/tab-helpers';
import { readPageTool } from '@/lib/tools/read-page';
import { screenshotTool } from '@/lib/tools/screenshot';
import { startWorkflowRun } from '@/lib/workflow/engine';
import { getWorkflow } from '@/lib/workflow/repository';

// ─── 类型 ───

interface MCPRequest {
  id?: string | number;
  method: 'tools/list' | 'tools/call';
  params?: Record<string, unknown>;
}

interface MCPResponse {
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

// ─── 工具定义 ───

const TOOLS: MCPToolDefinition[] = [
  {
    name: 'cebian_navigate',
    description: 'Navigate the active tab to a URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL to navigate to' } },
      required: ['url'],
    },
  },
  {
    name: 'cebian_click',
    description: 'Click an element on the current page by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector of the element to click' } },
      required: ['selector'],
    },
  },
  {
    name: 'cebian_type',
    description: 'Type text into an input element on the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input element' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear existing text before typing' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'cebian_extract',
    description: 'Extract text or an attribute from an element on the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element' },
        attribute: { type: 'string', description: 'Attribute to extract (default: textContent)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'cebian_read_page',
    description: 'Read the content of the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['text', 'markdown', 'html', 'article', 'outline'], description: 'Extraction mode' },
        selector: { type: 'string', description: 'Optional CSS selector to scope extraction' },
      },
    },
  },
  {
    name: 'cebian_screenshot',
    description: 'Take a screenshot of the current page or a specific element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector to screenshot a specific element' },
      },
    },
  },
  {
    name: 'cebian_scroll',
    description: 'Scroll the page or an element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector to scroll into view' },
        deltaX: { type: 'number', description: 'Horizontal scroll amount in pixels' },
        deltaY: { type: 'number', description: 'Vertical scroll amount in pixels' },
      },
    },
  },
  {
    name: 'cebian_wait',
    description: 'Wait for an element to appear or for a timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for (optional)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 5000)' },
      },
    },
  },
  {
    name: 'cebian_select',
    description: 'Select an option from a dropdown by visible text.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the select element' },
        text: { type: 'string', description: 'Visible text of the option to select' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'cebian_hover',
    description: 'Hover over an element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to hover' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'cebian_focus',
    description: 'Focus an element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to focus' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'cebian_keypress',
    description: 'Press a key (with optional modifiers).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g. Enter, Escape, ArrowDown)' },
        selector: { type: 'string', description: 'Optional CSS selector to focus before pressing' },
        modifiers: {
          type: 'array',
          items: { type: 'string', enum: ['ctrl', 'shift', 'alt', 'meta'] },
          description: 'Modifier keys to hold while pressing',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'cebian_run_workflow',
    description: 'Run a saved workflow by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'ID of the workflow to run' },
        variables: { type: 'object', description: 'Optional runtime variables' },
      },
      required: ['workflowId'],
    },
  },
];

// ─── 工具执行 ───

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tabId = await getActiveTabId();

  switch (name) {
    case 'cebian_navigate': {
      const url = String(args.url);
      await chrome.tabs.update(tabId, { url });
      return { success: true, url };
    }

    case 'cebian_click': {
      const result = await executeInTabWithArgs(
        tabId,
        performInteraction,
        [{ action: 'click', selector: String(args.selector) }],
      );
      return { success: true, result };
    }

    case 'cebian_type': {
      const selector = String(args.selector);
      const text = String(args.text);
      // clear 是独立 action，若需要则先执行
      if (args.clear) {
        await executeInTabWithArgs(
          tabId,
          performInteraction,
          [{ action: 'clear', selector }],
        );
      }
      const result = await executeInTabWithArgs(
        tabId,
        performInteraction,
        [{ action: 'type', selector, text }],
      );
      return { success: true, result };
    }

    case 'cebian_extract': {
      const selector = String(args.selector);
      const attribute = args.attribute ? String(args.attribute) : 'textContent';
      const result = await executeInTabWithArgs(
        tabId,
        (sel: string, attr: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          if (attr === 'textContent') return el.textContent ?? '';
          return el.getAttribute(attr) ?? '';
        },
        [selector, attribute],
      );
      return { success: true, data: result };
    }

    case 'cebian_read_page': {
      const mode = (args.mode as string) || 'article';
      const result = await readPageTool.execute('', {
        tabId,
        mode: mode as 'text' | 'html' | 'markdown' | 'article' | 'outline',
        selector: args.selector ? String(args.selector) : undefined,
      });
      // AgentToolResult 的 content 是数组，拼接为文本
      const text = result.content.map((c) => 'text' in c ? c.text : '').join('\n');
      return { success: true, content: text };
    }

    case 'cebian_screenshot': {
      const result = await screenshotTool.execute('', {
        tabId,
        selector: args.selector ? String(args.selector) : undefined,
      });
      // 提取图片 URL（image content 的 url 字段）
      const imageUrl = result.content
        .map((c) => 'imageUrl' in c ? c.imageUrl : '')
        .filter(Boolean)
        .join('\n');
      return { success: true, imageUrl };
    }

    case 'cebian_scroll': {
      const scrollParams = { action: 'scroll' as const };
      if (args.selector) (scrollParams as Record<string, unknown>).selector = String(args.selector);
      if (args.deltaX != null) (scrollParams as Record<string, unknown>).deltaX = Number(args.deltaX);
      if (args.deltaY != null) (scrollParams as Record<string, unknown>).deltaY = Number(args.deltaY);
      const result = await executeInTabWithArgs(tabId, performInteraction, [scrollParams]);
      return { success: true, result };
    }

    case 'cebian_wait': {
      const waitParams = { action: 'wait' as const, timeout: args.timeout ? Number(args.timeout) : 5000 };
      if (args.selector) (waitParams as Record<string, unknown>).selector = String(args.selector);
      const result = await executeInTabWithArgs(tabId, performInteraction, [waitParams]);
      return { success: true, result };
    }

    case 'cebian_select': {
      const result = await executeInTabWithArgs(
        tabId,
        performInteraction,
        [{ action: 'select', selector: String(args.selector), text: String(args.text) }],
      );
      return { success: true, result };
    }

    case 'cebian_hover': {
      const result = await executeInTabWithArgs(
        tabId,
        performInteraction,
        [{ action: 'hover', selector: String(args.selector) }],
      );
      return { success: true, result };
    }

    case 'cebian_focus': {
      const result = await executeInTabWithArgs(
        tabId,
        performInteraction,
        [{ action: 'focus', selector: String(args.selector) }],
      );
      return { success: true, result };
    }

    case 'cebian_keypress': {
      const keyParams = { action: 'keypress' as const, key: String(args.key) };
      if (args.selector) (keyParams as Record<string, unknown>).selector = String(args.selector);
      if (Array.isArray(args.modifiers)) (keyParams as Record<string, unknown>).modifiers = args.modifiers;
      const result = await executeInTabWithArgs(tabId, performInteraction, [keyParams]);
      return { success: true, result };
    }

    case 'cebian_run_workflow': {
      const workflowId = String(args.workflowId);
      const workflow = await getWorkflow(workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }
      const variables = args.variables && typeof args.variables === 'object'
        ? args.variables as Record<string, string>
        : undefined;
      const result = await startWorkflowRun(workflow, { variables });
      return { success: result.success, runId: result.runId, error: result.error };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── 请求处理 ───

function handleRequest(req: MCPRequest): Promise<MCPResponse> {
  return (async (): Promise<MCPResponse> => {
    switch (req.method) {
      case 'tools/list': {
        return { id: req.id, result: { tools: TOOLS } };
      }

      case 'tools/call': {
        const params = req.params ?? {};
        const name = String(params.name ?? '');
        const args = (params.arguments ?? {}) as Record<string, unknown>;

        if (!TOOLS.some((t) => t.name === name)) {
          return {
            id: req.id,
            error: { code: -32602, message: `Tool not found: ${name}` },
          };
        }

        const result = await executeTool(name, args);
        return { id: req.id, result };
      }

      default:
        return {
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  })().catch((err) => ({
    id: req.id,
    error: { code: -32603, message: (err as Error).message },
  }));
}

// ─── 公开 API ───

/**
 * 安装外部消息监听器。应在 background service worker 初始化时调用一次。
 */
export function installMcpServerListener(): void {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    // 基本安全检查：拒绝无 sender 的消息
    if (!sender.id && !sender.url) {
      sendResponse({ error: { code: -32000, message: 'Rejected: untrusted sender' } });
      return false;
    }

    // 异步处理
    void (async () => {
      try {
        const req = message as MCPRequest;
        const resp = await handleRequest(req);
        sendResponse(resp);
      } catch (err) {
        sendResponse({
          error: { code: -32603, message: `Internal error: ${(err as Error).message}` },
        });
      }
    })();

    // 返回 true 表示 sendResponse 将被异步调用
    return true;
  });

  console.log('[MCP Server] External message listener installed');
}

/** 获取工具列表（供内部 UI 展示或文档生成） */
export function getMCPServerTools(): MCPToolDefinition[] {
  return TOOLS;
}

// ─── Native Messaging 传输 ───

/** Native Messaging Port 名称，与 Native Host 约定一致 */
const NATIVE_HOST_PORT_NAME = 'cebianx-mcp-host';

/**
 * 安装 Native Messaging 监听器。应在 background service worker 初始化时调用一次。
 *
 * 与 `installMcpServerListener`（onMessageExternal）并列，复用同一个 `handleRequest`。
 * Native Host 通过 `chrome.runtime.connectNative('cebianx-mcp-host')` 建立连接，
 * 每条消息格式：`{ requestId: string, mcpRequest: MCPRequest }`，
 * 扩展处理后回传：`{ requestId: string, mcpResponse: MCPResponse }`。
 */
export function installNativeMessagingListener(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== NATIVE_HOST_PORT_NAME) return;

    console.log('[MCP Server] Native Messaging host connected');

    port.onMessage.addListener(async (msg) => {
      // 验证消息格式，避免 null/undefined 或缺少字段导致后续抛 TypeError
      if (!msg || typeof msg !== 'object' || typeof msg.requestId !== 'string' || !msg.mcpRequest) {
        console.warn('[MCP Server] Invalid Native Messaging message:', msg);
        return;
      }
      const { requestId, mcpRequest } = msg as { requestId: string; mcpRequest: MCPRequest };
      const mcpResponse = await handleRequest(mcpRequest);
      try {
        port.postMessage({ requestId, mcpResponse });
      } catch (err) {
        // Port 可能在异步处理期间断开（Native Host 退出、Chrome 关闭）
        console.warn('[MCP Server] postMessage to Native Host failed:', err);
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[MCP Server] Native Messaging host disconnected');
    });
  });

  console.log('[MCP Server] Native Messaging listener installed');
}
