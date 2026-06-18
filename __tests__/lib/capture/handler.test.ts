/**
 * lib/capture/handler.ts 测试
 *
 * 覆盖范围：
 * - handleApiDiscoveryMessage 处理各种消息类型：
 *   - start_capture: 成功和失败
 *   - stop_capture: 返回请求数
 *   - analyze_capture: 成功返回端点数和 Skill 数
 *   - list_auto_skills: 返回 Skill 列表
 *   - enable_skill / disable_skill / delete_skill
 *   - enable / disable（空实现）
 *   - 未知消息类型返回错误
 * - registerApiDiscoveryHandlers 注册 chrome.runtime.onMessage 监听器
 *
 * mock 策略：
 * - vi.mock './capture-session' 的 captureSession
 * - vi.mock './analyzer' 的 analyzeRequests
 * - vi.mock './skill-generator' 的 generateSkillsFromEndpoints
 * - vi.mock './skill-registry' 的 initRegistry, addSkills, getAllSkills, enableSkill, disableSkill, deleteSkill
 * - global.chrome 提供 tabs/runtime API
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── mock 内部模块 ───

vi.mock('@/lib/capture/capture-session', () => ({
  captureSession: {
    start: vi.fn(),
    stop: vi.fn(),
    getState: vi.fn(),
    getCapturedRequests: vi.fn(),
    onStateChange: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock('@/lib/capture/analyzer', () => ({
  analyzeRequests: vi.fn(),
}));

vi.mock('@/lib/capture/skill-generator', () => ({
  generateSkillsFromEndpoints: vi.fn(),
}));

vi.mock('@/lib/capture/skill-registry', () => ({
  initRegistry: vi.fn().mockResolvedValue(undefined),
  addSkills: vi.fn().mockResolvedValue(undefined),
  getAllSkills: vi.fn().mockResolvedValue([]),
  getSkillsByHostname: vi.fn().mockResolvedValue([]),
  enableSkill: vi.fn().mockResolvedValue(undefined),
  disableSkill: vi.fn().mockResolvedValue(undefined),
  deleteSkill: vi.fn().mockResolvedValue(undefined),
}));

// ─── 导入（在 mock 之后） ───

import {
  handleApiDiscoveryMessage,
  registerApiDiscoveryHandlers,
  onStatus,
} from '@/lib/capture/handler';
import { captureSession } from '@/lib/capture/capture-session';
import { analyzeRequests } from '@/lib/capture/analyzer';
import { generateSkillsFromEndpoints } from '@/lib/capture/skill-generator';
import {
  initRegistry,
  addSkills,
  getAllSkills,
  enableSkill,
  disableSkill,
  deleteSkill,
} from '@/lib/capture/skill-registry';
import { API_DISCOVERY_MSG } from '@/lib/capture/types';
import type { AutoSkillDefinition, EndpointMeta, CaptureSessionState } from '@/lib/capture/types';

// ─── mock 引用 ───

const mockCaptureStart = vi.mocked(captureSession.start);
const mockCaptureStop = vi.mocked(captureSession.stop);
const mockCaptureGetState = vi.mocked(captureSession.getState);
const mockCaptureGetCapturedRequests = vi.mocked(captureSession.getCapturedRequests);
const mockCaptureOnStateChange = vi.mocked(captureSession.onStateChange);

const mockAnalyzeRequests = vi.mocked(analyzeRequests);
const mockGenerateSkills = vi.mocked(generateSkillsFromEndpoints);

const mockInitRegistry = vi.mocked(initRegistry);
const mockAddSkills = vi.mocked(addSkills);
const mockGetAllSkills = vi.mocked(getAllSkills);
const mockEnableSkill = vi.mocked(enableSkill);
const mockDisableSkill = vi.mocked(disableSkill);
const mockDeleteSkill = vi.mocked(deleteSkill);

// ─── 测试辅助 ───

/** 构造一个 CaptureSessionState */
function makeCaptureState(overrides: Partial<CaptureSessionState> = {}) {
  return {
    tabId: 42,
    status: 'capturing' as const,
    startedAt: Date.now(),
    endedAt: null,
    requestCount: 5,
    apiCandidateCount: 2,
    error: null,
    hostname: 'api.example.com',
    ...overrides,
  };
}

