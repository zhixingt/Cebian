/**
 * lib/capture/skill-generator.ts 测试
 *
 * 覆盖范围：
 * - generateSkillFromEndpoint：正常生成 / 样本不足返回 null
 * - generateSkillsFromEndpoints：批量生成、跳过不合格端点
 * - 生成脚本的 method/pathname/hostname 正确嵌入
 * - authType 和 authHeaderName 正确透传到 AutoSkillDefinition
 * - bgFetchPatterns 由 pathname 占位符转通配符生成
 * - 初始 stats / enabled / createdAt 等字段
 */
import { describe, it, expect } from 'vitest';
import {
  generateSkillFromEndpoint,
  generateSkillsFromEndpoints,
} from '@/lib/capture/skill-generator';
import type { EndpointMeta } from '@/lib/capture/types';

// ─── 测试辅助 ───

function makeEndpoint(overrides: Partial<EndpointMeta> = {}): EndpointMeta {
  return {
    id: 'GET|/api/users/{id}',
    method: 'GET',
    pathname: '/api/users/{id}',
    hostname: 'api.example.com',
    pathParams: [{ name: 'id', placeholder: '{id}' }],
    queryParams: [],
    bodyFields: [],
    authType: 'cookie',
    responseSchemas: [],
    sampleCount: 3,
    statusCodes: [200],
    confidence: 0.7,
    firstSeenAt: 1000,
    lastSeenAt: 2000,
    ...overrides,
  };
}

// ─── generateSkillFromEndpoint ───

describe('generateSkillFromEndpoint', () => {
  it('正常端点生成 Skill 定义', () => {
    const endpoint = makeEndpoint();
    const skill = generateSkillFromEndpoint(endpoint);

    expect(skill).not.toBeNull();
    // endpointId 'GET|/api/users/{id}' 中 |//{} 均被替换为 -
    expect(skill!.name).toBe('auto-api-example-com-get--api-users--id-');
    expect(skill!.endpointId).toBe(endpoint.id);
    expect(skill!.hostname).toBe('api.example.com');
    expect(skill!.method).toBe('GET');
    expect(skill!.pathname).toBe('/api/users/{id}');
    expect(skill!.authType).toBe('cookie');
    expect(skill!.initialConfidence).toBe(0.7);
    expect(skill!.enabled).toBe(false);
    expect(skill!.createdAt).toBeGreaterThan(0);
  });

  it('样本不足（sampleCount < 2）返回 null', () => {
    const endpoint = makeEndpoint({ sampleCount: 1 });
    expect(generateSkillFromEndpoint(endpoint)).toBeNull();
  });

  it('无 2xx 状态码返回 null', () => {
    const endpoint = makeEndpoint({ statusCodes: [404, 500] });
    expect(generateSkillFromEndpoint(endpoint)).toBeNull();
  });

  it('statusCodes 为空返回 null', () => {
    const endpoint = makeEndpoint({ statusCodes: [] });
    expect(generateSkillFromEndpoint(endpoint)).toBeNull();
  });

  it('description 包含 method/pathname/hostname', () => {
    const skill = generateSkillFromEndpoint(makeEndpoint())!;
    expect(skill.description).toContain('GET');
    expect(skill.description).toContain('/api/users/{id}');
    expect(skill.description).toContain('api.example.com');
  });

  it('authType=cookie 透传，authHeaderName 为 undefined', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({ authType: 'cookie', authHeaderName: undefined }),
    )!;
    expect(skill.authType).toBe('cookie');
    expect(skill.authHeaderName).toBeUndefined();
  });

  it('authType=bearer 透传，authHeaderName 为 undefined', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({ authType: 'bearer', authHeaderName: undefined }),
    )!;
    expect(skill.authType).toBe('bearer');
    expect(skill.authHeaderName).toBeUndefined();
  });

  it('authType=api-key 透传 authHeaderName', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({ authType: 'api-key', authHeaderName: 'x-api-key' }),
    )!;
    expect(skill.authType).toBe('api-key');
    expect(skill.authHeaderName).toBe('x-api-key');
  });

  it('authType=none 透传，authHeaderName 为 undefined', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({ authType: 'none', authHeaderName: undefined }),
    )!;
    expect(skill.authType).toBe('none');
    expect(skill.authHeaderName).toBeUndefined();
  });
});

