/**
 * lib/capture/api-executor.ts 测试
 *
 * 覆盖范围：
 * - executeApiFirst：无匹配 Skill 时抛 NoMatchError
 * - 认证注入：cookie/bearer/api-key/none 各类型正确构造 headers
 * - bgFetch pattern 使用 skill.bgFetchPatterns（非硬编码）
 * - 成功/失败统计更新
 *
 * mock 策略：
 * - vi.mock skill-registry 的 findMatchingSkill/updateSkillStats/getEffectiveConfidence
 * - vi.mock @/lib/tools/bg-fetch 的 handleBgFetch
 * - vi.mock @/lib/tools/url-pattern 的 parseMatchPattern
 * - global.chrome 提供 cookies/tabs/scripting API
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── mock 内部模块 ───

vi.mock('@/lib/capture/skill-registry', () => ({
  findMatchingSkill: vi.fn(),
  updateSkillStats: vi.fn(),
  getEffectiveConfidence: vi.fn(),
}));

vi.mock('@/lib/tools/bg-fetch', () => ({
  handleBgFetch: vi.fn(),
}));

vi.mock('@/lib/tools/url-pattern', () => ({
  parseMatchPattern: vi.fn(),
}));

// ─── 导入（在 mock 之后） ───

import { executeApiFirst, NoMatchError } from '@/lib/capture/api-executor';
import {
  findMatchingSkill,
  updateSkillStats,
  getEffectiveConfidence,
} from '@/lib/capture/skill-registry';
import { handleBgFetch } from '@/lib/tools/bg-fetch';
import { parseMatchPattern } from '@/lib/tools/url-pattern';
import type { AutoSkillDefinition } from '@/lib/capture/types';
import type { MatchPattern as UrlMatchPattern } from '@/lib/tools/url-pattern';

// ─── mock 引用 ───

const mockFindMatchingSkill = vi.mocked(findMatchingSkill);
const mockUpdateSkillStats = vi.mocked(updateSkillStats);
const mockGetEffectiveConfidence = vi.mocked(getEffectiveConfidence);
const mockHandleBgFetch = vi.mocked(handleBgFetch);
const mockParseMatchPattern = vi.mocked(parseMatchPattern);

// ─── 测试辅助 ───

function makeSkill(overrides: Partial<AutoSkillDefinition> = {}): AutoSkillDefinition {
  return {
    name: 'auto-api-example-com-get-api-users-id',
    description: 'Auto-discovered API: GET /api/users/{id}',
    endpointId: 'GET|/api/users/{id}',
    hostname: 'api.example.com',
    method: 'GET',
    authType: 'none',
    pathname: '/api/users/{id}',
    bgFetchPatterns: ['https://api.example.com/api/users/*'],
    script: '',
    initialConfidence: 0.7,
    enabled: true,
    createdAt: Date.now(),
    stats: {
      callCount: 0,
      successCount: 0,
      failureCount: 0,
      lastCalledAt: null,
      dynamicConfidence: 0,
    },
    ...overrides,
  };
}

/** 构造一个有效的 MatchPattern mock 返回值 */
function makeMatchPattern(): UrlMatchPattern {
  return {
    scheme: 'https',
    host: 'api.example.com',
    pathGlob: '/api/users/*',
    pathRe: /^\/api\/users\/.*$/,
    isAllUrls: false,
  };
}

/** 构造一个成功的 bgFetch 响应（200 + JSON body） */
function makeBgFetchResponse(body: unknown = { ok: true }, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    redirected: false,
    url: 'https://api.example.com/api/users/1',
    headersFlat: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(text),
  };
}

/** 设置 chrome API mock */
function setupChromeApi(opts: {
  cookies?: Array<{ name: string; value: string }>;
  tabs?: Array<{ id: number }>;
  scriptResult?: Array<{ result: Record<string, string> | null }>;
} = {}) {
  const cookies = opts.cookies ?? [];
  const tabs = opts.tabs ?? [];
  const scriptResult = opts.scriptResult ?? [];

  (global as any).chrome = {
    cookies: {
      getAll: vi.fn().mockResolvedValue(cookies),
    },
    tabs: {
      query: vi.fn().mockResolvedValue(tabs),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue(scriptResult),
    },
  };
}

