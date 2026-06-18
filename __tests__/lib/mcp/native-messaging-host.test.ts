/**
 * Native Messaging Host 测试
 *
 * 测试范围：
 * - Native Messaging I/O（4字节前缀编码/解码）
 * - stdin 缓冲区解析（分块、跨块消息）
 * - HTTP Server（/mcp 端点请求-响应、/health 端点）
 * - 请求-响应路由（requestId 配对）
 * - 超时处理
 * - 优雅关闭（stdin EOF）
 */
// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { createServer, type Server } from 'node:http';
import {
  encodeNativeMessage,
  sendToChrome,
  StdinParser,
  RequestRouter,
  createHttpHandler,
  startNativeHost,
  DEFAULT_PORT,
  DEFAULT_TIMEOUT_MS,
  TOOLS_COUNT,
} from '../../../scripts/cebianx-mcp-native-host';

// ─── Native Messaging I/O ───

describe('encodeNativeMessage', () => {
  it('encodes message with 4-byte little-endian length prefix + JSON body', () => {
    const message = { hello: 'world' };
    const buf = encodeNativeMessage(message);

    // 4 字节前缀
    expect(buf.length).toBeGreaterThanOrEqual(4);
    const length = buf.readUInt32LE(0);
    const body = buf.subarray(4);

    expect(length).toBe(body.length);
    expect(JSON.parse(body.toString('utf8'))).toEqual(message);
  });

  it('encodes empty object', () => {
    const buf = encodeNativeMessage({});
    expect(buf.readUInt32LE(0)).toBe(2); // "{}".length
    expect(buf.subarray(4).toString('utf8')).toBe('{}');
  });

  it('encodes unicode content correctly', () => {
    const message = { text: '你好世界 🌍' };
    const buf = encodeNativeMessage(message);
    const length = buf.readUInt32LE(0);
    const body = buf.subarray(4);

    expect(body.length).toBe(length);
    expect(JSON.parse(body.toString('utf8'))).toEqual(message);
  });
});

describe('sendToChrome', () => {
  it('writes encoded message to stream', () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));

    sendToChrome({ foo: 'bar' }, stream);

    const combined = Buffer.concat(chunks);
    const length = combined.readUInt32LE(0);
    const body = combined.subarray(4, 4 + length);
    expect(JSON.parse(body.toString('utf8'))).toEqual({ foo: 'bar' });
  });
});

// ─── stdin 缓冲区解析 ───

describe('StdinParser', () => {
  let parser: StdinParser;

  beforeEach(() => {
    parser = new StdinParser();
  });

  it('parses a single complete message', () => {
    const msg = { requestId: 'r1', mcpResponse: { result: 'ok' } };
    const encoded = encodeNativeMessage(msg);

    const result = parser.feed(encoded);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(msg);
  });

  it('parses multiple messages in one chunk', () => {
    const msg1 = { requestId: 'r1' };
    const msg2 = { requestId: 'r2' };
    const combined = Buffer.concat([encodeNativeMessage(msg1), encodeNativeMessage(msg2)]);

    const result = parser.feed(combined);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(msg1);
    expect(result[1]).toEqual(msg2);
  });

  it('handles message split across chunks (header split)', () => {
    const msg = { requestId: 'r1', data: 'test' };
    const encoded = encodeNativeMessage(msg);

    // 在长度前缀中间切开
    const part1 = encoded.subarray(0, 2);
    const part2 = encoded.subarray(2);

    expect(parser.feed(part1)).toHaveLength(0);
    const result = parser.feed(part2);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(msg);
  });

  it('handles message split across chunks (body split)', () => {
    const msg = { requestId: 'r1', data: 'a'.repeat(100) };
    const encoded = encodeNativeMessage(msg);

    // 在 body 中间切开
    const splitPoint = 4 + 10;
    const part1 = encoded.subarray(0, splitPoint);
    const part2 = encoded.subarray(splitPoint);

    expect(parser.feed(part1)).toHaveLength(0);
    const result = parser.feed(part2);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(msg);
  });

  it('handles multiple messages split across chunks', () => {
    const msg1 = { requestId: 'r1' };
    const msg2 = { requestId: 'r2' };
    const encoded1 = encodeNativeMessage(msg1);
    const encoded2 = encodeNativeMessage(msg2);

    // 第一条完整 + 第二条的前半部分
    const part1 = Buffer.concat([encoded1, encoded2.subarray(0, 6)]);
    // 第二条的后半部分
    const part2 = encoded2.subarray(6);

    const r1 = parser.feed(part1);
    expect(r1).toHaveLength(1);
    expect(r1[0]).toEqual(msg1);

    const r2 = parser.feed(part2);
    expect(r2).toHaveLength(1);
    expect(r2[0]).toEqual(msg2);
  });

  it('throws on message length exceeding 10MB', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(11 * 1024 * 1024, 0); // 11MB

    expect(() => parser.feed(header)).toThrow(/length too large/i);
  });

  it('throws on invalid JSON body', () => {
    const invalidBody = Buffer.from('{not valid json', 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(invalidBody.length, 0);
    const combined = Buffer.concat([header, invalidBody]);

    expect(() => parser.feed(combined)).toThrow(/Failed to parse Native message JSON/);
  });

  it('reset clears the buffer', () => {
    const encoded = encodeNativeMessage({ a: 1 });
    const partial = encoded.subarray(0, 2);
    parser.feed(partial);

    parser.reset();

    const msg = { b: 2 };
    const result = parser.feed(encodeNativeMessage(msg));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(msg);
  });
});

