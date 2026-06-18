/**
 * lib/capture/analyzer.ts 测试
 *
 * `normalizePath` / `inferType` / `inferAuthType` 是 analyzer 内部函数（未导出），
 * 这里通过公开的 `analyzeRequests` 入口验证它们的行为——构造特定输入，断言
 * EndpointMeta 上的 pathname/pathParams/queryParams/bodyFields/authType 字段。
 *
 * 覆盖范围：
 * - normalizePath：数字 ID / UUID / 长 hex / 普通片段
 * - inferType：string/number/boolean/object/array/null
 * - inferAuthType：cookie/bearer/api-key/none
 * - analyzeRequests：完整分析流程（分组、去重、参数推断、置信度计算）
 * - shouldGenerateSkill：样本数门槛
 * - 过滤逻辑：静态资源、追踪域名/路径、非 JSON 响应、状态码范围
 */
import { describe, it, expect } from 'vitest';
import { analyzeRequests, shouldGenerateSkill } from '@/lib/capture/analyzer';
import type { CapturedRequest } from '@/lib/capture/capture-session';
import type { EndpointMeta } from '@/lib/capture/types';

// ─── 测试辅助 ───

let reqIdSeq = 0;

function nextReqId(): string {
  return `req-${++reqIdSeq}`;
}

/** 构造一条 CapturedRequest，默认 200 + JSON */
function makeRequest(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    requestId: nextReqId(),
    url: 'https://api.example.com/api/users',
    method: 'GET',
    requestHeaders: {},
    timestamp: Date.now(),
    responseStatus: 200,
    responseMimeType: 'application/json',
    responseBody: '{"ok":true}',
    ...overrides,
  };
}

/** 从端点列表中按 method+pathname 查找 */
function findEndpoint(
  endpoints: EndpointMeta[],
  method: string,
  pathname: string,
): EndpointMeta | undefined {
  return endpoints.find(
    (e) => e.method === method.toUpperCase() && e.pathname === pathname,
  );
}

// ─── normalizePath（通过 analyzeRequests 的 pathname/pathParams 验证） ───

describe('normalizePath（路径归一化）', () => {
  it('数字 ID 片段替换为 {id} 并记录 pathParam', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/users/12345',
    });
    const endpoints = analyzeRequests([req]);
    const ep = endpoints[0];
    expect(ep.pathname).toBe('/api/users/{id}');
    expect(ep.pathParams).toEqual([{ name: 'id', placeholder: '{id}' }]);
  });

  it('UUID 片段替换为 {uuid}', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/items/550e8400-e29b-41d4-a716-446655440000',
    });
    const endpoints = analyzeRequests([req]);
    expect(endpoints[0].pathname).toBe('/api/items/{uuid}');
    expect(endpoints[0].pathParams).toEqual([
      { name: 'uuid', placeholder: '{uuid}' },
    ]);
  });

  it('长 hex（>=16 位）片段替换为 {hash}', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/blob/0123456789abcdef0123456789abcdef',
    });
    const endpoints = analyzeRequests([req]);
    expect(endpoints[0].pathname).toBe('/api/blob/{hash}');
    expect(endpoints[0].pathParams).toEqual([
      { name: 'hash', placeholder: '{hash}' },
    ]);
  });

  it('普通字符串片段保持原样，不产生 pathParam', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/users/me',
    });
    const endpoints = analyzeRequests([req]);
    expect(endpoints[0].pathname).toBe('/api/users/me');
    expect(endpoints[0].pathParams).toEqual([]);
  });

  it('同一端点的不同数字 ID 被归一化到同一分组', () => {
    const reqs = [
      makeRequest({ url: 'https://api.example.com/api/users/1' }),
      makeRequest({ url: 'https://api.example.com/api/users/2' }),
      makeRequest({ url: 'https://api.example.com/api/users/999' }),
    ];
    const endpoints = analyzeRequests(reqs);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].pathname).toBe('/api/users/{id}');
    expect(endpoints[0].sampleCount).toBe(3);
  });

  it('混合占位符路径仍按归一化结果分组', () => {
    const reqs = [
      makeRequest({ url: 'https://api.example.com/api/users/123/posts/456' }),
      makeRequest({ url: 'https://api.example.com/api/users/789/posts/0' }),
    ];
    const endpoints = analyzeRequests(reqs);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].pathname).toBe('/api/users/{id}/posts/{id}');
    expect(endpoints[0].pathParams).toHaveLength(2);
  });
});