/** 构造一个 AutoSkillDefinition */
function makeSkill(overrides: Partial<AutoSkillDefinition> = {}): AutoSkillDefinition {
  return {
    name: 'auto-api-example-com-get-api-users',
    description: 'Auto-discovered API: GET /api/users',
    endpointId: 'GET|/api/users',
    hostname: 'api.example.com',
    method: 'GET',
    authType: 'none',
    pathname: '/api/users',
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

/** 构造一个 EndpointMeta */
function makeEndpoint(overrides: Partial<EndpointMeta> = {}): EndpointMeta {
  return {
    id: 'GET|/api/users',
    method: 'GET',
    pathname: '/api/users',
    hostname: 'api.example.com',
    pathParams: [],
    queryParams: [],
    bodyFields: [],
    authType: 'none',
    responseSchemas: [],
    sampleCount: 1,
    statusCodes: [200],
    confidence: 0.7,
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    ...overrides,
  };
}

/** 设置 chrome API mock */
function setupChromeApi(opts: {
  tabs?: Record<number, { id: number; url?: string }>;
  permissionsGranted?: boolean;
} = {}) {
  const permissionsGranted = opts.permissionsGranted ?? true;
  const tabsById = opts.tabs ?? {};
  (global as any).chrome = {
    tabs: {
      get: vi.fn(async (tabId: number) => {
        const tab = tabsById[tabId];
        if (!tab) throw new Error(`Tab ${tabId} not found`);
        return tab;
      }),
    },
    runtime: {
      onMessage: {
        addListener: vi.fn(),
      },
    },
    permissions: {
      contains: vi.fn(async () => permissionsGranted),
      request: vi.fn(async () => true),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // 默认 mock 实现
  mockInitRegistry.mockResolvedValue(undefined);
  mockCaptureStart.mockResolvedValue(undefined);
  mockCaptureStop.mockResolvedValue([]);
  mockCaptureGetState.mockReturnValue(makeCaptureState());
  mockCaptureGetCapturedRequests.mockReturnValue([]);
  mockCaptureOnStateChange.mockReturnValue(() => {});

  mockAnalyzeRequests.mockReturnValue([]);
  mockGenerateSkills.mockReturnValue([]);

  mockAddSkills.mockResolvedValue(undefined);
  mockGetAllSkills.mockResolvedValue([]);
  mockEnableSkill.mockResolvedValue(undefined);
  mockDisableSkill.mockResolvedValue(undefined);
  mockDeleteSkill.mockResolvedValue(undefined);

  // 默认 chrome API
  setupChromeApi({
    tabs: {
      42: { id: 42, url: 'https://api.example.com/users' },
    },
  });
});

afterEach(() => {
  delete (global as any).chrome;
});

// ─── 测试套件 ───

describe('handler', () => {
  // ─── start_capture ───

  describe('start_capture', () => {
    it('成功时启动捕获会话并返回 state', async () => {
      const state = makeCaptureState({ status: 'capturing', requestCount: 0 });
      mockCaptureGetState.mockReturnValue(state);

      const result = await handleApiDiscoveryMessage({
        type: 'start_capture',
        tabId: 42,
      });

      // 应该调用 chrome.tabs.get
      expect(chrome.tabs.get).toHaveBeenCalledWith(42);
      // 应该调用 captureSession.start
      expect(mockCaptureStart).toHaveBeenCalledWith(42, 'api.example.com');
      // 返回值
      expect(result).toEqual({ ok: true, state });
    });

    it('从 tab.url 解析 hostname', async () => {
      setupChromeApi({
        tabs: {
          99: { id: 99, url: 'https://www.example.org/path?q=1' },
        },
      });

      await handleApiDiscoveryMessage({
        type: 'start_capture',
        tabId: 99,
      });

      expect(mockCaptureStart).toHaveBeenCalledWith(99, 'www.example.org');
    });

    it('tab.url 无效时返回错误', async () => {
      setupChromeApi({
        tabs: {
          42: { id: 42, url: 'not-a-valid-url' },
        },
      });

      const result = await handleApiDiscoveryMessage({
        type: 'start_capture',
        tabId: 42,
      });

      expect(result).toEqual({
        ok: false,
        error: '无法获取标签页 hostname',
      });
      // 不应该调用 captureSession.start
      expect(mockCaptureStart).not.toHaveBeenCalled();
    });

    it('captureSession.start 抛出错误时返回错误', async () => {
      mockCaptureStart.mockRejectedValue(new Error('Capture session already active'));

      const result = await handleApiDiscoveryMessage({
        type: 'start_capture',
        tabId: 42,
      });

      expect(result).toEqual({
        ok: false,
        error: 'Capture session already active',
      });
    });

    it('chrome.tabs.get 抛出错误时返回错误', async () => {
      setupChromeApi({ tabs: {} }); // 没有 tab 42

      const result = await handleApiDiscoveryMessage({
        type: 'start_capture',
        tabId: 42,
      });

      expect(result).toEqual({
        ok: false,
        error: 'Tab 42 not found',
      });
      expect(mockCaptureStart).not.toHaveBeenCalled();
    });
  });

  // ─── stop_capture ───

  describe('stop_capture', () => {
    it('停止捕获并返回请求数', async () => {
      // 模拟 stop 返回 3 个请求
      mockCaptureStop.mockResolvedValue([
        { requestId: '1', url: 'https://api.example.com/a', method: 'GET' },
        { requestId: '2', url: 'https://api.example.com/b', method: 'POST' },
        { requestId: '3', url: 'https://api.example.com/c', method: 'GET' },
      ] as any);

      const result = await handleApiDiscoveryMessage({
        type: 'stop_capture',
      });

      expect(mockCaptureStop).toHaveBeenCalled();
      expect(result).toEqual({ ok: true, requestCount: 3 });
    });

    it('无请求时返回 requestCount=0', async () => {
      mockCaptureStop.mockResolvedValue([]);

      const result = await handleApiDiscoveryMessage({
        type: 'stop_capture',
      });

      expect(result).toEqual({ ok: true, requestCount: 0 });
    });
  });

  // ─── analyze_capture ───

  describe('analyze_capture', () => {
    it('成功时返回端点数和 Skill 数', async () => {
      const requests = [
        { requestId: '1', url: 'https://api.example.com/users', method: 'GET' },
      ];
      const endpoints = [
        makeEndpoint({ id: 'GET|/api/users' }),
        makeEndpoint({ id: 'POST|/api/users', method: 'POST' }),
      ];
      const skills = [
        makeSkill({ name: 'skill-1' }),
        makeSkill({ name: 'skill-2' }),
      ];

      mockCaptureGetCapturedRequests.mockReturnValue(requests as any);
      mockAnalyzeRequests.mockReturnValue(endpoints);
      mockGenerateSkills.mockReturnValue(skills);

      const result = await handleApiDiscoveryMessage({
        type: 'analyze_capture',
      });

      // 应该调用 analyzeRequests
      expect(mockAnalyzeRequests).toHaveBeenCalledWith(requests);
      // 应该调用 generateSkillsFromEndpoints
      expect(mockGenerateSkills).toHaveBeenCalledWith(endpoints);
      // 应该调用 addSkills（因为 skills.length > 0）
      expect(mockAddSkills).toHaveBeenCalledWith(skills);
      // 返回值
      expect(result).toEqual({
        ok: true,
        endpointsFound: 2,
        skillsGenerated: 2,
      });
    });

    it('无 Skill 时不调用 addSkills', async () => {
      mockCaptureGetCapturedRequests.mockReturnValue([]);
      mockAnalyzeRequests.mockReturnValue([]);
      mockGenerateSkills.mockReturnValue([]);

      const result = await handleApiDiscoveryMessage({
        type: 'analyze_capture',
      });

      expect(mockAddSkills).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: true,
        endpointsFound: 0,
        skillsGenerated: 0,
      });
    });

    it('analyzeRequests 抛出错误时返回错误', async () => {
      mockCaptureGetCapturedRequests.mockReturnValue([]);
      mockAnalyzeRequests.mockImplementation(() => {
        throw new Error('analyze failed');
      });

      const result = await handleApiDiscoveryMessage({
        type: 'analyze_capture',
      });

      expect(result).toEqual({
        ok: false,
        error: 'analyze failed',
      });
      // 不应该调用 addSkills
      expect(mockAddSkills).not.toHaveBeenCalled();
    });

    it('有端点但无 Skill 生成时返回 skillsGenerated=0', async () => {
      mockCaptureGetCapturedRequests.mockReturnValue([{ requestId: '1' }] as any);
      mockAnalyzeRequests.mockReturnValue([makeEndpoint()]);
      mockGenerateSkills.mockReturnValue([]);

      const result = await handleApiDiscoveryMessage({
        type: 'analyze_capture',
      });

      expect(result).toEqual({
        ok: true,
        endpointsFound: 1,
        skillsGenerated: 0,
      });
      // skills.length === 0，不调用 addSkills
      expect(mockAddSkills).not.toHaveBeenCalled();
    });
  });

  // ─── list_auto_skills ───

  describe('list_auto_skills', () => {
    it('返回所有 Skill 列表', async () => {
      const skills = [
        makeSkill({ name: 'skill-1' }),
        makeSkill({ name: 'skill-2' }),
        makeSkill({ name: 'skill-3' }),
      ];
      mockGetAllSkills.mockResolvedValue(skills);

      const result = await handleApiDiscoveryMessage({
        type: 'list_auto_skills',
      });

      expect(mockGetAllSkills).toHaveBeenCalled();
      expect(result).toEqual({ ok: true, skills });
    });

    it('无 Skill 时返回空数组', async () => {
      mockGetAllSkills.mockResolvedValue([]);

      const result = await handleApiDiscoveryMessage({
        type: 'list_auto_skills',
      });

      expect(result).toEqual({ ok: true, skills: [] });
    });
  });

  // ─── enable_skill / disable_skill / delete_skill ───

  describe('enable_skill', () => {
    it('调用 enableSkill 并返回 ok', async () => {
      const result = await handleApiDiscoveryMessage({
        type: 'enable_skill',
        skillName: 'auto-skill-1',
      });

      expect(mockEnableSkill).toHaveBeenCalledWith('auto-skill-1');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('disable_skill', () => {
    it('调用 disableSkill 并返回 ok', async () => {
      const result = await handleApiDiscoveryMessage({
        type: 'disable_skill',
        skillName: 'auto-skill-2',
      });

      expect(mockDisableSkill).toHaveBeenCalledWith('auto-skill-2');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('delete_skill', () => {
    it('调用 deleteSkill 并返回 ok', async () => {
      const result = await handleApiDiscoveryMessage({
        type: 'delete_skill',
        skillName: 'auto-skill-3',
      });

      expect(mockDeleteSkill).toHaveBeenCalledWith('auto-skill-3');
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── enable / disable（空实现） ───

  describe('enable / disable（空实现）', () => {
    it('enable 返回 ok', async () => {
      const result = await handleApiDiscoveryMessage({ type: 'enable' });
      expect(result).toEqual({ ok: true });
    });

    it('disable 返回 ok', async () => {
      const result = await handleApiDiscoveryMessage({ type: 'disable' });
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── 未知消息类型 ───

  describe('未知消息类型', () => {
    it('返回错误', async () => {
      const result = await handleApiDiscoveryMessage({
        type: 'unknown_type' as any,
      });

      expect(result).toEqual({ ok: false, error: 'Unknown message type' });
    });
  });

  // ─── initApiDiscovery 集成 ───

  describe('initApiDiscovery 集成', () => {
    it('首次调用时初始化 registry 并注册状态监听器', async () => {
      // 重置模块缓存以重置 initialized 标志
      vi.resetModules();
      vi.clearAllMocks();

      // 重新设置默认 mock 实现（resetModules 后需要重新设置）
      mockInitRegistry.mockResolvedValue(undefined);
      mockCaptureOnStateChange.mockReturnValue(() => {});

      // 动态重新 import handler 以获取 initialized=false 的模块
      const { handleApiDiscoveryMessage: freshHandler } = await import('@/lib/capture/handler');

      await freshHandler({ type: 'enable' });

      // 应该调用 initRegistry
      expect(mockInitRegistry).toHaveBeenCalled();
      // 应该调用 captureSession.onStateChange 注册监听器
      expect(mockCaptureOnStateChange).toHaveBeenCalled();
    });

    it('initApiDiscovery 在所有消息处理前被调用', async () => {
      // 重置模块缓存以重置 initialized 标志
      vi.resetModules();
      vi.clearAllMocks();
      mockInitRegistry.mockResolvedValue(undefined);
      mockCaptureOnStateChange.mockReturnValue(() => {});

      const { handleApiDiscoveryMessage: freshHandler } = await import('@/lib/capture/handler');

      await freshHandler({ type: 'list_auto_skills' });

      expect(mockInitRegistry).toHaveBeenCalled();
    });
  });

  // ─── 状态广播 ───

  describe('状态广播', () => {
    it('start_capture 失败时通过 onStatus 广播 error', async () => {
      const listener = vi.fn();
      onStatus(listener);

      mockCaptureStart.mockRejectedValue(new Error('start failed'));

      await handleApiDiscoveryMessage({
        type: 'start_capture',
        tabId: 42,
      });

      // 应该广播 error 消息
      expect(listener).toHaveBeenCalledWith({
        type: 'error',
        message: 'start failed',
      });
    });

    it('analyze_capture 失败时通过 onStatus 广播 error', async () => {
      const listener = vi.fn();
      onStatus(listener);

      mockAnalyzeRequests.mockImplementation(() => {
        throw new Error('analyze error');
      });

      await handleApiDiscoveryMessage({ type: 'analyze_capture' });

      expect(listener).toHaveBeenCalledWith({
        type: 'error',
        message: 'analyze error',
      });
    });

    it('onStatus 返回的取消函数可以移除监听器', async () => {
      const listener = vi.fn();
      const unsubscribe = onStatus(listener);

      mockCaptureStart.mockRejectedValue(new Error('err1'));
      await handleApiDiscoveryMessage({ type: 'start_capture', tabId: 42 });
      expect(listener).toHaveBeenCalledTimes(1);

      // 取消订阅
      unsubscribe();

      mockCaptureStart.mockRejectedValue(new Error('err2'));
      await handleApiDiscoveryMessage({ type: 'start_capture', tabId: 42 });
      // 不应该再被调用
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ─── registerApiDiscoveryHandlers ───

  describe('registerApiDiscoveryHandlers', () => {
    it('注册 chrome.runtime.onMessage 监听器', () => {
      registerApiDiscoveryHandlers();

      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
      const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(typeof listener).toBe('function');
    });

    it('非 API_DISCOVERY_MSG 消息返回 false（不处理）', async () => {
      registerApiDiscoveryHandlers();

      const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const sendResponse = vi.fn();

      const result = listener(
        { type: 'some_other_message' },
        {},
        sendResponse,
      );

      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('API_DISCOVERY_MSG 消息异步处理并调用 sendResponse', async () => {
      registerApiDiscoveryHandlers();

      const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const sendResponse = vi.fn();

      const result = listener(
        { type: API_DISCOVERY_MSG, payload: { type: 'enable' } },
        {},
        sendResponse,
      );

      // 异步响应，返回 true
      expect(result).toBe(true);

      // 等待微任务执行
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it('API_DISCOVERY_MSG 消息处理失败时通过 sendResponse 返回错误', async () => {
      registerApiDiscoveryHandlers();

      const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const sendResponse = vi.fn();

      // 让 getAllSkills 抛出异常（因为 initialized 可能已经是 true，
      // initRegistry 不会被调用，所以通过 list_auto_skills 路径触发异常）
      mockGetAllSkills.mockRejectedValue(new Error('db error'));

      listener(
        { type: API_DISCOVERY_MSG, payload: { type: 'list_auto_skills' } },
        {},
        sendResponse,
      );

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: 'db error',
      });
    });

    it('正确转发 start_capture 消息', async () => {
      registerApiDiscoveryHandlers();

      const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const sendResponse = vi.fn();
      const state = makeCaptureState();
      mockCaptureGetState.mockReturnValue(state);

      listener(
        { type: API_DISCOVERY_MSG, payload: { type: 'start_capture', tabId: 42 } },
        {},
        sendResponse,
      );

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockCaptureStart).toHaveBeenCalledWith(42, 'api.example.com');
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, state });
    });
  });
});
