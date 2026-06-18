import http from 'node:http';
import { testConfig } from './config.js';

export interface MockServerState {
  llmRequests: any[];
  mcpRequests: any[];
  browserwingRequests: any[];
}

export interface MockServers {
  llm: http.Server;
  mcp: http.Server;
  browserwing: http.Server;
  state: MockServerState;
  close: () => Promise<void>;
}

const state: MockServerState = {
  llmRequests: [],
  mcpRequests: [],
  browserwingRequests: [],
};

function sendJson(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

export function startMockServers(): Promise<MockServers> {
  return new Promise((resolve, reject) => {
    let readyCount = 0;
    const total = 3;

    const llm = http.createServer(async (req, res) => {
      const body = await readBody(req);
      try {
        state.llmRequests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      } catch { /* ignore */ }

      // Mock LLM 返回固定流式响应
      if (req.url?.includes('/chat/completions')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        const id = 'mock-msg-' + Date.now();
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ delta: { role: 'assistant', content: '这是' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ delta: { content: '一个预设的 Mock 响应。' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ delta: { content: '' }, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      sendJson(res, { ok: true });
    });

    const mcp = http.createServer(async (req, res) => {
      const body = await readBody(req);
      try {
        state.mcpRequests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      } catch { /* ignore */ }

      // MCP streamableHttp 模拟
      if (req.url === '/mcp') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'navigate', description: 'Navigate to a URL' }, { name: 'click', description: 'Click an element' }, { name: 'type', description: 'Type text' }] } }));
        return;
      }
      if (req.url === '/sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write('event: endpoint\ndata: /mcp\n\n');
        res.end();
        return;
      }

      sendJson(res, { jsonrpc: '2.0', id: 1, result: {} });
    });

    const browserwing = http.createServer(async (req, res) => {
      const body = await readBody(req);
      try {
        state.browserwingRequests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      } catch { /* ignore */ }

      const url = req.url ?? '/';

      if (url === '/navigate') {
        sendJson(res, { success: true, url: 'https://example.com' });
        return;
      }
      if (url === '/snapshot') {
        sendJson(res, { title: 'Example Domain', url: 'https://example.com', elements: [{ refId: '@e1', tag: 'button', text: 'Submit' }, { refId: '@e2', tag: 'input', name: 'username' }] });
        return;
      }
      if (url === '/click') {
        sendJson(res, { success: true, clicked: '@e1' });
        return;
      }
      if (url === '/type') {
        sendJson(res, { success: true, typed: '@e2', text: 'hello' });
        return;
      }
      if (url === '/batch') {
        sendJson(res, { success: true, completed: 3 });
        return;
      }
      if (url === '/fillForm') {
        sendJson(res, { success: true, filled: ['username', 'password'] });
        return;
      }
      if (url === '/screenshot') {
        sendJson(res, { success: true, data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
        return;
      }
      if (url === '/evaluate') {
        sendJson(res, { success: true, result: 'document.title' });
        return;
      }
      if (url === '/batch-fill') {
        sendJson(res, { total: 3, success: 3, failed: 0, results: [] });
        return;
      }

      sendJson(res, { success: false, error: `Unknown action: ${url}` }, 404);
    });

    const checkReady = () => {
      readyCount++;
      if (readyCount === total) {
        resolve({
          llm,
          mcp,
          browserwing,
          state,
          close: async () => {
            await new Promise<void>((r) => llm.close(() => r()));
            await new Promise<void>((r) => mcp.close(() => r()));
            await new Promise<void>((r) => browserwing.close(() => r()));
          },
        });
      }
    };

    llm.on('error', reject);
    mcp.on('error', reject);
    browserwing.on('error', reject);

    llm.listen(testConfig.mockServers.llmPort, '127.0.0.1', checkReady);
    mcp.listen(testConfig.mockServers.mcpPort, '127.0.0.1', checkReady);
    browserwing.listen(testConfig.mockServers.browserwingPort, '127.0.0.1', checkReady);
  });
}

export function getMockServerState(): MockServerState {
  return state;
}

export function clearMockServerState(): void {
  state.llmRequests.length = 0;
  state.mcpRequests.length = 0;
  state.browserwingRequests.length = 0;
}
