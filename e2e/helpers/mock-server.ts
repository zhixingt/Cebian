import type { Page } from '@playwright/test';

/**
 * 在 Playwright 页面中拦截并 Mock 外部 HTTP 服务请求。
 * 用于替代真实 BrowserWing / MCP Server，确保 E2E 测试不依赖外部进程。
 */

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body: object | string;
}

/**
 * Mock BrowserWing API 端点
 */
export async function mockBrowserWing(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:8080/api/v1/executor/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Parse endpoint from URL
    const endpoint = url.replace('http://127.0.0.1:8080/api/v1/executor', '');

    const responses: Record<string, MockResponse> = {
      '/navigate': { body: { success: true, url: 'https://example.com' } },
      '/snapshot': {
        body: {
          success: true,
          elements: [
            { refId: '@e1', tag: 'button', text: 'Submit' },
            { refId: '@e2', tag: 'input', type: 'text', placeholder: 'Name' },
            { refId: '@e3', tag: 'select', text: 'Country' },
          ],
        },
      },
      '/click': { body: { success: true, clicked: true } },
      '/type': { body: { success: true, typed: true } },
      '/select': { body: { success: true, selected: true } },
      '/hover': { body: { success: true } },
      '/press-key': { body: { success: true } },
      '/wait': { body: { success: true, waited: true } },
      '/extract': { body: { success: true, data: [{ title: 'Example' }] } },
      '/get-text': { body: { success: true, text: 'Hello World' } },
      '/get-value': { body: { success: true, value: 'test value' } },
      '/page-info': { body: { success: true, title: 'Example Domain', url: 'https://example.com' } },
      '/page-text': { body: { success: true, text: 'Example Domain This domain is for use in illustrative examples.' } },
      '/page-content': { body: { success: true, html: '<html><body>Example</body></html>' } },
      '/clickable-elements': { body: { success: true, elements: [{ refId: '@e1', text: 'Submit' }] } },
      '/input-elements': { body: { success: true, elements: [{ refId: '@e2', type: 'text' }] } },
      '/screenshot': { body: { success: true, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } },
      '/evaluate': { body: { success: true, result: 'document.title' } },
      '/batch': { body: { success: true, results: [{ success: true }] } },
      '/fill-form': { body: { success: true, filled: true } },
      '/scroll-to-bottom': { body: { success: true } },
      '/resize': { body: { success: true } },
      '/tabs': { body: { success: true, tabs: [{ id: 1, url: 'https://example.com' }] } },
      '/console-messages': { body: { success: true, messages: [] } },
      '/network-requests': { body: { success: true, requests: [] } },
      '/handle-dialog': { body: { success: true } },
      '/file-upload': { body: { success: true } },
      '/drag': { body: { success: true } },
      '/close-page': { body: { success: true } },
      '/go-back': { body: { success: true } },
      '/go-forward': { body: { success: true } },
      '/reload': { body: { success: true } },
      '/help': { body: { success: true, commands: ['navigate', 'click', 'type'] } },
    };

    const response = responses[endpoint] || responses[endpoint.split('?')[0]];
    if (response) {
      await route.fulfill({
        status: response.status || 200,
        headers: { 'Content-Type': 'application/json', ...(response.headers || {}) },
        body: JSON.stringify(response.body),
      });
    } else {
      await route.fulfill({
        status: 404,
        body: JSON.stringify({ error: `Mock endpoint not found: ${endpoint}` }),
      });
    }
  });
}

/**
 * Mock Playwright MCP Server
 */
export async function mockMcpServer(page: Page): Promise<void> {
  await page.route('http://localhost:3456/mcp', async (route) => {
    const request = route.request();
    const body = await request.postDataJSON().catch(() => ({}));

    if (body.method === 'tools/list') {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              { name: 'playwright_navigate', description: 'Navigate to URL', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
              { name: 'playwright_click', description: 'Click element', inputSchema: { type: 'object', properties: { selector: { type: 'string' } } } },
              { name: 'playwright_type', description: 'Type text', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } } } },
            ],
          },
        }),
      });
    } else if (body.method === 'tools/call') {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'Mock tool executed successfully' }] },
        }),
      });
    } else {
      await route.fulfill({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }) });
    }
  });

  await page.route('http://localhost:3456/health', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok' }) });
  });
}

/**
 * Mock MiniMax API（用于直接调用，非 UI 测试）
 */
export async function mockMiniMaxApi(page: Page): Promise<void> {
  await page.route('https://api.minimax.chat/**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'mock-minimax-response',
        choices: [{ message: { role: 'assistant', content: 'This is a mock response from MiniMax M3 for automated testing.' } }],
      }),
    });
  });
}

/**
 * 统一安装所有 Mock
 */
export async function installAllMocks(page: Page): Promise<void> {
  await mockBrowserWing(page);
  await mockMcpServer(page);
  await mockMiniMaxApi(page);
}