// ─── bgFetchPatterns 生成 ───

describe('bgFetchPatterns 生成', () => {
  it('{id} 占位符转为通配符 *', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({ pathname: '/api/users/{id}' }),
    )!;
    expect(skill.bgFetchPatterns).toEqual([
      'https://api.example.com/api/users/*',
    ]);
  });

  it('{uuid} 占位符转为通配符 *', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        id: 'GET|/api/items/{uuid}',
        pathname: '/api/items/{uuid}',
        pathParams: [{ name: 'uuid', placeholder: '{uuid}' }],
      }),
    )!;
    expect(skill.bgFetchPatterns).toEqual([
      'https://api.example.com/api/items/*',
    ]);
  });

  it('{hash} 占位符转为通配符 *', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        id: 'GET|/api/blob/{hash}',
        pathname: '/api/blob/{hash}',
        pathParams: [{ name: 'hash', placeholder: '{hash}' }],
      }),
    )!;
    expect(skill.bgFetchPatterns).toEqual([
      'https://api.example.com/api/blob/*',
    ]);
  });

  it('无占位符路径原样作为 pattern', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        id: 'GET|/api/health',
        pathname: '/api/health',
        pathParams: [],
      }),
    )!;
    expect(skill.bgFetchPatterns).toEqual([
      'https://api.example.com/api/health',
    ]);
  });

  it('多个占位符全部转为 *', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        id: 'GET|/api/users/{id}/posts/{id}',
        pathname: '/api/users/{id}/posts/{id}',
        pathParams: [
          { name: 'id', placeholder: '{id}' },
          { name: 'id', placeholder: '{id}' },
        ],
      }),
    )!;
    expect(skill.bgFetchPatterns).toEqual([
      'https://api.example.com/api/users/*/posts/*',
    ]);
  });
});

// ─── 脚本内容验证 ───

describe('生成的脚本内容', () => {
  it('脚本包含 method、pathname、hostname', () => {
    const skill = generateSkillFromEndpoint(makeEndpoint())!;
    expect(skill.script).toContain('GET');
    expect(skill.script).toContain('/api/users/{id}');
    expect(skill.script).toContain('api.example.com');
  });

  it('脚本包含 base URL 构造行', () => {
    const skill = generateSkillFromEndpoint(makeEndpoint())!;
    expect(skill.script).toContain("const base = 'https://api.example.com/api/users/{id}'");
  });

  it('脚本包含 bgFetch 调用', () => {
    const skill = generateSkillFromEndpoint(makeEndpoint())!;
    expect(skill.script).toContain('bgFetch(finalUrl, init)');
  });

  it('脚本包含 async function run 入口', () => {
    const skill = generateSkillFromEndpoint(makeEndpoint())!;
    expect(skill.script).toContain('async function run(args = {})');
  });

  it('脚本包含 path 参数替换逻辑（有 pathParams 时）', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({ pathParams: [{ name: 'id', placeholder: '{id}' }] }),
    )!;
    expect(skill.script).toContain('const id = args.id');
    // 源码使用 '{${p.placeholder}}' 模板，p.placeholder='{id}' → 生成 '{{id}}'
    expect(skill.script).toContain("base.replace('{{id}}', encodeURIComponent(id))");
  });

  it('脚本无 path 参数替换逻辑（无 pathParams 时）', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        id: 'GET|/api/health',
        pathname: '/api/health',
        pathParams: [],
      }),
    )!;
    expect(skill.script).toContain('const url = base;');
    expect(skill.script).not.toContain('base.replace');
  });

  it('GET 请求脚本不含 body 字段', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        method: 'GET',
        bodyFields: [{ name: 'x', type: 'string', required: true, samples: ['a'] }],
      }),
    )!;
    expect(skill.script).not.toContain('JSON.stringify');
  });

  it('POST 请求脚本含 body 字段构造', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        method: 'POST',
        id: 'POST|/api/items',
        pathname: '/api/items',
        pathParams: [],
        bodyFields: [
          { name: 'title', type: 'string', required: true, samples: ['a'] },
          { name: 'count', type: 'number', required: false, samples: ['1'] },
        ],
      }),
    )!;
    expect(skill.script).toContain('body: JSON.stringify({');
    expect(skill.script).toContain('title: args.title');
    expect(skill.script).toContain('count: args.count');
  });

  it('PUT 请求脚本含 body 字段构造', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        method: 'PUT',
        id: 'PUT|/api/items/{id}',
        bodyFields: [
          { name: 'title', type: 'string', required: true, samples: ['a'] },
        ],
      }),
    )!;
    expect(skill.script).toContain('body: JSON.stringify({');
  });

  it('PATCH 请求脚本含 body 字段构造', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        method: 'PATCH',
        id: 'PATCH|/api/items/{id}',
        bodyFields: [
          { name: 'title', type: 'string', required: true, samples: ['a'] },
        ],
      }),
    )!;
    expect(skill.script).toContain('body: JSON.stringify({');
  });

  it('DELETE 请求脚本不含 body 字段（即使有 bodyFields）', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        method: 'DELETE',
        id: 'DELETE|/api/items/{id}',
        bodyFields: [
          { name: 'title', type: 'string', required: true, samples: ['a'] },
        ],
      }),
    )!;
    expect(skill.script).not.toContain('body: JSON.stringify');
  });

  it('脚本包含 query 参数构造逻辑（有 queryParams 时）', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({
        queryParams: [
          { name: 'page', type: 'number', required: true, samples: ['1'] },
        ],
      }),
    )!;
    expect(skill.script).toContain('URLSearchParams');
    expect(skill.script).toContain("params.set('page', String(args.page))");
  });

  it('脚本无 query 参数构造逻辑（无 queryParams 时）', () => {
    const skill = generateSkillFromEndpoint(
      makeEndpoint({ queryParams: [] }),
    )!;
    expect(skill.script).not.toContain('URLSearchParams');
    expect(skill.script).toContain('const finalUrl = url;');
  });
});

