/**
 * lib/capture/api-policy.ts 测试
 *
 * 覆盖 canAutoInvokeSkill 的核心策略：
 * - 高置信度 GET 允许自动调用
 * - 非 GET 方法阻止
 * - 低置信度阻止
 * - pathname/description 含写操作关键词阻止
 * - Skill 未启用阻止
 * - 动态置信度优先
 * - 关键词词边界匹配
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { canAutoInvokeSkill, requiresConfirmation } from '@/lib/capture/api-policy';
import type { AutoSkillDefinition } from '@/lib/capture/types';

// ─── 测试辅助 ───

function makeSkill(overrides: Partial<AutoSkillDefinition> = {}): AutoSkillDefinition {
  return {
    name: 'auto-api-example-com-get-api-users-id',
    description: 'Auto-discovered API: GET /api/users/{id} (api.example.com)',
    endpointId: 'GET|/api/users/{id}',
    hostname: 'api.example.com',
    method: 'GET',
    authType: 'cookie',
    pathname: '/api/users/{id}',
    bgFetchPatterns: ['https://api.example.com/api/users/*'],
    script: 'async function run(args = {}) { /* ... */ }',
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

// ─── 策略测试 ───

describe('canAutoInvokeSkill', () => {
  it('高置信度 GET Skill 允许自动调用', () => {
    const skill = makeSkill({ method: 'GET', initialConfidence: 0.85 });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Read-only GET skill');
  });

  it('POST Skill 阻止自动调用', () => {
    const skill = makeSkill({ method: 'POST', initialConfidence: 0.85 });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/GET/);
  });

  it('低置信度 Skill 阻止自动调用', () => {
    const skill = makeSkill({ method: 'GET', initialConfidence: 0.75 });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('below threshold');
  });

  it('pathname 含写操作关键词时阻止', () => {
    const skill = makeSkill({
      method: 'GET',
      initialConfidence: 0.85,
      pathname: '/api/orders/create',
    });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('create');
  });

  it('description 含写操作关键词时阻止', () => {
    const skill = makeSkill({
      method: 'GET',
      initialConfidence: 0.85,
      description: 'Auto-discovered API: GET /api/items/{id} used to submit feedback',
    });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('submit');
  });

  it('边界置信度 0.8 允许自动调用', () => {
    const skill = makeSkill({ method: 'GET', initialConfidence: 0.8 });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(true);
  });

  it('enabled: false 被阻止', () => {
    const skill = makeSkill({ enabled: false });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('skill is disabled');
  });

  it('动态置信度（callCount >= 3）优先于 initialConfidence', () => {
    const skill = makeSkill({
      method: 'GET',
      initialConfidence: 0.75,
      stats: {
        callCount: 3,
        successCount: 3,
        failureCount: 0,
        lastCalledAt: Date.now(),
        dynamicConfidence: 0.9,
      },
    });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Read-only GET skill');
  });

  it('关键词词边界：pathname 含 "posts" 子串时不应误阻止', () => {
    const skill = makeSkill({
      method: 'GET',
      initialConfidence: 0.85,
      pathname: '/api/posts',
    });
    const result = canAutoInvokeSkill(skill);
    expect(result.allowed).toBe(true);
  });

  it('effectiveMethod 优先于 skill.method：声明 GET 但实际 POST 时阻止', () => {
    const skill = makeSkill({
      method: 'GET',
      initialConfidence: 0.85,
    });
    const result = canAutoInvokeSkill(skill, 'POST');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('POST');
  });

  it('effectiveMethod 优先于 skill.method：声明 POST 但实际 GET 时允许', () => {
    const skill = makeSkill({
      method: 'POST',
      initialConfidence: 0.85,
    });
    const result = canAutoInvokeSkill(skill, 'GET');
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Read-only GET skill');
  });

  it('未传入 effectiveMethod 时回退到 skill.method', () => {
    const getSkill = makeSkill({ method: 'GET', initialConfidence: 0.85 });
    expect(canAutoInvokeSkill(getSkill).allowed).toBe(true);

    const postSkill = makeSkill({ method: 'POST', initialConfidence: 0.85 });
    expect(canAutoInvokeSkill(postSkill).allowed).toBe(false);
  });
});

// ─── requiresConfirmation 测试 ───

describe('requiresConfirmation', () => {
  it('未启用 Skill 返回 false', () => {
    const skill = makeSkill({ enabled: false, method: 'POST' });
    expect(requiresConfirmation(skill)).toBe(false);
  });

  it('低风险 GET Skill 返回 false', () => {
    const skill = makeSkill({ method: 'GET', initialConfidence: 0.85 });
    expect(requiresConfirmation(skill)).toBe(false);
  });

  it('POST Skill 返回 true', () => {
    const skill = makeSkill({ method: 'POST', initialConfidence: 0.85 });
    expect(requiresConfirmation(skill)).toBe(true);
  });

  it('低置信度 GET Skill 返回 true', () => {
    const skill = makeSkill({ method: 'GET', initialConfidence: 0.75 });
    expect(requiresConfirmation(skill)).toBe(true);
  });

  it('含写关键词 GET Skill 返回 true', () => {
    const skill = makeSkill({
      method: 'GET',
      initialConfidence: 0.85,
      pathname: '/api/orders/create',
    });
    expect(requiresConfirmation(skill)).toBe(true);
  });
});
