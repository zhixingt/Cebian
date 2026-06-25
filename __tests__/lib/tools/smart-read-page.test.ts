/**
 * lib/tools/smart-read-page.ts 测试
 *
 * 覆盖范围：
 * - mode='json' + url 时走 API 路径（成功）
 * - 匹配 Skill 未通过自动调用策略时直接回退 DOM
 * - NoMatchError 时回退到 readPageTool（markdown 模式）
 * - 非 NoMatchError 异常时 re-throw
 * - mode='markdown' 时直接走 DOM
 * - mode='text' 时直接走 DOM
 * - 无 url 时直接走 DOM
 *
 * mock 策略：
 * - vi.mock '@/lib/capture/api-executor' 的 executeApiFirst 和 NoMatchError
 * - vi.mock '@/lib/capture/skill-registry' 的 findMatchingSkill
 * - vi.mock './read-page' 的 readPageTool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

// ─── mock 外部依赖 ───

// NoMatchError 必须是一个真实的 class，这样 `err instanceof NoMatchError` 才能工作
// 使用 vi.hoisted 确保 class 定义在 vi.mock 工厂执行前就已就绪
const { NoMatchError } = vi.hoisted(() => {
  class NoMatchError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NoMatchError';
    }
  }
  return { NoMatchError };
});

vi.mock('@/lib/capture/api-executor', () => ({
  executeApiFirst: vi.fn(),
  NoMatchError,
}));

vi.mock(import('@/lib/capture/skill-registry'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findMatchingSkill: vi.fn(),
  };
});

vi.mock('@/lib/tools/read-page', () => ({
  readPageTool: {
    name: 'read_page',
    execute: vi.fn(),
  },
}));

// ─── 导入（在 mock 之后） ───

import { smartReadPageTool } from '@/lib/tools/smart-read-page';
import { executeApiFirst, NoMatchError as MockNoMatchError } from '@/lib/capture/api-executor';
import { findMatchingSkill } from '@/lib/capture/skill-registry';
import { readPageTool } from '@/lib/tools/read-page';
import type { AutoSkillDefinition } from '@/lib/capture/types';

// ─── mock 引用 ───

const mockExecuteApiFirst = vi.mocked(executeApiFirst);
const mockFindMatchingSkill = vi.mocked(findMatchingSkill);
const mockReadPageExecute = vi.mocked(readPageTool.execute);

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
    initialConfidence: 0.85,
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

/** 构造一个成功的 executeApiFirst 返回值 */
function makeApiResult(overrides: Partial<{
  success: boolean;
  data: unknown;
  status: number;
  latencyMs: number;
  skillName: string;
  confidence: number;
  path: 'api' | 'fallback';
  method: string;
}> = {}) {
  return {
    success: true,
    data: { id: 1, name: 'alice' },
    status: 200,
    latencyMs: 42,
    skillName: 'auto-api-example-com-get-api-users',
    confidence: 0.85,
    path: 'api' as const,
    method: 'GET',
    ...overrides,
  };
}

/** 构造一个 readPageTool 的成功返回值 */
function makeReadPageResult(text: string = '# Page content') {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认返回一个可通过策略检查的高置信度 GET Skill
  mockFindMatchingSkill.mockResolvedValue(makeSkill());
});

// ─── 测试套件 ───

