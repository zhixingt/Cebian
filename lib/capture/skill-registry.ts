/**
 * Skill 注册表 — 管理自动发现的 API Skill 的内存索引和 IndexedDB 持久化。
 *
 * 按 hostname 隔离，支持：
 * - 查询某站点的所有 Skill
 * - 查找匹配 URL + intent 的 Skill
 * - 启用/禁用/删除 Skill
 * - 更新执行统计和动态置信度
 */

import type { AutoSkillDefinition, SkillStats } from './types';
import {
  CONFIDENCE_HISTORY_WEIGHT,
  CONFIDENCE_RECENT_WEIGHT,
  CONFIDENCE_MAX,
  SKILL_MIN_CONFIDENCE,
  SKILL_ENABLE_MIN_CALLS,
} from './types';
import { getDb } from '@/lib/db';

// ─── 内存索引 ───

/** 按 hostname 分组的 Skill 映射 */
const skillsByHostname = new Map<string, AutoSkillDefinition[]>();

/** 按 Skill 名称索引 */
const skillsByName = new Map<string, AutoSkillDefinition>();

/** 是否已从 IndexedDB 加载 */
let loaded = false;

// ─── 加载/持久化 ───

/** 从 IndexedDB 加载所有 Skill 到内存 */
async function loadFromDb(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    const db = getDb();
    const all = await db.autoSkills.toArray();
    skillsByHostname.clear();
    skillsByName.clear();

    for (const skill of all) {
      registerInMemory(skill);
    }
  } catch (err) {
    console.error('[skill-registry] failed to load from DB:', err);
  }
}

/** 持久化 Skill 到 IndexedDB */
async function persistSkill(skill: AutoSkillDefinition): Promise<void> {
  try {
    const db = getDb();
    await db.autoSkills.put(skill);
  } catch (err) {
    console.error('[skill-registry] failed to persist skill:', err);
  }
}

/** 批量持久化 */
async function persistSkills(skills: AutoSkillDefinition[]): Promise<void> {
  if (skills.length === 0) return;
  try {
    const db = getDb();
    await db.autoSkills.bulkPut(skills);
  } catch (err) {
    console.error('[skill-registry] failed to bulk persist:', err);
  }
}

/** 从 IndexedDB 删除 */
async function deleteFromDb(skillName: string): Promise<void> {
  try {
    const db = getDb();
    await db.autoSkills.delete(skillName);
  } catch (err) {
    console.error('[skill-registry] failed to delete from DB:', err);
  }
}

// ─── 内存操作 ───

function registerInMemory(skill: AutoSkillDefinition): void {
  skillsByName.set(skill.name, skill);

  let list = skillsByHostname.get(skill.hostname);
  if (!list) {
    list = [];
    skillsByHostname.set(skill.hostname, list);
  }

  // 替换同名 Skill
  const idx = list.findIndex(s => s.name === skill.name);
  if (idx >= 0) {
    list[idx] = skill;
  } else {
    list.push(skill);
  }
}

function removeFromMemory(skillName: string): void {
  const skill = skillsByName.get(skillName);
  if (!skill) return;

  skillsByName.delete(skillName);

  const list = skillsByHostname.get(skill.hostname);
  if (list) {
    const idx = list.findIndex(s => s.name === skillName);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) skillsByHostname.delete(skill.hostname);
  }
}

// ─── 公开 API ───

/** 初始化注册表（从 DB 加载） */
export async function initRegistry(): Promise<void> {
  await loadFromDb();
}

/**
 * 添加新生成的 Skill（批量）。
 * 已存在的同名 Skill 会被覆盖。
 */
export async function addSkills(skills: AutoSkillDefinition[]): Promise<void> {
  await loadFromDb();

  for (const skill of skills) {
    registerInMemory(skill);
  }

  await persistSkills(skills);
}

/**
 * 查询指定 hostname 的所有 Skill。
 */
export async function getSkillsByHostname(hostname: string): Promise<AutoSkillDefinition[]> {
  await loadFromDb();
  return skillsByHostname.get(hostname) ?? [];
}

/**
 * 查询所有 Skill。
 */
export async function getAllSkills(): Promise<AutoSkillDefinition[]> {
  await loadFromDb();
  return Array.from(skillsByName.values());
}

/**
 * 查询所有已启用的 Skill（展示给 Agent）。
 * 仅返回置信度达标且调用次数足够的 Skill，按有效置信度降序排序。
 */
export async function getEnabledSkills(): Promise<AutoSkillDefinition[]> {
  await loadFromDb();
  return Array.from(skillsByName.values())
    .filter((s) => {
      if (!s.enabled) return false;
      const confidence = getEffectiveConfidence(s);
      return confidence >= SKILL_MIN_CONFIDENCE;
    })
    .sort(sortByConfidenceDesc);
}

/**
 * 查找匹配指定 URL 和 intent 的 Skill。
 * @param includeDisabled 是否同时返回未启用的 Skill（默认 false，仅匹配已启用）
 * @returns 匹配的 Skill（按置信度降序），或 null
 */