// ─── 请求-响应路由 ───

describe('RequestRouter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('register returns a unique requestId and pending promise', () => {
    const router = new RequestRouter(1000);
    const { requestId, promise } = router.register();

    expect(typeof requestId).toBe('string');
    expect(requestId.length).toBeGreaterThan(0);
    expect(promise).toBeInstanceOf(Promise);
    expect(router.size()).toBe(1);
  });

  it('routeResponse resolves the pending promise with the response', async () => {
    const router = new RequestRouter(1000);
    const { requestId, promise } = router.register();

    const response = { id: 1, result: { tools: [] } };
    const ok = router.routeResponse(requestId, response);
    expect(ok).toBe(true);
    expect(router.size()).toBe(0);

    const resolved = await promise;
    expect(resolved).toEqual(response);
  });

  it('routeResponse returns false for unknown requestId', () => {
    const router = new RequestRouter(1000);
    const ok = router.routeResponse('unknown-id', { result: 'ok' });
    expect(ok).toBe(false);
  });

  it('rejects the promise after timeout', async () => {
    const router = new RequestRouter(100);
    const { promise } = router.register();

    vi.advanceTimersByTime(150);

    await expect(promise).rejects.toThrow(/timed out after 100ms/);
    expect(router.size()).toBe(0);
  });

  it('rejectAll rejects all pending promises', async () => {
    const router = new RequestRouter(10000);
    const { promise: p1 } = router.register();
    const { promise: p2 } = router.register();

    expect(router.size()).toBe(2);
    router.rejectAll(new Error('shutdown'));
    expect(router.size()).toBe(0);

    await expect(p1).rejects.toThrow('shutdown');
    await expect(p2).rejects.toThrow('shutdown');
  });

  it('clears timeout timer when response arrives', async () => {
    const router = new RequestRouter(100);
    const { requestId, promise } = router.register();

    router.routeResponse(requestId, { result: 'ok' });
    // 推进时间超过超时，不应有未处理的 timer
    vi.advanceTimersByTime(200);

    await expect(promise).resolves.toEqual({ result: 'ok' });
  });
});

// ─── HTTP Server ───

