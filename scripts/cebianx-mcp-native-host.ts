/**
 * CebianX MCP Native Messaging Host
 *
 * 职责：作为 Chrome Native Messaging Host，桥接 Hermes（HTTP MCP Client）
 * 与 CebianX 扩展（chrome.runtime.Port）。
 *
 * 架构：
 *   Hermes ──HTTP POST /mcp──▶ Native Host ──stdout(4字节前缀+JSON)──▶ Chrome
 *   Chrome ──stdin(4字节前缀+JSON)──▶ Native Host ──HTTP Response──▶ Hermes
 *
 * 启动方式：被 Chrome 通过 `chrome.runtime.connectNative` 启动（stdin/stdout
 * 与 Chrome 通信）。内部运行 HTTP Server 接收 Hermes 请求。
 *
 * 关键设计：
 *   - Native Messaging 协议：4 字节小端无符号整数长度前缀 + JSON UTF-8 body
 *   - 请求-响应配对：每个 HTTP 请求生成唯一 requestId，通过 stdout 转发；
 *     收到 stdin 响应时按 requestId 路由回对应的 HTTP 请求
 *   - stdin 分块读取：维护缓冲区，按 4 字节前缀切分消息
 *   - 优雅关闭：stdin EOF → 关闭 HTTP Server → exit(0)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';

// ─── 常量 ───

export const DEFAULT_PORT = 8788;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const NATIVE_HOST_NAME = 'cebianx-mcp-host';
export const TOOLS_COUNT = 13;

// ─── 类型 ───

interface MCPRequest {
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Native Messaging 双向消息格式 */
interface NativeMessage {
  requestId: string;
  mcpRequest?: MCPRequest;
  mcpResponse?: MCPResponse;
}

interface PendingRequest {
  resolve: (response: MCPResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Native Messaging I/O ───

/**
 * 将消息编码为 Native Messaging 格式（4 字节小端长度前缀 + JSON UTF-8 body）。
 */
export function encodeNativeMessage(message: object): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * 将消息写入 stdout（Native Messaging 格式）。
 */
export function sendToChrome(message: object, stream: NodeJS.WritableStream = process.stdout): void {
  const buf = encodeNativeMessage(message);
  stream.write(buf);
}

/**
 * stdin 缓冲区解析器：按 4 字节小端前缀切分消息。
 *
 * 维护内部缓冲区，每次喂入新 chunk 后返回所有已完整的消息。
 * 处理跨 chunk 的消息边界。
 */
export class StdinParser {
  private buffer: Buffer = Buffer.alloc(0);

  /** 喂入新 chunk，返回所有已完整的消息 */
  feed(chunk: Buffer): object[] {
    this.buffer = this.buffer.length === 0
      ? chunk
      : (Buffer.concat([this.buffer, chunk]) as Buffer);
    const messages: object[] = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      // 防御：长度字段异常大（超过 10MB），避免内存爆炸
      if (length > 10 * 1024 * 1024) {
        throw new Error(`Native message length too large: ${length}`);
      }
      const totalLen = 4 + length;
      if (this.buffer.length < totalLen) break; // 等待更多数据

      const body = this.buffer.subarray(4, totalLen);
      try {
        messages.push(JSON.parse(body.toString('utf8')));
      } catch (err) {
        throw new Error(`Failed to parse Native message JSON: ${(err as Error).message}`);
      }
      this.buffer = this.buffer.subarray(totalLen) as Buffer;
    }

    return messages;
  }

  /** 重置缓冲区（测试用） */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

// ─── 请求-响应路由表 ───

export class RequestRouter {
  private pending = new Map<string, PendingRequest>();
  private timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /** 注册一个 pending 请求，返回 requestId */
  register(): { requestId: string; promise: Promise<MCPResponse> } {
    const requestId = randomUUID();
    const promise = new Promise<MCPResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(`Request ${requestId} timed out after ${this.timeoutMs}ms`));
        }
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
    });
    return { requestId, promise };
  }

  /** 路由响应到对应的 pending 请求 */
  routeResponse(requestId: string, response: MCPResponse): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(response);
    return true;
  }

  /** 拒绝所有 pending 请求（用于关闭时清理） */
  rejectAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  /** 当前 pending 请求数（测试用） */
  size(): number {
    return this.pending.size;
  }
}