export async function findMatchingSkill(
  url: string,
  intent?: string,
  includeDisabled: boolean = false,
): Promise<AutoSkillDefinition | null> {
  await loadFromDb();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname;
  const candidates = skillsByHostname.get(hostname) ?? [];

  if (candidates.length === 0) return null;

  // 先只在启用的 Skill 中匹配，避免禁用 Skill 因分数高而遮蔽启用 Skill
  const enabledMatch = findBestMatch(candidates, parsed, intent, s => s.enabled);
  if (enabledMatch) return enabledMatch;

  // includeDisabled=true 且未找到启用 Skill 时，才在禁用 Skill 中查找
  if (includeDisabled) {
    return findBestMatch(candidates, parsed, intent, s => !s.enabled);
  }

  return null;
}

/** 在符合条件的候选 Skill 中找出匹配分数最高者 */
function findBestMatch(
  candidates: AutoSkillDefinition[],
  url: URL,
  intent: string | undefined,
  predicate: (skill: AutoSkillDefinition) => boolean,
): AutoSkillDefinition | null {
  const scored = candidates
    .filter(predicate)
    .map((s) => {
      const score = computeMatchScore(s, url, intent);
      return { skill: s, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0].skill : null;
}

/**
 * 启用 Skill。
 */
export async function enableSkill(skillName: string): Promise<void> {
  const skill = skillsByName.get(skillName);
  if (!skill) return;

  skill.enabled = true;
  await persistSkill(skill);
}

/**
 * 禁用 Skill。
 */
export async function disableSkill(skillName: string): Promise<void> {
  const skill = skillsByName.get(skillName);
  if (!skill) return;

  skill.enabled = false;
  await persistSkill(skill);
}

/**
 * 删除 Skill。
 */
export async function deleteSkill(skillName: string): Promise<void> {
  removeFromMemory(skillName);
  await deleteFromDb(skillName);
}

/**
 * 更新 Skill 执行统计。
 * @param skillName Skill 名称
 * @param success 是否成功
 */
export async function updateSkillStats(skillName: string, success: boolean): Promise<void> {
  const skill = skillsByName.get(skillName);
  if (!skill) return;

  skill.stats.callCount++;
  if (success) {
    skill.stats.successCount++;
  } else {
    skill.stats.failureCount++;
  }
  skill.stats.lastCalledAt = Date.now();

  // 动态置信度更新（调用次数 >= 3 后启用）
  if (skill.stats.callCount >= SKILL_ENABLE_MIN_CALLS) {
    const successRate = skill.stats.successCount / skill.stats.callCount;
    skill.stats.dynamicConfidence = Math.min(
      skill.initialConfidence * CONFIDENCE_HISTORY_WEIGHT + successRate * CONFIDENCE_RECENT_WEIGHT,
      CONFIDENCE_MAX,
    );
  }

  await persistSkill(skill);
}

// ─── 辅助函数 ───

/** 获取 Skill 的有效置信度（动态 > 初始） */
export function getEffectiveConfidence(skill: AutoSkillDefinition): number {
  if (skill.stats.callCount >= SKILL_ENABLE_MIN_CALLS) {
    return skill.stats.dynamicConfidence;
  }
  return skill.initialConfidence;
}

/** 按有效置信度降序排序 */
function sortByConfidenceDesc(a: AutoSkillDefinition, b: AutoSkillDefinition): number {
  return getEffectiveConfidence(b) - getEffectiveConfidence(a);
}

/**
 * 查询指定 hostname 下已启用且有效置信度达标的 Skill。
 * 用于 Agent system prompt 注入，按有效置信度降序返回。
 */
export async function getEnabledSkillsForHostname(
  hostname: string,
  minConfidence: number = SKILL_MIN_CONFIDENCE,
): Promise<AutoSkillDefinition[]> {
  await loadFromDb();
  const skills = skillsByHostname.get(hostname) ?? [];
  return skills
    .filter((s) => s.enabled && getEffectiveConfidence(s) >= minConfidence)
    .sort(sortByConfidenceDesc);
}

/** 计算匹配评分 */
function computeMatchScore(skill: AutoSkillDefinition, url: URL, intent?: string): number {
  // pathname 必须匹配（将占位符转为通配符比较）
  const skillPath = skill.pathname
    .replace(/\{id\}/g, '[^/]+')
    .replace(/\{uuid\}/g, '[^/]+')
    .replace(/\{hash\}/g, '[^/]+');

  const pathRe = new RegExp(`^${skillPath}$`);
  if (!pathRe.test(url.pathname)) return 0;

  let score = 0.5;

  // 有 query 参数且是 GET 加分（通过 pathname 中是否包含 query 标记判断）
  if (skill.method === 'GET') {
    score += 0.1;
  }

  // intent 关键词匹配加分
  if (intent) {
    const lowerIntent = intent.toLowerCase();
    const desc = skill.description.toLowerCase();
    if (desc.includes(lowerIntent) || lowerIntent.includes(skill.pathname.toLowerCase())) {
      score += 0.1;
    }
  }

  // 置信度加权
  score += getEffectiveConfidence(skill) * 0.2;

  return score;
}