describe('createHttpHandler', () => {
  let server: Server;
  let basePort = 18790;

  function startTestHandler(router: RequestRouter, send: (m: object) => void): Promise<{ server: Server; port: number }> {
    return new Promise((resolve) => {
      server = createServer(createHttpHandler({ router, send }));
      const port = basePort++;
      server.listen(port, '127.0.0.1', () => resolve({ server, port }));
    });
  }

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('GET /health returns status ok and tools count', async () => {
    const router = new RequestRouter(1000);
    const { port } = await startTestHandler(router, () => {});

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', tools: TOOLS_COUNT });
  });

  it('returns 404 for unknown path', async () => {
    const router = new RequestRouter(1000);
    const { port } = await startTestHandler(router, () => {});

    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it('OPTIONS returns 204 with CORS headers', async () => {
    const router = new RequestRouter(1000);
    const { port } = await startTestHandler(router, () => {});

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST /mcp with invalid JSON returns 400', async () => {
    const router = new RequestRouter(1000);
    const { port } = await startTestHandler(router, () => {});

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it('POST /mcp forwards request via send and returns response', async () => {
    const router = new RequestRouter(5000);
    const sentMessages: object[] = [];
    const send = (m: object) => {
      sentMessages.push(m);
      // 模拟扩展立即响应
      const nativeMsg = m as { requestId: string };
      setTimeout(() => {
        router.routeResponse(nativeMsg.requestId, { id: 1, result: { tools: ['t1'] } });
      }, 10);
    };

    const { port } = await startTestHandler(router, send);

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, method: 'tools/list' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 1, result: { tools: ['t1'] } });

    // 验证 send 被调用，消息包含 requestId 和 mcpRequest
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toHaveProperty('requestId');
    expect((sentMessages[0] as any).mcpRequest).toEqual({ id: 1, method: 'tools/list' });
  });

  it('POST /mcp returns 504 on timeout', async () => {
    const router = new RequestRouter(50); // 50ms 超时
    const send = () => { /* 不响应，触发超时 */ };
    const { port } = await startTestHandler(router, send);

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'tools/list' }),
    });

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toMatch(/timeout/i);
  });

  it('POST /mcp returns error response immediately when send throws', async () => {
    const router = new RequestRouter(5000);
    // 模拟 stdout 已关闭，send 抛错
    const send = () => {
      throw new Error('stdout closed');
    };
    const { port } = await startTestHandler(router, send);

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, method: 'tools/list' }),
    });

    // 应立即返回错误响应（而非等待 5s 超时）
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toContain('Failed to send to Chrome');
    expect(body.error.message).toContain('stdout closed');
    expect(router.size()).toBe(0); // pending 请求已被清理
  });
});

// ─── startNativeHost 集成测试 ───

