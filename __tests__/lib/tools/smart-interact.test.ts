/**
 * lib/tools/smart-interact.ts 测试
 *
 * 覆盖范围：
 * - action='api_submit' + url 时走 API 路径（POST）
 * - action='api_fill_form' + url 时走 API 路径（GET）
 * - 写操作 API 需要用户确认（confirmed=true 后才执行）
 * - GET Skill 无需确认直接执行
 * - 未启用的 Skill 直接拒绝
 * - NoMatchError 时回退：api_submit→click, api_fill_form→type
 * - 非 NoMatchError 异常时 re-throw
 * - action='click' 时直接走 DOM
 * - 无 url 时直接走 DOM
 *
 * mock 策略：
 * - vi.mock '@/lib/capture/api-executor' 的 executeApiFirst 和 NoMatchError
 * - vi.mock '@/lib/capture/skill-registry' 的 findMatchingSkill
 * - vi.mock '@/lib/capture/api-policy' 的 requiresConfirmation、canAutoInvokeSkill
 * - vi.mock './interact' 的 interactTool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutoSkillDefinition } from '@/lib/capture/types';

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

vi.mock('@/lib/capture/skill-registry', () => ({
  findMatchingSkill: vi.fn(),
}));

vi.mock('@/lib/capture/api-policy', () => ({
  requiresConfirmation: vi.fn(),
  canAutoInvokeSkill: vi.fn(),
}));

vi.mock('@/lib/tools/interact', () => ({
  interactTool: {
    name: 'interact',
    execute: vi.fn(),
  },
}));

// ─── 导入（在 mock 之后） ───

import { smartInteractTool } from '@/lib/tools/smart-interact';
import { executeApiFirst, NoMatchError as MockNoMatchError } from '@/lib/capture/api-executor';
import { findMatchingSkill } from '@/lib/capture/skill-registry';
import { requiresConfirmation, canAutoInvokeSkill } from '@/lib/capture/api-policy';
import { interactTool } from '@/lib/tools/interact';

// ─── mock 引用 ───

const mockExecuteApiFirst = vi.mocked(executeApiFirst);
const mockFindMatchingSkill = vi.mocked(findMatchingSkill);
const mockRequiresConfirmation = vi.mocked(requiresConfirmation);
const mockCanAutoInvokeSkill = vi.mocked(canAutoInvokeSkill);
const mockInteractExecute = vi.mocked(interactTool.execute);

// ─── 测试辅助 ───

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
    data: { ok: true },
    status: 200,
    latencyMs: 30,
    skillName: 'auto-skill-1',
    confidence: 0.8,
    path: 'api' as const,
    method: 'GET',
    ...overrides,
  };
}

/** 构造一个 interactTool 的成功返回值 */
function makeInteractResult(text: string = 'Clicked: #btn') {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  };
}

