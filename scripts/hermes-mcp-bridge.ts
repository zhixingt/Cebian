/**
 * Hermes MCP Bridge
 *
 * 职责：将 Hermes Agent 的 stdio MCP Server 桥接为 Streamable HTTP (SSE) Server，
 * 使 CebianX（浏览器扩展）可以作为 MCP Client 通过 HTTP 连接 Hermes。
 *
 * 启动方式（开发/调试）：
 *   npx tsx scripts/hermes-mcp-bridge.ts [--port 3000]
 *
 * 使用场景：
 *   1. 启动桥接：node scripts/hermes-mcp-bridge.js
 *   2. 在 CebianX MCP 设置中添加 Server：
 *      - URL: http://127.0.0.1:3000/mcp
 *      - 类型: streamable-http
 *   3. Hermes 的工具（搜索、浏览器、图像生成等）将出现在 CebianX 的工具列表中
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const HERMES_PYTHON = process.env.HERMES_PYTHON;
if (!HERMES_PYTHON) {
  console.error('[HermesBridge] HERMES_PYTHON environment variable is required');
  console.error('[HermesBridge] Example: HERMES_PYTHON=/path/to/python.exe pnpm hermes-bridge');
  process.exit(1);
}

// Validate the provided interpreter path exists before spawning the child process.
if (!existsSync(HERMES_PYTHON)) {
  console.error(`[HermesBridge] Python interpreter not found: ${HERMES_PYTHON}`);
  process.exit(1);
}
const HERMES_MODULE = 'agent.transports.hermes_tools_mcp_server';
const PORT = Number(
  process.argv.find((a, i, arr) => arr[i - 1] === '--port') ??
    process.env.HERMES_BRIDGE_PORT ??
    '3000',
);

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

async function main() {
  console.log('[HermesBridge] Starting Hermes stdio MCP Server...');

  // 1. 启动 Hermes stdio MCP Server 子进程
  const stdioTransport = new StdioClientTransport({
    command: HERMES_PYTHON,
    args: ['-m', HERMES_MODULE],
    env: {
      ...process.env,
      HERMES_QUIET: '1',
      HERMES_REDACT_SECRETS: 'true',
    } as Record<string, string>,
    stderr: 'inherit',
  });

  const hermesClient = new Client(
    { name: 'cebianx-hermes-bridge', version: '1.0.0' },
    { capabilities: {} },
  );

  await hermesClient.connect(stdioTransport);
  console.log('[HermesBridge] Connected to Hermes stdio MCP Server');

  // 2. 获取 Hermes 的工具列表
  const toolsResult = await hermesClient.listTools();
  const hermesTools = new Map<string, ToolDef>(
    (toolsResult.tools ?? []).map((t) => [
      t.name,
      {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      },
    ]),
  );
  console.log(`[HermesBridge] Discovered ${hermesTools.size} tools from Hermes`);

  // 3. 创建代理 MCP Server（将 Hermes 的工具暴露出去）
  const proxyServer = new Server(
    { name: 'cebianx-hermes-proxy', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  proxyServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Array.from(hermesTools.values()).map((t) => ({
        name: t.name,
        description: t.description ?? `Hermes tool: ${t.name}`,
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      })),
    };
  });

  proxyServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = hermesTools.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }

    const args = request.params.arguments ?? {};
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Invalid arguments for tool ${tool.name}: expected object`,
          },
        ],
        isError: true,
      };
    }

    if (tool.inputSchema?.type === 'object' && Array.isArray(tool.inputSchema.required)) {
      for (const key of tool.inputSchema.required) {
        if (!(key in args)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Missing required argument "${key}" for tool ${tool.name}`,
              },
            ],
            isError: true,
          };
        }
      }
    }

    const result = await hermesClient.callTool({
      name: tool.name,
      arguments: args,
    });
    const textParts = (result.content ?? [])
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const imageParts = (result.content ?? [])
      .filter((c): c is ImageContent => c.type === 'image')
      .map((c) => ({ type: 'image' as const, data: c.data, mimeType: c.mimeType }));
    return {
      content: [...(textParts ? [{ type: 'text' as const, text: textParts }] : []), ...imageParts],
    };
  });

  // 4. 启动 Streamable HTTP Server
  // 使用 session mode：每个客户端持有独立的 mcp-session-id，
  // 避免 stateless transport 在跨请求复用时出现 message ID 冲突。
  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      console.log(`[HermesBridge] Session initialized: ${sessionId}`);
    },
  });

  await proxyServer.connect(httpTransport);

  const httpServer = createServer(async (req, res) => {
    if (req.url === '/mcp' || req.url?.startsWith('/mcp')) {
      try {
        await httpTransport.handleRequest(req, res);
      } catch (err) {
        console.error('[HermesBridge] handleRequest error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      }
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          tools: Array.from(hermesTools.values()).map((t) => t.name),
        }),
      );
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`[HermesBridge] Streamable HTTP Server listening on http://127.0.0.1:${PORT}/mcp`);
    console.log(`[HermesBridge] Health check: http://127.0.0.1:${PORT}/health`);
    console.log(
      `[HermesBridge] Exposed tools: ${Array.from(hermesTools.values())
        .map((t) => t.name)
        .join(', ')}`,
    );
  });

  // 优雅关闭
  const shutdown = async () => {
    console.log('\n[HermesBridge] Shutting down...');
    httpServer.closeAllConnections?.();
    httpServer.close();
    await httpTransport.close();
    await stdioTransport.close();
    await hermesClient.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[HermesBridge] Fatal error:', err);
  process.exit(1);
});