// ─── inferType（通过 queryParams/bodyFields 的 type 字段验证） ───

describe('inferType（类型推断）', () => {
  it('query 参数 "5" 推断为 number', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/users?count=5',
    });
    const ep = analyzeRequests([req])[0];
    const count = ep.queryParams.find((q) => q.name === 'count');
    expect(count?.type).toBe('number');
  });

  it('query 参数 "true"/"false" 推断为 boolean', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/users?active=true&closed=false',
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.queryParams.find((q) => q.name === 'active')?.type).toBe('boolean');
    expect(ep.queryParams.find((q) => q.name === 'closed')?.type).toBe('boolean');
  });

  it('query 参数普通字符串推断为 string', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/users?name=alice',
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.queryParams.find((q) => q.name === 'name')?.type).toBe('string');
  });

  it('query 参数 JSON 数组字符串推断为 array', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/users?ids=%5B1%2C2%2C3%5D', // [1,2,3]
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.queryParams.find((q) => q.name === 'ids')?.type).toBe('array');
  });

  it('query 参数 JSON 对象字符串推断为 object', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/users?filter=%7B%22a%22%3A1%7D', // {"a":1}
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.queryParams.find((q) => q.name === 'filter')?.type).toBe('object');
  });

  it('body 字段 number/boolean/string/object/array/null 各类型正确推断', () => {
    const req = makeRequest({
      method: 'POST',
      url: 'https://api.example.com/api/items',
      postData: JSON.stringify({
        count: 5,
        active: true,
        name: 'alice',
        meta: { x: 1 },
        tags: ['a', 'b'],
        nothing: null,
      }),
    });
    const ep = analyzeRequests([req])[0];
    const fields = new Map(ep.bodyFields.map((f) => [f.name, f.type]));
    expect(fields.get('count')).toBe('number');
    expect(fields.get('active')).toBe('boolean');
    expect(fields.get('name')).toBe('string');
    expect(fields.get('meta')).toBe('object');
    expect(fields.get('tags')).toBe('array');
    expect(fields.get('nothing')).toBe('null');
  });

  it('query 参数 required 标记：所有样本都出现 → required=true', () => {
    const reqs = [
      makeRequest({ url: 'https://api.example.com/api/users?a=1&b=2' }),
      makeRequest({ url: 'https://api.example.com/api/users?a=3&b=4' }),
    ];
    const ep = analyzeRequests(reqs)[0];
    expect(ep.queryParams.find((q) => q.name === 'a')?.required).toBe(true);
    expect(ep.queryParams.find((q) => q.name === 'b')?.required).toBe(true);
  });

  it('query 参数 required 标记：仅部分样本出现 → required=false', () => {
    const reqs = [
      makeRequest({ url: 'https://api.example.com/api/users?a=1&b=2' }),
      makeRequest({ url: 'https://api.example.com/api/users?a=3' }),
    ];
    const ep = analyzeRequests(reqs)[0];
    expect(ep.queryParams.find((q) => q.name === 'a')?.required).toBe(true);
    expect(ep.queryParams.find((q) => q.name === 'b')?.required).toBe(false);
  });

  it('query 参数 samples 最多保留 3 个', () => {
    const reqs = Array.from({ length: 5 }, (_, i) =>
      makeRequest({ url: `https://api.example.com/api/users?a=${i}` }),
    );
    const ep = analyzeRequests(reqs)[0];
    expect(ep.queryParams[0].samples).toHaveLength(3);
  });
});

// ─── inferAuthType（通过 EndpointMeta.authType/authHeaderName 验证） ───

