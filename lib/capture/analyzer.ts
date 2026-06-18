/**
 * 流量分析器 — 将捕获的原始请求列表转换为结构化的 API 端点元数据。
 *
 * 核心逻辑：
 * 1. 过滤静态资源和追踪请求
 * 2. 路径归一化（数字 ID → {id}，UUID → {uuid}，hex → {hash}）
 * 3. 按 (method, normalizedPathname) 分组去重
 * 4. 推断 path/query/body 参数 schema
 * 5. 检测认证类型并脱敏
 * 6. 推断响应 Schema
 * 7. 计算初始置信度
 */

import type {
  EndpointMeta,
  ParamType,
  QueryParamDef,
  BodyFieldDef,
  PathParamDef,
  ResponseSchemaDef,
  AuthType,
} from './types';
import type { CapturedRequest } from './capture-session';
import { SKILL_MIN_SAMPLES, CONFIDENCE_MAX } from './types';

// ─── 过滤规则 ───

/** 静态资源扩展名 */
const STATIC_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|css|scss|less|js|mjs|ts|jsx|tsx|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|pdf|zip|tar|gz|rar|7z)(\?|$)/i;

/** 追踪/分析域名 */
const TRACKING_HOSTNAMES = new Set([
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'hotjar.com', 'sentry.io', 'cloudflareinsights.com',
  'amplitude.com', 'mixpanel.com', 'segment.io',
]);

/** 追踪路径关键词 */
const TRACKING_PATHS = /\/(analytics|track|pixel|beacon|gtm\.js|gtag|fbevents|ads|doubleclick|googleadservices)/i;

// ─── 路径归一化 ───

/** 数字 ID → {id} */
const NUMERIC_ID = /^-?\d+$/;
/** UUID → {uuid} */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 长 hex → {hash} */
const LONG_HEX = /^[0-9a-f]{16,}$/i;

/**
 * 归一化路径：将动态片段替换为占位符。
 * /api/users/12345 → /api/users/{id}
 * /api/items/550e8400-e29b-41d4-a716-446655440000 → /api/items/{uuid}
 */
function normalizePath(pathname: string): { normalized: string; params: PathParamDef[] } {
  const segments = pathname.split('/').filter(Boolean);
  const params: PathParamDef[] = [];
  const normalizedSegments: string[] = [];

  for (const seg of segments) {
    if (NUMERIC_ID.test(seg)) {
      normalizedSegments.push('{id}');
      params.push({ name: `id`, placeholder: '{id}' });
    } else if (UUID_RE.test(seg)) {
      normalizedSegments.push('{uuid}');
      params.push({ name: 'uuid', placeholder: '{uuid}' });
    } else if (LONG_HEX.test(seg)) {
      normalizedSegments.push('{hash}');
      params.push({ name: 'hash', placeholder: '{hash}' });
    } else {
      normalizedSegments.push(seg);
    }
  }

  return {
    normalized: '/' + normalizedSegments.join('/'),
    params,
  };
}

// ─── 类型推断 ───

function inferType(value: unknown): ParamType {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (value === 'true' || value === 'false') return 'boolean';
    if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return 'array';
      if (typeof parsed === 'object' && parsed !== null) return 'object';
    } catch { /* not JSON */ }
    return 'string';
  }
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'string';
}

// ─── 认证检测 ───

/** 敏感 header 模式 */
const SENSITIVE_HEADERS = /^(cookie|authorization|x-api-key|x-auth-token|x-csrf-token|api-key|apikey|token|session|x-session-token)/i;

/** 通过 header 判断认证类型 */
function inferAuthType(headers: Record<string, string>): { authType: AuthType; authHeaderName?: string } {
  const headerKeys = Object.keys(headers).map(k => k.toLowerCase());

  for (const key of headerKeys) {
    if (key === 'cookie') return { authType: 'cookie' };
  }

  for (const key of headerKeys) {
    if (key === 'authorization') {
      const val = headers['authorization'] || headers['Authorization'] || '';
      if (val.toLowerCase().startsWith('bearer ')) {
        return { authType: 'bearer' };
      }
      return { authType: 'api-key', authHeaderName: 'authorization' };
    }
  }

  const apiKeyHeaders = ['x-api-key', 'apikey', 'api-key', 'x-auth-token'];
  for (const key of headerKeys) {
    if (apiKeyHeaders.includes(key)) {
      return { authType: 'api-key', authHeaderName: key };
    }
  }

  return { authType: 'none' };
}

