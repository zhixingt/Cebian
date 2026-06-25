/**
 * Skill 生成器 — 将 EndpointMeta 转换为可执行的 API Skill 脚本。
 *
 * 生成的脚本遵循 CebianX skill 规范：
 * - 导出 async function run(args) 入口
 * - 使用全局 bgFetch(url, init) 发起请求（绕过 CORS）
 * - 不存储任何凭证（凭证零信任）
 */

import type { EndpointMeta, AutoSkillDefinition, SkillStats } from './types';
import { shouldGenerateSkill } from './analyzer';

/** 创建初始执行统计 */
function createInitialStats(): SkillStats {
  return {
    callCount: 0,
    successCount: 0,
    failureCount: 0,
    lastCalledAt: null,
    dynamicConfidence: 0,
  };
}

/** 生成 Skill 名称 */
function generateSkillName(hostname: string, endpointId: string): string {
  const safeHost = hostname.replace(/\./g, '-');
  const safeId = endpointId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  return `auto-${safeHost}-${safeId}`;
}

/** 生成 bgFetch 权限 pattern */
function generateBgFetchPattern(hostname: string, pathname: string): string {
  // 将路径中的 {id}/{uuid}/{hash} 占位符替换为通配符
  const wildcardPath = pathname
    .replace(/\{id\}/g, '*')
    .replace(/\{uuid\}/g, '*')
    .replace(/\{hash\}/g, '*');
  return `https://${hostname}${wildcardPath}`;
}

/**
 * 生成 Skill 脚本代码。
 *
 * 脚本模板：
 * - 构造 URL（含 query params）
 * - 构造 body（如有 bodyFields）
 * - 调用 bgFetch
 * - 解码并返回响应
 */
function generateSkillScript(endpoint: EndpointMeta): string {
  const { method, pathname, queryParams, bodyFields, hostname } = endpoint;

  const lines: string[] = [
    '/**',
    ` * Auto-generated API Skill: ${method} ${pathname}`,
    ` * Host: ${hostname}`,
    ` * Generated at: ${new Date().toISOString()}`,
    ' * Credentials: zero-trust (dynamically injected at runtime)',
    ' */',
    'async function run(args = {}) {',
    `  const base = 'https://${hostname}${pathname}';`,
  ];

  // Path 参数替换
  const pathParams = endpoint.pathParams;
  if (pathParams.length > 0) {
    lines.push('  // 替换路径参数');
    for (const p of pathParams) {
      lines.push(`  const ${p.name} = args.${p.name} ?? '';`);
      lines.push(`  const url = base.replace('{${p.placeholder}}', encodeURIComponent(${p.name}));`);
    }
  } else {
    lines.push('  const url = base;');
  }

  // Query 参数
  if (queryParams.length > 0) {
    lines.push('  // 构造 query 参数');
    lines.push('  const params = new URLSearchParams();');
    for (const q of queryParams) {
      lines.push(`  if (args.${q.name} != null) params.set('${q.name}', String(args.${q.name}));`);
    }
    lines.push('  const finalUrl = params.toString() ? `${url}?${params}` : url;');
  } else {
    lines.push('  const finalUrl = url;');
  }

  // 请求 init
  lines.push('  const init = {');
  lines.push(`    method: '${method}',`);
  lines.push("    headers: { 'Content-Type': 'application/json' },");

  // Body
  if (bodyFields.length > 0 && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    lines.push('    body: JSON.stringify({');
    for (let i = 0; i < bodyFields.length; i++) {
      const f = bodyFields[i];
      const comma = i < bodyFields.length - 1 ? ',' : '';
      lines.push(`      ${f.name}: args.${f.name},${comma}`);
    }
    lines.push('    }),');
  }

  lines.push('  };');

  // 调用 bgFetch
  lines.push('');
  lines.push('  const resp = await bgFetch(finalUrl, init);');
  lines.push('  const text = await resp.text();');
  lines.push('');
  lines.push('  let data;');
  lines.push('  try { data = JSON.parse(text); } catch { data = text; }');
  lines.push('');
  lines.push('  return {');
  lines.push('    status: resp.status,');
  lines.push('    ok: resp.ok,');
  lines.push('    data,');
  lines.push('  };');
  lines.push('}');

  return lines.join('\n');
}

/**
 * 从端点元数据生成 Skill 定义。
 * 如果端点不满足生成条件（样本数不足等），返回 null。
 */
export function generateSkillFromEndpoint(endpoint: EndpointMeta): AutoSkillDefinition | null {
  if (!shouldGenerateSkill(endpoint)) {
    return null;
  }

  const name = generateSkillName(endpoint.hostname, endpoint.id);
  const pattern = generateBgFetchPattern(endpoint.hostname, endpoint.pathname);
  const script = generateSkillScript(endpoint);

  return {
    name,
    description: `Auto-discovered API: ${endpoint.method} ${endpoint.pathname} (${endpoint.hostname})`,
    endpointId: endpoint.id,
    hostname: endpoint.hostname,
    method: endpoint.method,
    authType: endpoint.authType,
    authHeaderName: endpoint.authHeaderName,
    pathname: endpoint.pathname,
    pathParams: endpoint.pathParams,
    queryParams: endpoint.queryParams,
    bodyFields: endpoint.bodyFields,
    bgFetchPatterns: [pattern],
    script,
    initialConfidence: endpoint.confidence,
    enabled: false, // 默认禁用，用户手动启用
    createdAt: Date.now(),
    stats: createInitialStats(),
  };
}

/**
 * 批量生成 Skill。
 */
export function generateSkillsFromEndpoints(endpoints: EndpointMeta[]): AutoSkillDefinition[] {
  const skills: AutoSkillDefinition[] = [];
  for (const endpoint of endpoints) {
    const skill = generateSkillFromEndpoint(endpoint);
    if (skill) {
      skills.push(skill);
    }
  }
  return skills;
}