describe('inferAuthType（认证类型检测）', () => {
  it('cookie header → authType=cookie', () => {
    const req = makeRequest({
      requestHeaders: { cookie: 'session=abc; foo=bar' },
    });
    expect(analyzeRequests([req])[0].authType).toBe('cookie');
  });

  it('Authorization: Bearer xxx → authType=bearer', () => {
    const req = makeRequest({
      requestHeaders: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.xxx.yyy' },
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.authType).toBe('bearer');
    expect(ep.authHeaderName).toBeUndefined();
  });

  it('Authorization: Basic xxx → authType=api-key, authHeaderName=authorization', () => {
    const req = makeRequest({
      requestHeaders: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.authType).toBe('api-key');
    expect(ep.authHeaderName).toBe('authorization');
  });

  it('x-api-key header → authType=api-key, authHeaderName=x-api-key', () => {
    const req = makeRequest({
      requestHeaders: { 'x-api-key': 'sk-12345' },
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.authType).toBe('api-key');
    expect(ep.authHeaderName).toBe('x-api-key');
  });

  it('apikey header → authType=api-key, authHeaderName=apikey', () => {
    const req = makeRequest({
      requestHeaders: { apikey: 'sk-12345' },
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.authType).toBe('api-key');
    expect(ep.authHeaderName).toBe('apikey');
  });

  it('api-key header → authType=api-key, authHeaderName=api-key', () => {
    const req = makeRequest({
      requestHeaders: { 'api-key': 'sk-12345' },
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.authType).toBe('api-key');
    expect(ep.authHeaderName).toBe('api-key');
  });

  it('x-auth-token header → authType=api-key, authHeaderName=x-auth-token', () => {
    const req = makeRequest({
      requestHeaders: { 'x-auth-token': 'tok-12345' },
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.authType).toBe('api-key');
    expect(ep.authHeaderName).toBe('x-auth-token');
  });

  it('无认证 header → authType=none', () => {
    const req = makeRequest({
      requestHeaders: { 'content-type': 'application/json' },
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.authType).toBe('none');
    expect(ep.authHeaderName).toBeUndefined();
  });

  it('cookie 优先级高于 authorization', () => {
    // inferAuthType 先检查 cookie 再检查 authorization
    const req = makeRequest({
      requestHeaders: {
        cookie: 'session=abc',
        authorization: 'Bearer xxx',
      },
    });
    expect(analyzeRequests([req])[0].authType).toBe('cookie');
  });
});

// ─── analyzeRequests 完整流程 ───

describe('analyzeRequests 完整分析流程', () => {
  it('按 method + normalizedPathname 分组去重', () => {
    const reqs = [
      makeRequest({ method: 'GET', url: 'https://api.example.com/api/users/1' }),
      makeRequest({ method: 'GET', url: 'https://api.example.com/api/users/2' }),
      makeRequest({ method: 'POST', url: 'https://api.example.com/api/users' }),
      makeRequest({ method: 'GET', url: 'https://api.example.com/api/posts/10' }),
    ];
    const endpoints = analyzeRequests(reqs);
    expect(endpoints).toHaveLength(3);
    const ids = endpoints.map((e) => e.id).sort();
    expect(ids).toEqual([
      'GET|/api/posts/{id}',
      'GET|/api/users/{id}',
      'POST|/api/users',
    ]);
  });

  it('hostname 从 URL 提取', () => {
    const req = makeRequest({
      url: 'https://sub.example.com/api/data',
    });
    expect(analyzeRequests([req])[0].hostname).toBe('sub.example.com');
  });

  it('method 转大写', () => {
    const req = makeRequest({ method: 'get' });
    expect(analyzeRequests([req])[0].method).toBe('GET');
  });

  it('statusCodes 收集分组内所有状态码（去重）', () => {
    const reqs = [
      makeRequest({ url: 'https://api.example.com/api/x', responseStatus: 200 }),
      makeRequest({ url: 'https://api.example.com/api/x', responseStatus: 201 }),
      makeRequest({ url: 'https://api.example.com/api/x', responseStatus: 200 }),
    ];
    const ep = analyzeRequests(reqs)[0];
    expect(ep.statusCodes.sort()).toEqual([200, 201]);
  });

  it('firstSeenAt/lastSeenAt 取分组内最早/最晚时间戳', () => {
    const reqs = [
      makeRequest({ url: 'https://api.example.com/api/x', timestamp: 1000 }),
      makeRequest({ url: 'https://api.example.com/api/x', timestamp: 3000 }),
      makeRequest({ url: 'https://api.example.com/api/x', timestamp: 2000 }),
    ];
    const ep = analyzeRequests(reqs)[0];
    expect(ep.firstSeenAt).toBe(1000);
    expect(ep.lastSeenAt).toBe(3000);
  });

  it('responseSchemas 按状态码去重，object 响应提取 fields', () => {
    const reqs = [
      makeRequest({
        url: 'https://api.example.com/api/x',
        responseStatus: 200,
        responseBody: '{"id":1,"name":"a"}',
      }),
      makeRequest({
        url: 'https://api.example.com/api/x',
        responseStatus: 201,
        responseBody: '{"created":true}',
      }),
    ];
    const ep = analyzeRequests(reqs)[0];
    expect(ep.responseSchemas).toHaveLength(2);
    const schema200 = ep.responseSchemas.find((s) => s.status === 200);
    expect(schema200?.fields).toEqual({ id: 'number', name: 'string' });
    const schema201 = ep.responseSchemas.find((s) => s.status === 201);
    expect(schema201?.fields).toEqual({ created: 'boolean' });
  });

  it('responseSchemas 数组响应提取 itemsType', () => {
    const req = makeRequest({
      responseBody: '[{"id":1}]',
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.responseSchemas[0].itemsType).toBe('object');
  });

  it('置信度：1 样本 + 无参数 + 无认证 = 0.5', () => {
    const req = makeRequest({
      url: 'https://api.example.com/api/x',
      requestHeaders: {},
    });
    const ep = analyzeRequests([req])[0];
    expect(ep.confidence).toBe(0.5);
  });

  it('置信度：>=5 样本 + 有参数 + 有认证 = 0.9（封顶 0.95）', () => {
    const reqs = Array.from({ length: 5 }, () =>
      makeRequest({
        url: 'https://api.example.com/api/x?a=1',
        requestHeaders: { cookie: 's=1' },
      }),
    );
    const ep = analyzeRequests(reqs)[0];
    // 0.5 + 0.2 (>=5 samples) + 0.1 (params) + 0.1 (auth) = 0.9
    expect(ep.confidence).toBeCloseTo(0.9, 10);
  });

  it('置信度：3-4 样本 = 0.5 + 0.1 = 0.6', () => {
    const reqs = Array.from({ length: 3 }, () =>
      makeRequest({ url: 'https://api.example.com/api/x' }),
    );
    const ep = analyzeRequests(reqs)[0];
    expect(ep.confidence).toBe(0.6);
  });

  it('空请求列表返回空数组', () => {
    expect(analyzeRequests([])).toEqual([]);
  });
});

// ─── 过滤逻辑 ───

describe('analyzeRequests 过滤逻辑', () => {
  it('无 responseStatus 的请求被过滤', () => {
    const req = makeRequest({ responseStatus: undefined });
    expect(analyzeRequests([req])).toHaveLength(0);
  });

  it('状态码 < 200 被过滤', () => {
    const req = makeRequest({ responseStatus: 199 });
    expect(analyzeRequests([req])).toHaveLength(0);
  });

  it('状态码 >= 400 被过滤', () => {
    const req = makeRequest({ responseStatus: 404 });
    expect(analyzeRequests([req])).toHaveLength(0);
  });

  it('非 JSON 响应被过滤', () => {
    const req = makeRequest({
      responseMimeType: 'text/html',
      responseBody: '<html></html>',
    });
    expect(analyzeRequests([req])).toHaveLength(0);
  });

  it('responseMimeType 缺失被过滤', () => {
    const req = makeRequest({ responseMimeType: undefined });
    expect(analyzeRequests([req])).toHaveLength(0);
  });

  it('静态资源扩展名被过滤（.js/.css/.png/.woff2 等）', () => {
    const reqs = [
      makeRequest({ url: 'https://api.example.com/app.js' }),
      makeRequest({ url: 'https://api.example.com/style.css' }),
      makeRequest({ url: 'https://api.example.com/logo.png' }),
      makeRequest({ url: 'https://api.example.com/font.woff2' }),
      makeRequest({ url: 'https://api.example.com/data.json' }), // 应保留
    ];
    const endpoints = analyzeRequests(reqs);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].pathname).toBe('/data.json');
  });

  it('静态资源扩展名带 query 仍被过滤', () => {
    const req = makeRequest({
      url: 'https://api.example.com/app.js?v=123',
    });
    expect(analyzeRequests([req])).toHaveLength(0);
  });

  it('追踪域名被过滤（google-analytics.com 等）', () => {
    const reqs = [
      makeRequest({
        url: 'https://www.google-analytics.com/collect',
      }),
      makeRequest({
        url: 'https://api.amplitude.com/track',
      }),
      makeRequest({
        url: 'https://api.example.com/api/data', // 保留
      }),
    ];
    const endpoints = analyzeRequests(reqs);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].hostname).toBe('api.example.com');
  });

  it('追踪路径关键词被过滤（/analytics、/track、/pixel 等）', () => {
    const reqs = [
      makeRequest({
        url: 'https://api.example.com/analytics/report',
      }),
      makeRequest({
        url: 'https://api.example.com/track/event',
      }),
      makeRequest({
        url: 'https://api.example.com/api/data', // 保留
      }),
    ];
    const endpoints = analyzeRequests(reqs);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].pathname).toBe('/api/data');
  });

  it('非法 URL 被跳过（不抛异常）', () => {
    const reqs = [
      makeRequest({ url: 'not-a-valid-url' }),
      makeRequest({ url: 'https://api.example.com/api/ok' }),
    ];
    const endpoints = analyzeRequests(reqs);
    expect(endpoints).toHaveLength(1);
  });
});

// ─── shouldGenerateSkill ───

describe('shouldGenerateSkill（Skill 生成门槛）', () => {
  function makeEndpoint(overrides: Partial<EndpointMeta> = {}): EndpointMeta {
    return {
      id: 'GET|/api/x',
      method: 'GET',
      pathname: '/api/x',
      hostname: 'api.example.com',
      pathParams: [],
      queryParams: [],
      bodyFields: [],
      authType: 'none',
      responseSchemas: [],
      sampleCount: 2,
      statusCodes: [200],
      confidence: 0.5,
      firstSeenAt: 0,
      lastSeenAt: 0,
      ...overrides,
    };
  }

  it('sampleCount >= 2 且有 2xx 状态码 → true', () => {
    expect(shouldGenerateSkill(makeEndpoint({ sampleCount: 2, statusCodes: [200] }))).toBe(true);
  });

  it('sampleCount = 1 → false（不足最少样本数）', () => {
    expect(shouldGenerateSkill(makeEndpoint({ sampleCount: 1, statusCodes: [200] }))).toBe(false);
  });

  it('sampleCount = 0 → false', () => {
    expect(shouldGenerateSkill(makeEndpoint({ sampleCount: 0, statusCodes: [200] }))).toBe(false);
  });

  it('statusCodes 为空 → false', () => {
    expect(shouldGenerateSkill(makeEndpoint({ sampleCount: 5, statusCodes: [] }))).toBe(false);
  });

  it('statusCodes 仅含 4xx/5xx → false', () => {
    expect(
      shouldGenerateSkill(makeEndpoint({ sampleCount: 5, statusCodes: [404, 500] })),
    ).toBe(false);
  });

  it('statusCodes 含 2xx 即可（即使有 4xx）→ true', () => {
    expect(
      shouldGenerateSkill(makeEndpoint({ sampleCount: 3, statusCodes: [200, 404] })),
    ).toBe(true);
  });

  it('statusCodes 含 3xx 但无 2xx → false', () => {
    expect(
      shouldGenerateSkill(makeEndpoint({ sampleCount: 3, statusCodes: [301, 302] })),
    ).toBe(false);
  });
});