// ─── 响应 Schema 推断 ───

function inferJsonSchema(jsonStr: string): { fields?: Record<string, ParamType>; itemsType?: ParamType } | undefined {
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      if (parsed.length > 0) {
        return { itemsType: inferType(parsed[0]) };
      }
      return { itemsType: 'null' };
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const fields: Record<string, ParamType> = {};
      for (const [key, val] of Object.entries(parsed)) {
        fields[key] = inferType(val);
      }
      return { fields };
    }
  } catch { /* not valid JSON */ }
  return undefined;
}

// ─── 端点 ID 计算 ───

function computeEndpointId(method: string, normalizedPathname: string): string {
  return `${method.toUpperCase()}|${normalizedPathname}`;
}

// ─── 主分析函数 ───

/**
 * 分析捕获的请求列表，提取 API 端点元数据。
 *
 * @param requests 捕获到的原始请求列表
 * @returns 去重后的端点元数据列表
 */
export function analyzeRequests(requests: CapturedRequest[]): EndpointMeta[] {
  // 1. 过滤
  const apiRequests = requests.filter((req) => {
    // 必须有响应
    if (!req.responseStatus) return false;
    // 状态码 200-399
    if (req.responseStatus < 200 || req.responseStatus >= 400) return false;
    // 响应必须是 JSON
    if (!req.responseMimeType?.includes('json')) return false;
    // 排除静态资源
    if (STATIC_EXTENSIONS.test(req.url)) return false;
    // 排除追踪路径
    if (TRACKING_PATHS.test(req.url)) return false;
    // 排除追踪域名
    try {
      const url = new URL(req.url);
      for (const tracking of TRACKING_HOSTNAMES) {
        if (url.hostname.includes(tracking)) return false;
      }
    } catch { /* invalid URL */ }
    return true;
  });

  // 2. 分组（按 method + normalizedPathname）
  const groups = new Map<string, CapturedRequest[]>();

  for (const req of apiRequests) {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      continue;
    }

    const { normalized, params } = normalizePath(url.pathname);
    const endpointId = computeEndpointId(req.method, normalized);

    let group = groups.get(endpointId);
    if (!group) {
      group = [];
      groups.set(endpointId, group);
    }
    group.push(req);
  }

  // 3. 为每个分组构建 EndpointMeta
  const endpoints: EndpointMeta[] = [];

  for (const [endpointId, groupRequests] of groups) {
    const firstReq = groupRequests[0];
    let url: URL;
    try {
      url = new URL(firstReq.url);
    } catch {
      continue;
    }

    const { normalized, params: pathParams } = normalizePath(url.pathname);
    const hostname = url.hostname;

    // 推断 query 参数
    const queryParams = inferQueryParams(groupRequests);

    // 推断 body 字段
    const bodyFields = inferBodyFields(groupRequests);

    // 认证检测
    const { authType, authHeaderName } = inferAuthType(firstReq.requestHeaders);

    // 响应 Schema
    const responseSchemas = inferResponseSchemas(groupRequests);

    // 状态码集合
    const statusCodes = [...new Set(groupRequests.map(r => r.responseStatus!).filter(Boolean))];

    // 计算置信度
    const confidence = calculateInitialConfidence(
      groupRequests.length,
      queryParams.length > 0 || bodyFields.length > 0,
      authType !== 'none',
    );

    endpoints.push({
      id: endpointId,
      method: firstReq.method.toUpperCase(),
      pathname: normalized,
      hostname,
      pathParams,
      queryParams,
      bodyFields,
      authType,
      authHeaderName,
      responseSchemas,
      sampleCount: groupRequests.length,
      statusCodes,
      confidence,
      firstSeenAt: Math.min(...groupRequests.map(r => r.timestamp)),
      lastSeenAt: Math.max(...groupRequests.map(r => r.timestamp)),
    });
  }

  return endpoints;
}