describe('smart-read-page', () => {
  // ─── mode='json' + url：走 API 路径 ───

  describe("mode='json' + url：走 API 路径", () => {
    it('成功时返回 API 结果（JSON 字符串）', async () => {
      mockExecuteApiFirst.mockResolvedValue(makeApiResult({
        data: { id: 1, name: 'alice' },
        latencyMs: 42,
        skillName: 'auto-skill-1',
        confidence: 0.85,
      }));

      const result = await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'json',
        url: 'https://api.example.com/users/1',
        intent: 'get user',
      });

      // 应该调用 findMatchingSkill 与 executeApiFirst
      expect(mockFindMatchingSkill).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        'get user',
      );
      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        undefined,
        'get user',
      );
      // 不应该调用 readPageTool
      expect(mockReadPageExecute).not.toHaveBeenCalled();

      // 返回值是 JSON 字符串
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toEqual({
        path: 'api',
        data: { id: 1, name: 'alice' },
        latency_ms: 42,
        skill_id: 'auto-skill-1',
        confidence: 0.85,
        method: 'GET',
      });
    });

    it('无 intent 时也走 API 路径', async () => {
      mockExecuteApiFirst.mockResolvedValue(makeApiResult());

      await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'json',
        url: 'https://api.example.com/users/1',
      });

      expect(mockFindMatchingSkill).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        undefined,
      );
      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        undefined,
        undefined,
      );
    });

    it('调用方传入 method=GET 时走 API 路径', async () => {
      mockExecuteApiFirst.mockResolvedValue(makeApiResult({
        method: 'GET',
        skillName: 'auto-get-skill',
      }));

      const result = await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'json',
        url: 'https://api.example.com/users/1',
        method: 'GET',
        intent: 'get user',
      });

      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        'GET',
        'get user',
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.method).toBe('GET');
      expect(parsed.skill_id).toBe('auto-get-skill');
    });
  });

  // ─── 自动调用策略拦截：直接回退 DOM ───

  describe('自动调用策略拦截：直接回退 DOM', () => {
    it('当匹配到的 Skill 是 POST 时，由于 canAutoInvokeSkill 返回 false，应 fallback 到 DOM，不调用 executeApiFirst', async () => {
      mockFindMatchingSkill.mockResolvedValue(makeSkill({ method: 'POST' }));
      mockReadPageExecute.mockResolvedValue(makeReadPageResult('# DOM content'));

      const result = await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'json',
        url: 'https://api.example.com/users',
        intent: 'create user',
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'markdown' });
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('[fallback:'),
      });
      expect((result.content[0] as { text: string }).text).toContain('# DOM content');
    });

    it('当匹配到的 Skill 置信度低于 0.8 时，应 fallback 到 DOM', async () => {
      mockFindMatchingSkill.mockResolvedValue(makeSkill({ initialConfidence: 0.75 }));
      mockReadPageExecute.mockResolvedValue(makeReadPageResult());

      await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'json',
        url: 'https://api.example.com/users/1',
        intent: 'get user',
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'markdown' });
    });
  });

  // ─── NoMatchError 时回退到 readPageTool（markdown 模式） ───

  describe('NoMatchError 时回退到 readPageTool', () => {
    it('回退时调用 readPageTool 并以 markdown 模式', async () => {
      const noMatch = new MockNoMatchError('No matching API skill for GET https://api.example.com/users/1');
      mockExecuteApiFirst.mockRejectedValue(noMatch);
      mockReadPageExecute.mockResolvedValue(makeReadPageResult('# Hello'));

      const result = await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'json',
        url: 'https://api.example.com/users/1',
      });

      // 应该调用 readPageTool，使用 markdown 模式
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'markdown' });

      // 返回值前面加上 [fallback: ...]
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('[fallback: No matching API skill');
      expect(text).toContain('# Hello');
    });

    it('回退时使用 _toolCallId 而非新的 id', async () => {
      mockExecuteApiFirst.mockRejectedValue(new MockNoMatchError('no match'));
      mockReadPageExecute.mockResolvedValue(makeReadPageResult());

      await smartReadPageTool.execute('my-tool-call-id', {
        tabId: 42,
        mode: 'json',
        url: 'https://api.example.com/users/1',
      });

      expect(mockReadPageExecute).toHaveBeenCalledWith('my-tool-call-id', expect.anything());
    });

    it('回退时 readPageTool 返回非 text content 时直接返回 fallback', async () => {
      mockExecuteApiFirst.mockRejectedValue(new MockNoMatchError('no match'));
      // 假设返回非 text content（虽然实际不会发生，但测试覆盖该分支）
      mockReadPageExecute.mockResolvedValue({
        content: [{ type: 'image' as const, data: 'base64...', mimeType: 'image/png' }],
        details: {},
      } satisfies AgentToolResult<unknown>);

      const result = await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'json',
        url: 'https://api.example.com/users/1',
      });

      // 直接返回 fallback 结果（不修改 content）
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('image');
    });
  });

  // ─── 非 NoMatchError 异常时 re-throw ───

  describe('非 NoMatchError 异常时 re-throw', () => {
    it('普通 Error 被重新抛出', async () => {
      const err = new Error('Network timeout');
      mockExecuteApiFirst.mockRejectedValue(err);

      await expect(
        smartReadPageTool.execute('call-1', {
          tabId: 42,
          mode: 'json',
          url: 'https://api.example.com/users/1',
        }),
      ).rejects.toThrow('Network timeout');

      // 不应该调用 readPageTool
      expect(mockReadPageExecute).not.toHaveBeenCalled();
    });

    it('字符串错误被重新抛出', async () => {
      mockExecuteApiFirst.mockRejectedValue('some string error');

      await expect(
        smartReadPageTool.execute('call-1', {
          tabId: 42,
          mode: 'json',
          url: 'https://api.example.com/users/1',
        }),
      ).rejects.toBe('some string error');

      expect(mockReadPageExecute).not.toHaveBeenCalled();
    });
  });

  // ─── mode='markdown' 时直接走 DOM ───

  describe("mode='markdown' 时直接走 DOM", () => {
    it('不调用 executeApiFirst，直接调用 readPageTool', async () => {
      mockReadPageExecute.mockResolvedValue(makeReadPageResult('# Markdown'));

      const result = await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'markdown',
      });

      expect(mockFindMatchingSkill).not.toHaveBeenCalled();
      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'markdown' });
      expect(result.content[0]).toMatchObject({ type: 'text', text: '# Markdown' });
    });

    it('即使有 url 也不走 API（mode 非 json）', async () => {
      mockReadPageExecute.mockResolvedValue(makeReadPageResult());

      await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'markdown',
        url: 'https://api.example.com/users/1',
      });

      expect(mockFindMatchingSkill).not.toHaveBeenCalled();
      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'markdown' });
    });
  });

  // ─── mode='text' 时直接走 DOM ───

  describe("mode='text' 时直接走 DOM", () => {
    it('不调用 executeApiFirst，直接调用 readPageTool（text 模式）', async () => {
      mockReadPageExecute.mockResolvedValue(makeReadPageResult('plain text'));

      const result = await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'text',
      });

      expect(mockFindMatchingSkill).not.toHaveBeenCalled();
      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'text' });
      expect(result.content[0]).toMatchObject({ type: 'text', text: 'plain text' });
    });

    it('即使有 url 也不走 API（mode=text）', async () => {
      mockReadPageExecute.mockResolvedValue(makeReadPageResult());

      await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'text',
        url: 'https://api.example.com/users/1',
      });

      expect(mockFindMatchingSkill).not.toHaveBeenCalled();
      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'text' });
    });
  });

  // ─── 无 url 时直接走 DOM ───

  describe('无 url 时直接走 DOM', () => {
    it('mode=json 但无 url 时走 DOM（默认 markdown）', async () => {
      mockReadPageExecute.mockResolvedValue(makeReadPageResult('# Default'));

      const result = await smartReadPageTool.execute('call-1', {
        tabId: 42,
        mode: 'json',
        // 无 url
      });

      expect(mockFindMatchingSkill).not.toHaveBeenCalled();
      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      // mode=json 但无 url → 走 DOM，domMode 为 'markdown'（因为 mode !== 'text'）
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'markdown' });
      expect(result.content[0]).toMatchObject({ type: 'text', text: '# Default' });
    });

    it('无 mode 无 url 时走 DOM（默认 markdown）', async () => {
      mockReadPageExecute.mockResolvedValue(makeReadPageResult());

      await smartReadPageTool.execute('call-1', {
        tabId: 42,
      });

      expect(mockFindMatchingSkill).not.toHaveBeenCalled();
      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockReadPageExecute).toHaveBeenCalledWith('call-1', { tabId: 42, mode: 'markdown' });
    });
  });
});
