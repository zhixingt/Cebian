/**
 * Agent 上下文构建辅助。
 *
 * 根据当前 active tab 的 hostname，将已启用、高置信度的自动发现 API Skill
 * 格式化为 system prompt 前导文本，让 Agent 知道可以优先调用哪些站点 API。
 */

import { getEnabledSkillsForHostname, getEffectiveConfidence } from '@/lib/capture/skill-registry';
import type { AutoSkillDefinition, BodyFieldDef, PathParamDef, QueryParamDef } from '@/lib/capture/types';

/**
 * 构建当前站点的自动发现 API Skill 前导文本。
 * @param hostname 当前 active tab 的 hostname；缺失或无可达 Skill 时返回空字符串
 */
export async function buildApiSkillPreamble(hostname?: string): Promise<string> {
  if (!hostname) return '';

  let skills: AutoSkillDefinition[];
  try {
    skills = await getEnabledSkillsForHostname(hostname);
  } catch (err) {
    console.warn('[agent-context] failed to load enabled skills:', err);
    return '';
  }

  if (skills.length === 0) return '';

  const lines: string[] = [];
  lines.push('AUTO-DISCOVERED API SKILLS FOR CURRENT SITE:');

  for (const skill of skills) {
    const confidencePct = Math.round(getEffectiveConfidence(skill) * 100);
    const params = buildParamList(skill);
    const paramPart = params.length > 0 ? `: ${params.join(' ')}` : '';
    lines.push(`- ${skill.method} ${skill.pathname} [confidence=${confidencePct}%]${paramPart}`);
  }

  lines.push(
    'When reading structured data from this site, prefer using smart_read_page with mode="json" and the URL matching the skill pathname.',
  );
  lines.push(
    'For write operations (POST/PUT/DELETE), ask the user for confirmation first unless the skill has been converted to a regular skill.',
  );

  return lines.join('\n');
}

/** 合并 pathParams / queryParams / bodyFields 为 name(type, required) 列表 */
function buildParamList(skill: AutoSkillDefinition): string[] {
  const out: string[] = [];

  for (const p of skill.pathParams ?? []) {
    out.push(formatParam(p));
  }
  for (const q of skill.queryParams ?? []) {
    out.push(formatParam(q));
  }
  for (const b of skill.bodyFields ?? []) {
    out.push(formatParam(b));
  }

  return out;
}

function formatParam(param: PathParamDef | QueryParamDef | BodyFieldDef): string {
  if ('type' in param) {
    return `${param.name}(${param.type}, ${param.required ? 'required' : 'optional'})`;
  }
  return `${param.name}(string, required)`;
}