// ─── 参数推断辅助 ───

function inferQueryParams(requests: CapturedRequest[]): QueryParamDef[] {
  const paramObservations = new Map<string, { values: unknown[]; count: number }>();

  for (const req of requests) {
    try {
      const url = new URL(req.url);
      for (const [key, value] of url.searchParams.entries()) {
        let obs = paramObservations.get(key);
        if (!obs) {
          obs = { values: [], count: 0 };
          paramObservations.set(key, obs);
        }
        obs.values.push(value);
        obs.count++;
      }
    } catch { /* skip */ }
  }

  const total = requests.length;
  const result: QueryParamDef[] = [];

  for (const [name, obs] of paramObservations) {
    const types = new Set(obs.values.map(inferType));
    const type = types.size === 1 ? [...types][0] : 'string';
    result.push({
      name,
      type,
      required: obs.count === total,
      samples: obs.values.slice(0, 3).map(String),
    });
  }

  return result;
}

function inferBodyFields(requests: CapturedRequest[]): BodyFieldDef[] {
  const fieldObservations = new Map<string, { values: unknown[]; count: number }>();
  let bodyCount = 0;

  for (const req of requests) {
    if (!req.postData) continue;
    try {
      const parsed = JSON.parse(req.postData);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      bodyCount++;

      for (const [key, value] of Object.entries(parsed)) {
        let obs = fieldObservations.get(key);
        if (!obs) {
          obs = { values: [], count: 0 };
          fieldObservations.set(key, obs);
        }
        obs.values.push(value);
        obs.count++;
      }
    } catch { /* not JSON body */ }
  }

  if (bodyCount === 0) return [];

  const result: BodyFieldDef[] = [];
  for (const [name, obs] of fieldObservations) {
    const types = new Set(obs.values.map(inferType));
    const type = types.size === 1 ? [...types][0] : 'string';
    result.push({
      name,
      type,
      required: obs.count === bodyCount,
      samples: obs.values.slice(0, 3).map(v => typeof v === 'string' ? v : JSON.stringify(v)),
    });
  }

  return result;
}

function inferResponseSchemas(requests: CapturedRequest[]): ResponseSchemaDef[] {
  const schemas: ResponseSchemaDef[] = [];
  const seenStatuses = new Set<number>();

  for (const req of requests) {
    if (!req.responseStatus || !req.responseBody) continue;
    if (seenStatuses.has(req.responseStatus)) continue;
    seenStatuses.add(req.responseStatus);

    const inferred = inferJsonSchema(req.responseBody);
    const schema: ResponseSchemaDef = {
      status: req.responseStatus,
      mimeType: req.responseMimeType ?? 'application/json',
    };

    if (inferred && inferred.fields) {
      schema.fields = inferred.fields;
    } else if (inferred && inferred.itemsType) {
      schema.itemsType = inferred.itemsType;
    }

    schemas.push(schema);
  }

  return schemas;
}

// ─── 置信度计算 ───

function calculateInitialConfidence(
  sampleCount: number,
  hasParams: boolean,
  hasAuth: boolean,
): number {
  let confidence = 0.5;
  if (sampleCount >= 5) confidence += 0.2;
  else if (sampleCount >= 3) confidence += 0.1;
  if (hasParams) confidence += 0.1;
  if (hasAuth) confidence += 0.1;
  return Math.min(confidence, CONFIDENCE_MAX);
}

// ─── Skill 生成质量门槛 ───

/** 判断端点是否满足 Skill 生成条件 */
export function shouldGenerateSkill(endpoint: EndpointMeta): boolean {
  return (
    endpoint.sampleCount >= SKILL_MIN_SAMPLES &&
    endpoint.statusCodes.length > 0 &&
    endpoint.statusCodes.some(code => code >= 200 && code < 300)
  );
}