describe('startNativeHost', () => {
  let testPort = 18800;

  function createMockStdin() {
    const stream = new PassThrough();
    return stream;
  }

  function createMockStdout() {
    const stream = new PassThrough();
    return stream;
  }

  it('starts HTTP server on specified port and responds to /health', async () => {
    const port = testPort++;
    const stdin = createMockStdin();
    const stdout = createMockStdout();

    const { shutdown } = startNativeHost({
      port,
      stdin: stdin as any,
      stdout: stdout as any,
      timeoutMs: 1000,
    });

    try {
      // 等待 server 启动
      await new Promise((r) => setTimeout(r, 50));

      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.tools).toBe(TOOLS_COUNT);
    } finally {
      await shutdown();
    }
  });

  it('forwards stdin responses to pending HTTP requests', async () => {
    const port = testPort++;
    const stdin = createMockStdin();
    const stdout = createMockStdout();

    // 捕获 stdout 发出的消息
    const sentMessages: Buffer[] = [];
    stdout.on('data', (chunk) => sentMessages.push(chunk));

    const { shutdown } = startNativeHost({
      port,
      stdin: stdin as any,
      stdout: stdout as any,
      timeoutMs: 5000,
    });

    try {
      await new Promise((r) => setTimeout(r, 50));

      // 发起 HTTP 请求（异步，不等待）
      const fetchPromise = fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 1, method: 'tools/list' }),
      });

      // 等待 Native Host 通过 stdout 发送请求
      await new Promise((r) => setTimeout(r, 50));
      expect(sentMessages.length).toBeGreaterThan(0);

      // 解析 stdout 收到的消息，提取 requestId
      const combined = Buffer.concat(sentMessages);
      const length = combined.readUInt32LE(0);
      const body = combined.subarray(4, 4 + length);
      const nativeMsg = JSON.parse(body.toString('utf8'));
      expect(nativeMsg.requestId).toBeTruthy();
      expect(nativeMsg.mcpRequest).toEqual({ id: 1, method: 'tools/list' });

      // 通过 stdin 模拟扩展响应
      const response = encodeNativeMessage({
        requestId: nativeMsg.requestId,
        mcpResponse: { id: 1, result: { tools: [{ name: 't1' }] } },
      });
      stdin.write(response);

      const res = await fetchPromise;
      expect(res.status).toBe(200);
      const respBody = await res.json();
      expect(respBody.id).toBe(1);
      expect(respBody.result.tools).toHaveLength(1);
    } finally {
      await shutdown();
    }
  });

  it('recovers from stdin parse errors and processes subsequent valid messages', async () => {
    const port = testPort++;
    const stdin = createMockStdin();
    const stdout = createMockStdout();

    const sentMessages: Buffer[] = [];
    stdout.on('data', (chunk) => sentMessages.push(chunk));

    const { shutdown } = startNativeHost({
      port,
      stdin: stdin as any,
      stdout: stdout as any,
      timeoutMs: 5000,
    });

    try {
      await new Promise((r) => setTimeout(r, 50));

      // 发起 HTTP 请求
      const fetchPromise = fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 1, method: 'tools/list' }),
      });

      // 等待 stdout 发送请求
      await new Promise((r) => setTimeout(r, 50));
      const combined = Buffer.concat(sentMessages);
      const length = combined.readUInt32LE(0);
      const body = combined.subarray(4, 4 + length);
      const nativeMsg = JSON.parse(body.toString('utf8'));

      // 发送损坏数据（长度前缀超过 10MB），触发 parser.feed 抛错
      const corruptedHeader = Buffer.alloc(4);
      corruptedHeader.writeUInt32LE(11 * 1024 * 1024, 0);
      stdin.write(corruptedHeader);

      // 等待错误处理完成
      await new Promise((r) => setTimeout(r, 50));

      // 发送有效响应（parser 应已通过 reset() 恢复）
      const response = encodeNativeMessage({
        requestId: nativeMsg.requestId,
        mcpResponse: { id: 1, result: { tools: [{ name: 'recovered' }] } },
      });
      stdin.write(response);

      const res = await fetchPromise;
      expect(res.status).toBe(200);
      const respBody = await res.json();
      expect(respBody.result.tools).toHaveLength(1);
      expect(respBody.result.tools[0].name).toBe('recovered');
    } finally {
      await shutdown();
    }
  });

  it('shuts down on stdin EOF', async () => {
    const port = testPort++;
    const stdin = createMockStdin();
    const stdout = createMockStdout();

    const { shutdown } = startNativeHost({
      port,
      stdin: stdin as any,
      stdout: stdout as any,
      timeoutMs: 1000,
    });

    await new Promise((r) => setTimeout(r, 50));

    // 触发 stdin EOF
    stdin.end();

    // 等待关闭处理
    await new Promise((r) => setTimeout(r, 100));

    // HTTP server 应已关闭
    try {
      await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
      // 如果还能访问，说明没关闭
      throw new Error('HTTP server should be closed after stdin EOF');
    } catch (err) {
      // 预期：连接失败
      expect((err as Error).message).not.toContain('should be closed');
    }
  });

  it('rejects pending requests on shutdown', async () => {
    const port = testPort++;
    const stdin = createMockStdin();
    const stdout = createMockStdout();

    const { shutdown } = startNativeHost({
      port,
      stdin: stdin as any,
      stdout: stdout as any,
      timeoutMs: 30000, // 长超时，确保是 shutdown 触发的 reject
    });

    try {
      await new Promise((r) => setTimeout(r, 50));

      // 发起请求但不响应
      const fetchPromise = fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'tools/list' }),
      });

      await new Promise((r) => setTimeout(r, 50));

      // 主动关闭
      await shutdown();

      // fetch 应该收到 504（因为 pending 请求被 reject）
      const res = await fetchPromise;
      expect(res.status).toBe(504);
    } finally {
      // already shut down
    }
  });
});

// ─── 常量 ───

describe('constants', () => {
  it('DEFAULT_PORT is 8788', () => {
    expect(DEFAULT_PORT).toBe(8788);
  });

  it('DEFAULT_TIMEOUT_MS is 30000', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it('TOOLS_COUNT is 13', () => {
    expect(TOOLS_COUNT).toBe(13);
  });
});