/** 构造一个 AutoSkillDefinition（用于 findMatchingSkill mock） */
function makeSkill(overrides: Partial<AutoSkillDefinition> = {}): AutoSkillDefinition {
  return {
    name: 'auto-api-example-com-post-api-users',
    description: 'Auto-discovered API: POST /api/users',
    endpointId: 'POST|/api/users',
    hostname: 'api.example.com',
    method: 'POST',
    authType: 'none',
    pathname: '/api/users',
    bgFetchPatterns: ['https://api.example.com/api/users'],
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

beforeEach(() => {
  vi.clearAllMocks();
  // 默认无需确认，避免影响现有测试
  mockRequiresConfirmation.mockReturnValue(false);
  mockCanAutoInvokeSkill.mockReturnValue({ allowed: true, reason: 'Read-only GET skill with sufficient confidence' });
});

// ─── 测试套件 ───

describe('smart-interact', () => {
  // ─── action='api_submit' + url：走 API 路径（POST） ───

  describe("action='api_submit' + url：走 API 路径（POST）", () => {
    it('成功时使用 POST 方法调用 executeApiFirst', async () => {
      const postSkill = makeSkill({
        name: 'auto-submit-skill',
        method: 'POST',
        pathname: '/users',
      });
      mockFindMatchingSkill.mockResolvedValue(postSkill);
      mockExecuteApiFirst.mockResolvedValue(makeApiResult({
        data: { id: 1 },
        latencyMs: 30,
        skillName: 'auto-submit-skill',
        confidence: 0.8,
      }));

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_submit',
        url: 'https://api.example.com/users',
        intent: 'create user',
        data: { name: 'bob' },
      });

      // 应该用 POST 方法调用 executeApiFirst，并传入已匹配的 Skill
      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/users',
        'POST',
        'create user',
        { name: 'bob' },
        postSkill,
      );
      // 不应该调用 interactTool
      expect(mockInteractExecute).not.toHaveBeenCalled();

      // 返回值是 JSON 字符串
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toEqual({
        success: true,
        path: 'api',
        response: { id: 1 },
        latency_ms: 30,
        skill_id: 'auto-submit-skill',
        confidence: 0.8,
      });
    });

    it('无 intent 和 data 时也走 API 路径', async () => {
      const postSkill = makeSkill({ method: 'POST', pathname: '/users' });
      mockFindMatchingSkill.mockResolvedValue(postSkill);
      mockExecuteApiFirst.mockResolvedValue(makeApiResult());

      await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_submit',
        url: 'https://api.example.com/users',
      });

      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/users',
        'POST',
        undefined,
        undefined,
        postSkill,
      );
    });
  });

  // ─── action='api_fill_form' + url：走 API 路径（GET） ───

  describe("action='api_fill_form' + url：走 API 路径（GET）", () => {
    it('成功时使用 GET 方法调用 executeApiFirst', async () => {
      const getSkill = makeSkill({
        name: 'auto-fill-skill',
        method: 'GET',
        pathname: '/form',
        initialConfidence: 0.9,
      });
      mockFindMatchingSkill.mockResolvedValue(getSkill);
      mockExecuteApiFirst.mockResolvedValue(makeApiResult({
        data: { form: 'data' },
        latencyMs: 15,
        skillName: 'auto-fill-skill',
        confidence: 0.9,
      }));

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_fill_form',
        url: 'https://api.example.com/form',
        intent: 'get form',
      });

      // 应该用 GET 方法调用 executeApiFirst，并传入已匹配的 Skill
      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/form',
        'GET',
        'get form',
        undefined,
        getSkill,
      );
      expect(mockInteractExecute).not.toHaveBeenCalled();

      // 返回值是 JSON 字符串
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toEqual({
        success: true,
        path: 'api',
        response: { form: 'data' },
        latency_ms: 15,
        skill_id: 'auto-fill-skill',
        confidence: 0.9,
      });
    });

    it('api_fill_form 不传 data 时仍走 API（GET）', async () => {
      const getSkill = makeSkill({ method: 'GET', pathname: '/form' });
      mockFindMatchingSkill.mockResolvedValue(getSkill);
      mockExecuteApiFirst.mockResolvedValue(makeApiResult());

      await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_fill_form',
        url: 'https://api.example.com/form',
      });

      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/form',
        'GET',
        undefined,
        undefined,
        getSkill,
      );
    });
  });

  // ─── 写操作安全闸门 ───

  describe('写操作安全闸门', () => {
    it('POST Skill 未确认时被阻止，返回确认请求消息', async () => {
      const postSkill = makeSkill({
        name: 'auto-submit-skill',
        method: 'POST',
        pathname: '/users',
      });
      mockFindMatchingSkill.mockResolvedValue(postSkill);
      mockRequiresConfirmation.mockReturnValue(true);
      mockCanAutoInvokeSkill.mockReturnValue({
        allowed: false,
        reason: 'Auto-invoke only allowed for GET skills, got POST',
      });

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_submit',
        url: 'https://api.example.com/users',
        intent: 'create user',
        data: { name: 'bob' },
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockInteractExecute).not.toHaveBeenCalled();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('requires user confirmation');
      expect(text).toContain('POST /users');
      expect(text).toContain('Auto-invoke only allowed for GET skills, got POST');
      expect(text).toContain('confirmed=true');
    });

    it('POST Skill 传入 confirmed=true 后执行', async () => {
      const postSkill = makeSkill({
        name: 'auto-submit-skill',
        method: 'POST',
        pathname: '/users',
      });
      mockFindMatchingSkill.mockResolvedValue(postSkill);
      mockRequiresConfirmation.mockReturnValue(true);
      mockExecuteApiFirst.mockResolvedValue(makeApiResult({
        data: { id: 1 },
        latencyMs: 30,
        skillName: 'auto-submit-skill',
        confidence: 0.8,
      }));

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_submit',
        url: 'https://api.example.com/users',
        intent: 'create user',
        data: { name: 'bob' },
        confirmed: true,
      });

      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/users',
        'POST',
        'create user',
        { name: 'bob' },
        postSkill,
      );
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toMatchObject({ success: true, skill_id: 'auto-submit-skill' });
    });

    it('GET Skill 无需确认直接执行', async () => {
      const getSkill = makeSkill({
        name: 'auto-fill-skill',
        method: 'GET',
        pathname: '/form',
        initialConfidence: 0.9,
      });
      mockFindMatchingSkill.mockResolvedValue(getSkill);
      mockRequiresConfirmation.mockReturnValue(false);
      mockExecuteApiFirst.mockResolvedValue(makeApiResult({
        data: { form: 'data' },
        latencyMs: 15,
        skillName: 'auto-fill-skill',
        confidence: 0.9,
      }));

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_fill_form',
        url: 'https://api.example.com/form',
        intent: 'get form',
      });

      expect(mockExecuteApiFirst).toHaveBeenCalledWith(
        'https://api.example.com/form',
        'GET',
        'get form',
        undefined,
        getSkill,
      );
      expect(mockRequiresConfirmation).toHaveBeenCalledWith(getSkill);
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toMatchObject({ success: true, skill_id: 'auto-fill-skill' });
    });

    it('未启用的 Skill 直接拒绝', async () => {
      const disabledSkill = makeSkill({
        name: 'auto-submit-skill',
        method: 'POST',
        pathname: '/users',
        enabled: false,
      });
      mockFindMatchingSkill.mockResolvedValue(disabledSkill);

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_submit',
        url: 'https://api.example.com/users',
        intent: 'create user',
        data: { name: 'bob' },
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockInteractExecute).not.toHaveBeenCalled();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('disabled');
      expect(text).toContain('POST /users');
    });
  });

  // ─── NoMatchError 时回退：api_submit→click, api_fill_form→type ───

  describe('NoMatchError 时回退', () => {
    it('api_submit 抛 NoMatchError 时回退到 click', async () => {
      const postSkill = makeSkill({ method: 'POST', pathname: '/users' });
      mockFindMatchingSkill.mockResolvedValue(postSkill);
      const noMatch = new MockNoMatchError('No matching API skill for POST https://api.example.com/users');
      mockExecuteApiFirst.mockRejectedValue(noMatch);
      mockInteractExecute.mockResolvedValue(makeInteractResult('Clicked: #submit'));

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_submit',
        url: 'https://api.example.com/users',
        selector: '#submit',
        text: 'submit text',
      });

      // 应该调用 interactTool，action 为 'click'
      expect(mockInteractExecute).toHaveBeenCalledWith('call-1', {
        tabId: 42,
        action: 'click',
        selector: '#submit',
        text: 'submit text',
      });

      // 返回值前面加上 [fallback: ...]
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('[fallback: No matching API skill');
      expect(text).toContain('Clicked: #submit');
    });

    it('api_fill_form 抛 NoMatchError 时回退到 type', async () => {
      const getSkill = makeSkill({ method: 'GET', pathname: '/form' });
      mockFindMatchingSkill.mockResolvedValue(getSkill);
      mockExecuteApiFirst.mockRejectedValue(new MockNoMatchError('no match'));
      mockInteractExecute.mockResolvedValue(makeInteractResult('Typed "bob" into: #name'));

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_fill_form',
        url: 'https://api.example.com/form',
        selector: '#name',
        text: 'bob',
      });

      // 应该调用 interactTool，action 为 'type'
      expect(mockInteractExecute).toHaveBeenCalledWith('call-1', {
        tabId: 42,
        action: 'type',
        selector: '#name',
        text: 'bob',
      });

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('[fallback: no match');
      expect(text).toContain('Typed "bob" into: #name');
    });

    it('回退时使用 _toolCallId 而非新的 id', async () => {
      const postSkill = makeSkill({ method: 'POST', pathname: '/users' });
      mockFindMatchingSkill.mockResolvedValue(postSkill);
      mockExecuteApiFirst.mockRejectedValue(new MockNoMatchError('no match'));
      mockInteractExecute.mockResolvedValue(makeInteractResult());

      await smartInteractTool.execute('my-tool-call-id', {
        tabId: 42,
        action: 'api_submit',
        url: 'https://api.example.com/users',
      });

      expect(mockInteractExecute).toHaveBeenCalledWith('my-tool-call-id', expect.anything());
    });

    it('回退时 interactTool 返回非 text content 时直接返回 fallback', async () => {
      const postSkill = makeSkill({ method: 'POST', pathname: '/users' });
      mockFindMatchingSkill.mockResolvedValue(postSkill);
      mockExecuteApiFirst.mockRejectedValue(new MockNoMatchError('no match'));
      mockInteractExecute.mockResolvedValue({
        content: [{ type: 'image' as const, data: 'base64...' }],
        details: {},
      } as any);

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_submit',
        url: 'https://api.example.com/users',
      });

      // 直接返回 fallback 结果（不修改 content）
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('image');
    });
  });

  // ─── 非 NoMatchError 异常时 re-throw ───

  describe('非 NoMatchError 异常时 re-throw', () => {
    it('普通 Error 被重新抛出', async () => {
      const postSkill = makeSkill({ method: 'POST', pathname: '/users' });
      mockFindMatchingSkill.mockResolvedValue(postSkill);
      const err = new Error('Server error');
      mockExecuteApiFirst.mockRejectedValue(err);

      await expect(
        smartInteractTool.execute('call-1', {
          tabId: 42,
          action: 'api_submit',
          url: 'https://api.example.com/users',
        }),
      ).rejects.toThrow('Server error');

      // 不应该调用 interactTool
      expect(mockInteractExecute).not.toHaveBeenCalled();
    });

    it('字符串错误被重新抛出', async () => {
      const getSkill = makeSkill({ method: 'GET', pathname: '/form' });
      mockFindMatchingSkill.mockResolvedValue(getSkill);
      mockExecuteApiFirst.mockRejectedValue('string error');

      await expect(
        smartInteractTool.execute('call-1', {
          tabId: 42,
          action: 'api_fill_form',
          url: 'https://api.example.com/form',
        }),
      ).rejects.toBe('string error');

      expect(mockInteractExecute).not.toHaveBeenCalled();
    });
  });

  // ─── action='click' 时直接走 DOM ───

  describe("action='click' 时直接走 DOM", () => {
    it('不调用 executeApiFirst，直接调用 interactTool', async () => {
      mockInteractExecute.mockResolvedValue(makeInteractResult('Clicked: #btn'));

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'click',
        selector: '#btn',
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockInteractExecute).toHaveBeenCalledWith('call-1', {
        tabId: 42,
        action: 'click',
        selector: '#btn',
        text: undefined,
      });
      expect(result.content[0]).toMatchObject({ type: 'text', text: 'Clicked: #btn' });
    });

    it('即使有 url 也不走 API（action 非 api_*）', async () => {
      mockInteractExecute.mockResolvedValue(makeInteractResult());

      await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'click',
        url: 'https://api.example.com/users',
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockInteractExecute).toHaveBeenCalledWith('call-1', expect.objectContaining({
        action: 'click',
      }));
    });

    it('action=type 时直接走 DOM', async () => {
      mockInteractExecute.mockResolvedValue(makeInteractResult('Typed "hi" into: #input'));

      await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'type',
        selector: '#input',
        text: 'hi',
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockInteractExecute).toHaveBeenCalledWith('call-1', {
        tabId: 42,
        action: 'type',
        selector: '#input',
        text: 'hi',
      });
    });
  });

  // ─── 无 url 时直接走 DOM ───

  describe('无 url 时直接走 DOM', () => {
    it('action=api_submit 但无 url 时走 DOM', async () => {
      mockInteractExecute.mockResolvedValue(makeInteractResult('Clicked: #btn'));

      const result = await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_submit',
        selector: '#btn',
        // 无 url
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      // 走 DOM 时 action 直接透传
      expect(mockInteractExecute).toHaveBeenCalledWith('call-1', {
        tabId: 42,
        action: 'api_submit',
        selector: '#btn',
        text: undefined,
      });
      expect(result.content[0]).toMatchObject({ type: 'text', text: 'Clicked: #btn' });
    });

    it('action=api_fill_form 但无 url 时走 DOM', async () => {
      mockInteractExecute.mockResolvedValue(makeInteractResult());

      await smartInteractTool.execute('call-1', {
        tabId: 42,
        action: 'api_fill_form',
        selector: '#input',
        text: 'data',
      });

      expect(mockExecuteApiFirst).not.toHaveBeenCalled();
      expect(mockInteractExecute).toHaveBeenCalledWith('call-1', {
        tabId: 42,
        action: 'api_fill_form',
        selector: '#input',
        text: 'data',
      });
    });
  });
});