// ─── 初始 stats ───

describe('初始 stats 字段', () => {
  it('新生成 Skill 的 stats 全部归零', () => {
    const skill = generateSkillFromEndpoint(makeEndpoint())!;
    expect(skill.stats).toEqual({
      callCount: 0,
      successCount: 0,
      failureCount: 0,
      lastCalledAt: null,
      dynamicConfidence: 0,
    });
  });
});

// ─── generateSkillsFromEndpoints ───

describe('generateSkillsFromEndpoints（批量生成）', () => {
  it('批量生成多个 Skill', () => {
    const endpoints = [
      makeEndpoint({ id: 'GET|/api/a', pathname: '/api/a', pathParams: [] }),
      makeEndpoint({ id: 'GET|/api/b', pathname: '/api/b', pathParams: [] }),
      makeEndpoint({ id: 'GET|/api/c', pathname: '/api/c', pathParams: [] }),
    ];
    const skills = generateSkillsFromEndpoints(endpoints);
    expect(skills).toHaveLength(3);
    expect(skills.map((s) => s.endpointId)).toEqual([
      'GET|/api/a',
      'GET|/api/b',
      'GET|/api/c',
    ]);
  });

  it('跳过样本不足的端点', () => {
    const endpoints = [
      makeEndpoint({ id: 'GET|/api/a', pathname: '/api/a', pathParams: [], sampleCount: 3 }),
      makeEndpoint({ id: 'GET|/api/b', pathname: '/api/b', pathParams: [], sampleCount: 1 }),
    ];
    const skills = generateSkillsFromEndpoints(endpoints);
    expect(skills).toHaveLength(1);
    expect(skills[0].endpointId).toBe('GET|/api/a');
  });

  it('跳过无 2xx 状态码的端点', () => {
    const endpoints = [
      makeEndpoint({ id: 'GET|/api/a', pathname: '/api/a', pathParams: [], statusCodes: [200] }),
      makeEndpoint({ id: 'GET|/api/b', pathname: '/api/b', pathParams: [], statusCodes: [500] }),
    ];
    const skills = generateSkillsFromEndpoints(endpoints);
    expect(skills).toHaveLength(1);
    expect(skills[0].endpointId).toBe('GET|/api/a');
  });

  it('空端点列表返回空数组', () => {
    expect(generateSkillsFromEndpoints([])).toEqual([]);
  });

  it('全部端点不合格返回空数组', () => {
    const endpoints = [
      makeEndpoint({ sampleCount: 1 }),
      makeEndpoint({ statusCodes: [] }),
    ];
    expect(generateSkillsFromEndpoints(endpoints)).toEqual([]);
  });
});
