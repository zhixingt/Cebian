/**
 * API-first 执行器 — 优先调用自动发现的 API Skill，失败回退 DOM。
 *
 * 执行流程：
 * 1. 查找匹配的 API Skill
 * 2. 动态注入认证（cookie/bearer/api-key）
 * 3. 通过 bgFetch 发起请求
 * 4. 成功 → 返回 API 响应
 * 5. 失败（401/403/5xx/超时）→ 抛出 NoMatchError，调用方回退 DOM
 */

import type { AutoSkillDefinition } from './types';
import { findMatchingSkill, updateSkillStats, getEffectiveConfidence } from './skill-registry';

/** API 未匹配或失败时抛出，调用方应回退 DOM 工具 */
export class NoMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoMatchError';
  }
}

/** API 执行结果 */
export interface ApiExecuteResult {
  success: boolean;
  /** 响应数据 */
  data: unknown;
  /** 响应状态码 */
  status: number;
  /** 耗时（ms） */
  latencyMs: number;
  /** 使用的 Skill ID */
  skillName: string;
  /** Skill 置信度 */
  confidence: number;
  /** 执行路径：'api' 或 'fallback' */
  path: 'api' | 'fallback';
  /** 实际使用的 HTTP 方法 */
  method: string;
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * 动态获取认证 headers。
 * 凭证零信任：不存储，每次执行时动态读取。
 */
async function getDynamicAuthHeaders(
  hostname: string,
  authType: string,
  authHeaderName?: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  switch (authType) {
    case 'cookie': {
      // 通过 chrome.cookies API 读取当前站点的 cookie
      try {
        const cookies = await chrome.cookies.getAll({ domain: hostname });
        if (cookies.length > 0) {
          headers['Cookie'] = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        }
      } catch (err) {
        console.warn('[api-executor] failed to get cookies:', err);
      }
      break;
    }

    case 'bearer':
    case 'api-key': {
      // 从页面 localStorage/sessionStorage 读取 token
      try {
        const tabs = await chrome.tabs.query({ url: `*://${hostname}/*` });
        if (tabs.length > 0 && tabs[0].id) {
          const tokenKeys = ['token', 'auth_token', 'access_token', 'jwt', 'authorization'];
          const results = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (keys: string[]) => {
              const found: Record<string, string> = {};
              for (const key of keys) {
                const val = localStorage.getItem(key) ?? sessionStorage.getItem(key);
                if (val) found[key] = val;
              }
              return found;
            },
            args: [tokenKeys],
          });

          if (results.length > 0 && results[0].result) {
            const tokens = results[0].result as Record<string, string>;
            const tokenValue = Object.values(tokens)[0];
            if (tokenValue) {
              const headerName = authHeaderName ?? 'Authorization';
              if (authType === 'bearer') {
                headers[headerName] = `Bearer ${tokenValue}`;
              } else {
                headers[headerName] = tokenValue;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[api-executor] failed to get token from localStorage:', err);
      }
      break;
    }

    case 'none':
    default:
      // 无需认证
      break;
  }

  return headers;
}

/**
 * 执行 API 调用。
 *
 * @param url 目标 URL
 * @param method HTTP 方法
 * @param intent 操作意图描述（用于 Skill 匹配）
 * @param data 请求体数据（POST/PUT/PATCH）
 * @returns API 执行结果
 * @throws NoMatchError 当无匹配 Skill 或 API 调用失败时
 */
export async function executeApiFirst(
  url: string,
  method: string,
  intent?: string,
  data?: Record<string, unknown>,
): Promise<ApiExecuteResult> {
  const startTime = Date.now();

  // 1. 查找匹配的 Skill
  const skill = await findMatchingSkill(url, intent);
  if (!skill) {
    throw new NoMatchError(`No matching API skill for ${method} ${url}`);
  }

  // 2. 构造请求
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new NoMatchError(`Invalid URL: ${url}`);
  }

  // 动态认证注入（使用 skill 的 authType，而非 HTTP method）
  const authHeaders = await getDynamicAuthHeaders(
    skill.hostname,
    skill.authType,
    skill.authHeaderName,
  );

  // 构造请求 init
  const init: RequestInit = {
    method: skill.method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
  };

  if (data && (skill.method === 'POST' || skill.method === 'PUT' || skill.method === 'PATCH')) {
    init.body = JSON.stringify(data);
  }

  // 3. 通过 bgFetch 发起请求
  try {
    // bgFetch 是在 sandbox 中运行的全局函数，这里通过 background 的 handleBgFetch 调用
    // 实际实现需要通过消息发送到 background
    const response = await callBgFetch(parsedUrl.toString(), init, skill.bgFetchPatterns);

    const latencyMs = Date.now() - startTime;
    const success = response.ok;

    // 4. 更新统计
    await updateSkillStats(skill.name, success);

    if (!success) {
      // API 返回错误状态码，回退 DOM
      throw new NoMatchError(
        `API ${skill.method} ${skill.pathname} returned ${response.status}`,
      );
    }

    return {
      success: true,
      data: response.data,
      status: response.status,
      latencyMs,
      skillName: skill.name,
      confidence: getEffectiveConfidence(skill),
      path: 'api',
      method: skill.method,
    };
  } catch (err) {
    if (err instanceof NoMatchError) throw err;

    // 网络错误/超时，标记失败并回退
    await updateSkillStats(skill.name, false);

    throw new NoMatchError(
      `API call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── bgFetch 桥接 ───

/** bgFetch 响应结构 */
interface BgFetchResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * 通过 background 的 bgFetch 发起请求。
 * 使用 Skill 声明的 bgFetchPatterns 作为权限边界，防止 SSRF。
 */
async function callBgFetch(
  url: string,
  init: RequestInit,
  bgFetchPatterns: string[],
): Promise<BgFetchResponse> {
  const { handleBgFetch } = await import('@/lib/tools/bg-fetch');
  const { parseMatchPattern } = await import('@/lib/tools/url-pattern');

  // 使用 Skill 声明的精确 pattern，而非通配符
  const patterns = bgFetchPatterns
    .map(p => parseMatchPattern(p))
    .filter((p): p is NonNullable<typeof p> => p != null);

  if (patterns.length === 0) {
    throw new NoMatchError(`No valid bgFetch patterns for skill`);
  }

  const response = await handleBgFetch(
    url,
    {
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    },
    patterns,
  );

  // RawBgFetchResponse 的 body 是 Uint8Array
  const text = new TextDecoder().decode(response.body);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    data,
  };
}