// ─── HTTP Server ───

export interface HostDeps {
  router: RequestRouter;
  send: (message: object) => void;
}

/**
 * 创建 HTTP 请求处理器。
 */
export function createHttpHandler(deps: HostDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // CORS（本地开发便利，Hermes 可能从不同端口调用）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tools: TOOLS_COUNT }));
      return;
    }

    if (req.method === 'POST' && (req.url === '/mcp' || req.url === '/mcp/')) {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        body += chunk;
      }

      let mcpRequest: MCPRequest;
      try {
        mcpRequest = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { code: -32700, message: 'Parse error: invalid JSON' },
        }));
        return;
      }

      const { requestId, promise } = deps.router.register();
      deps.send({ requestId, mcpRequest });

      try {
        const mcpResponse = await promise;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mcpResponse));
      } catch (err) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { code: -32000, message: `Upstream timeout: ${(err as Error).message}` },
        }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  };
}

// ─── 主入口 ───

export interface MainOptions {
  port?: number;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  httpServer?: Server;
  timeoutMs?: number;
}

/**
 * 启动 Native Messaging Host。导出供测试调用。
 * 返回 { httpServer, shutdown } 用于控制生命周期。
 */
export function startNativeHost(options: MainOptions = {}): {
  httpServer: Server;
  shutdown: () => Promise<void>;
} {
  const port = options.port ?? Number(process.env.CEBIANX_NATIVE_HOST_PORT ?? DEFAULT_PORT);
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const router = new RequestRouter(timeoutMs);
  const parser = new StdinParser();
  const send = (message: object) => sendToChrome(message, stdout);

  // NodeJS.ReadableStream 的 on/removeListener 重载签名在不同实现间不兼容，
  // 统一转为 EventEmitter 调用（运行时安全）
  const stdinEmitter = stdin as unknown as EventEmitter;

  // stdin → 解析 → 路由响应
  const onData = (chunk: Buffer) => {
    try {
      const messages = parser.feed(chunk);
      for (const msg of messages) {
        const nativeMsg = msg as NativeMessage;
        if (nativeMsg.requestId && nativeMsg.mcpResponse) {
          router.routeResponse(nativeMsg.requestId, nativeMsg.mcpResponse);
        }
      }
    } catch (err) {
      console.error('[NativeHost] stdin parse error:', err);
    }
  };

  const onEnd = () => {
    console.error('[NativeHost] stdin EOF, shutting down');
    void shutdown();
  };

  const onError = (err: Error) => {
    console.error('[NativeHost] stdin error:', err);
  };

  stdinEmitter.on('data', onData);
  stdinEmitter.on('end', onEnd);
  stdinEmitter.on('error', onError);

  // HTTP Server
  const httpServer = options.httpServer ?? createServer();
  httpServer.on('request', createHttpHandler({ router, send }));

  httpServer.on('error', (err) => {
    console.error('[NativeHost] HTTP server error:', err);
  });

  httpServer.listen(port, '127.0.0.1');

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    stdinEmitter.removeListener('data', onData);
    stdinEmitter.removeListener('end', onEnd);
    stdinEmitter.removeListener('error', onError);

    // 先 reject 所有 pending 请求，让 HTTP handler 有机会发送 504 响应
    router.rejectAll(new Error('Native Host shutting down'));

    // 等待一个事件循环周期，让 HTTP handler 的 catch 块执行并发送响应
    await new Promise((r) => setImmediate(r));

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      // 强制关闭所有连接（Node 18+）
      if (typeof (httpServer as any).closeAllConnections === 'function') {
        (httpServer as any).closeAllConnections();
      }
    });
  }

  return { httpServer, shutdown };
}

// 直接运行时启动（tsx scripts/cebianx-mcp-native-host.ts）
if (require.main === module) {
  const { shutdown } = startNativeHost();

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  // stdout 写入失败（Chrome 关闭了 stdin/stdout）→ 退出
  process.stdout.on('error', (err) => {
    console.error('[NativeHost] stdout error:', err);
    void shutdown().then(() => process.exit(1));
  });
}