// ─── 测试套件 ───

describe('api-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认 mock 实现
    mockFindMatchingSkill.mockResolvedValue(null);
    mockUpdateSkillStats.mockResolvedValue(undefined);
    mockGetEffectiveConfidence.mockReturnValue(0.7);
    mockParseMatchPattern.mockReturnValue(makeMatchPattern());
    mockHandleBgFetch.mockResolvedValue(makeBgFetchResponse());

    // 默认 chrome API（无认证数据）
    setupChromeApi();
  });

  afterEach(() => {
    delete (global as any).chrome;
  });

  // ─── 无匹配 Skill ───

  describe('NoMatchError', () => {
    it('findMatchingSkill 返回 null 时抛 NoMatchError', async () => {
      mockFindMatchingSkill.mockResolvedValue(null);

      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow(NoMatchError);

      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow('No matching API skill');
    });

    it('NoMatchError 的 name 属性为 NoMatchError', async () => {
      mockFindMatchingSkill.mockResolvedValue(null);

      try {
        await executeApiFirst('https://api.example.com/api/users/1', 'GET');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NoMatchError);
        expect((err as Error).name).toBe('NoMatchError');
      }
    });

    it('无匹配 Skill 时不调用 updateSkillStats', async () => {
      mockFindMatchingSkill.mockResolvedValue(null);

      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow();

      expect(mockUpdateSkillStats).not.toHaveBeenCalled();
    });

    it('非法 URL 抛 NoMatchError', async () => {
      // 即使有匹配的 Skill，非法 URL 也抛错
      mockFindMatchingSkill.mockResolvedValue(makeSkill());

      await expect(
        executeApiFirst('not-a-valid-url', 'GET'),
      ).rejects.toThrow(NoMatchError);
    });
  });

  // ─── 认证注入 ───

  describe('认证注入', () => {
    it('authType=cookie：从 chrome.cookies.getAll 读取并注入 Cookie header', async () => {
      const skill = makeSkill({ authType: 'cookie' });
      mockFindMatchingSkill.mockResolvedValue(skill);
      setupChromeApi({
        cookies: [
          { name: 'session', value: 'abc' },
          { name: 'token', value: 'xyz' },
        ],
      });

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      expect(chrome.cookies.getAll).toHaveBeenCalledWith({ domain: 'api.example.com' });
      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['Cookie']).toBe('session=abc; token=xyz');
    });

    it('authType=cookie：无 cookie 时不注入 Cookie header', async () => {
      const skill = makeSkill({ authType: 'cookie' });
      mockFindMatchingSkill.mockResolvedValue(skill);
      setupChromeApi({ cookies: [] });

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['Cookie']).toBeUndefined();
    });

    it('authType=bearer：从 localStorage 读取 token 并注入 Authorization: Bearer xxx', async () => {
      const skill = makeSkill({ authType: 'bearer' });
      mockFindMatchingSkill.mockResolvedValue(skill);
      setupChromeApi({
        tabs: [{ id: 42 }],
        scriptResult: [{ result: { token: 'tok-abc' } }],
      });

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      expect(chrome.tabs.query).toHaveBeenCalledWith({ url: '*://api.example.com/*' });
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({ target: { tabId: 42 } }),
      );
      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['Authorization']).toBe('Bearer tok-abc');
    });

    it('authType=api-key + authHeaderName=x-api-key：注入 x-api-key header', async () => {
      const skill = makeSkill({ authType: 'api-key', authHeaderName: 'x-api-key' });
      mockFindMatchingSkill.mockResolvedValue(skill);
      setupChromeApi({
        tabs: [{ id: 42 }],
        scriptResult: [{ result: { access_token: 'sk-xyz' } }],
      });

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['x-api-key']).toBe('sk-xyz');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('authType=api-key 无 authHeaderName：默认使用 Authorization header（不加 Bearer 前缀）', async () => {
      const skill = makeSkill({ authType: 'api-key', authHeaderName: undefined });
      mockFindMatchingSkill.mockResolvedValue(skill);
      setupChromeApi({
        tabs: [{ id: 42 }],
        scriptResult: [{ result: { jwt: 'jwt-123' } }],
      });

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['Authorization']).toBe('jwt-123');
    });

    it('authType=none：不注入任何认证 header', async () => {
      const skill = makeSkill({ authType: 'none' });
      mockFindMatchingSkill.mockResolvedValue(skill);

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      // chrome.cookies/tabs/scripting 不应被调用
      expect(chrome.cookies.getAll).not.toHaveBeenCalled();
      expect(chrome.tabs.query).not.toHaveBeenCalled();
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['Cookie']).toBeUndefined();
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['x-api-key']).toBeUndefined();
    });

    it('authType=bearer 但无可用 tab：不注入认证 header（不报错）', async () => {
      const skill = makeSkill({ authType: 'bearer' });
      mockFindMatchingSkill.mockResolvedValue(skill);
      setupChromeApi({ tabs: [] }); // 无匹配 tab

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('authType=bearer 但 scriptResult 为空：不注入认证 header', async () => {
      const skill = makeSkill({ authType: 'bearer' });
      mockFindMatchingSkill.mockResolvedValue(skill);
      setupChromeApi({
        tabs: [{ id: 42 }],
        scriptResult: [{ result: null }],
      });

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('所有认证类型都保留 Content-Type: application/json', async () => {
      const skill = makeSkill({ authType: 'none' });
      mockFindMatchingSkill.mockResolvedValue(skill);

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { headers: Record<string, string> }, unknown[]];
      const headers = callArgs[1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  // ─── bgFetch pattern ───

  describe('bgFetch pattern 使用 skill.bgFetchPatterns', () => {
    it('parseMatchPattern 对 skill.bgFetchPatterns 中每条 pattern 调用一次', async () => {
      const skill = makeSkill({
        bgFetchPatterns: [
          'https://api.example.com/api/users/*',
          'https://api.example.com/api/admin/*',
        ],
      });
      mockFindMatchingSkill.mockResolvedValue(skill);

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      expect(mockParseMatchPattern).toHaveBeenCalledTimes(2);
      expect(mockParseMatchPattern).toHaveBeenCalledWith('https://api.example.com/api/users/*');
      expect(mockParseMatchPattern).toHaveBeenCalledWith('https://api.example.com/api/admin/*');
    });

    it('handleBgFetch 接收 parseMatchPattern 解析后的 patterns（非原始字符串）', async () => {
      const skill = makeSkill({
        bgFetchPatterns: ['https://api.example.com/api/users/*'],
      });
      mockFindMatchingSkill.mockResolvedValue(skill);
      const parsedPattern = makeMatchPattern();
      mockParseMatchPattern.mockReturnValue(parsedPattern);

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0];
      const patternsArg = callArgs[2];
      expect(patternsArg).toEqual([parsedPattern]);
    });

    it('使用 skill 声明的 patterns，而非硬编码通配符', async () => {
      const customPatterns = ['https://custom.host/api/*'];
      const skill = makeSkill({ bgFetchPatterns: customPatterns });
      mockFindMatchingSkill.mockResolvedValue(skill);

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      expect(mockParseMatchPattern).toHaveBeenCalledWith('https://custom.host/api/*');
      // 不应硬编码使用 *://*/* 或 <all_urls>
      expect(mockParseMatchPattern).not.toHaveBeenCalledWith('*://*/*');
      expect(mockParseMatchPattern).not.toHaveBeenCalledWith('<all_urls>');
    });

    it('所有 pattern 解析失败时抛 NoMatchError', async () => {
      const skill = makeSkill({
        bgFetchPatterns: ['invalid-pattern'],
      });
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockParseMatchPattern.mockReturnValue(null as any);

      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow(NoMatchError);

      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow('No valid bgFetch patterns');
    });

    it('部分 pattern 解析失败时仍使用有效的 pattern', async () => {
      const skill = makeSkill({
        bgFetchPatterns: ['invalid', 'https://api.example.com/api/users/*'],
      });
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockParseMatchPattern
        .mockReturnValueOnce(null as any)
        .mockReturnValueOnce(makeMatchPattern());

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0];
      const patternsArg = callArgs[2] as unknown[];
      expect(patternsArg).toHaveLength(1);
    });
  });

  // ─── 成功/失败统计更新 ───

  describe('成功/失败统计更新', () => {
    it('API 返回 2xx：updateSkillStats 以 success=true 调用', async () => {
      const skill = makeSkill();
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockHandleBgFetch.mockResolvedValue(makeBgFetchResponse({ ok: true }, 200));

      const result = await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      expect(result.success).toBe(true);
      expect(result.path).toBe('api');
      expect(mockUpdateSkillStats).toHaveBeenCalledWith(skill.name, true);
      expect(mockUpdateSkillStats).toHaveBeenCalledTimes(1);
    });

    it('API 返回 201：updateSkillStats 以 success=true 调用', async () => {
      const skill = makeSkill();
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockHandleBgFetch.mockResolvedValue(makeBgFetchResponse({ created: true }, 201));

      const result = await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(mockUpdateSkillStats).toHaveBeenCalledWith(skill.name, true);
    });

    it('API 返回 4xx/5xx：updateSkillStats 以 success=false 调用并抛 NoMatchError', async () => {
      const skill = makeSkill();
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockHandleBgFetch.mockResolvedValue(makeBgFetchResponse({ error: 'not found' }, 404));

      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow(NoMatchError);

      expect(mockUpdateSkillStats).toHaveBeenCalledWith(skill.name, false);
      expect(mockUpdateSkillStats).toHaveBeenCalledTimes(1);
    });

    it('API 返回 500：updateSkillStats 以 success=false 调用', async () => {
      const skill = makeSkill();
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockHandleBgFetch.mockResolvedValue(makeBgFetchResponse({ error: 'server' }, 500));

      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow(NoMatchError);

      expect(mockUpdateSkillStats).toHaveBeenCalledWith(skill.name, false);
    });

    it('bgFetch 抛出网络错误：updateSkillStats 以 success=false 调用并抛 NoMatchError', async () => {
      const skill = makeSkill();
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockHandleBgFetch.mockRejectedValue(new Error('Network timeout'));

      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow(NoMatchError);
      await expect(
        executeApiFirst('https://api.example.com/api/users/1', 'GET'),
      ).rejects.toThrow('Network timeout');

      expect(mockUpdateSkillStats).toHaveBeenCalledWith(skill.name, false);
    });

    it('成功结果包含 skillName/confidence/latencyMs', async () => {
      const skill = makeSkill({ name: 'my-skill' });
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockGetEffectiveConfidence.mockReturnValue(0.85);

      const result = await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      expect(result.skillName).toBe('my-skill');
      expect(result.confidence).toBe(0.85);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.path).toBe('api');
    });

    it('成功结果包含解码后的响应数据', async () => {
      const skill = makeSkill();
      mockFindMatchingSkill.mockResolvedValue(skill);
      mockHandleBgFetch.mockResolvedValue(
        makeBgFetchResponse({ id: 1, name: 'alice' }, 200),
      );

      const result = await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      expect(result.data).toEqual({ id: 1, name: 'alice' });
      expect(result.status).toBe(200);
    });

    it('POST 请求带 body 数据', async () => {
      const skill = makeSkill({ method: 'POST' });
      mockFindMatchingSkill.mockResolvedValue(skill);

      await executeApiFirst(
        'https://api.example.com/api/users',
        'POST',
        undefined,
        { name: 'bob', age: 30 },
      );

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { method: string; body?: string }, unknown[]];
      const init = callArgs[1];
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ name: 'bob', age: 30 }));
    });

    it('GET 请求不带 body', async () => {
      const skill = makeSkill({ method: 'GET' });
      mockFindMatchingSkill.mockResolvedValue(skill);

      await executeApiFirst('https://api.example.com/api/users/1', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { method: string; body?: string }, unknown[]];
      const init = callArgs[1];
      expect(init.body).toBeUndefined();
    });

    it('使用 skill.method 而非传入的 method 参数', async () => {
      const skill = makeSkill({ method: 'POST' });
      mockFindMatchingSkill.mockResolvedValue(skill);

      // 传入 GET 但 skill.method 是 POST，应使用 skill.method
      await executeApiFirst('https://api.example.com/api/users', 'GET');

      const callArgs = mockHandleBgFetch.mock.calls[0] as [string, { method: string }, unknown[]];
      expect(callArgs[1].method).toBe('POST');
    });
  });
});
