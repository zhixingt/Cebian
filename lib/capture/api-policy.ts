/**
 * API Skill 自动调用策略。
 *
 * 决定一个自动发现的 API Skill 是否可以在无需人工确认的情况下被 Agent 调用。
 * 仅允许高置信度的只读（GET）接口，避免误触发写操作。
 */

import type { AutoSkillDefinition } from './types';
import { getEffectiveConfidence } from './skill-registry';

/** 策略判断结果 */
export interface ApiPolicyResult {
  /** 是否允许自动调用 */
  allowed: boolean;
  /** 决策原因（允许或拒绝） */
  reason: string;
}

/** 写操作关键词：命中任一关键词即视为潜在写操作（使用词边界避免误杀子串） */
const WRITE_KEYWORDS = /\b(submit|delete|remove|update|create|pay|order|purchase|post|write|send|cancel|approve|reject)\b/i;

/** 自动调用所需最低有效置信度 */
const AUTO_INVOKE_MIN_CONFIDENCE = 0.8;

/**
 * 判断指定 API Skill 是否可以被自动调用。
 *
 * 规则：
 * 1. Skill 必须处于启用状态。
 * 2. 仅允许 HTTP GET 方法。
 * 3. 有效置信度必须 >= AUTO_INVOKE_MIN_CONFIDENCE。
 * 4. pathname 与 description 中不得包含写操作关键词。
 */
export function canAutoInvokeSkill(skill: AutoSkillDefinition): ApiPolicyResult {
  if (!skill.enabled) {
    return { allowed: false, reason: 'skill is disabled' };
  }

  if (!skill.method || skill.method.toUpperCase() !== 'GET') {
    return { allowed: false, reason: `Auto-invoke only allowed for GET skills, got ${skill.method}` };
  }

  const confidence = getEffectiveConfidence(skill);
  if (confidence < AUTO_INVOKE_MIN_CONFIDENCE) {
    return {
      allowed: false,
      reason: `Confidence ${confidence.toFixed(2)} is below threshold ${AUTO_INVOKE_MIN_CONFIDENCE}`,
    };
  }

  const textToCheck = `${skill.pathname ?? ''} ${skill.description ?? ''}`.toLowerCase();
  const match = WRITE_KEYWORDS.exec(textToCheck);
  if (match) {
    return {
      allowed: false,
      reason: `Write-operation keyword "${match[0]}" found in pathname or description`,
    };
  }

  return { allowed: true, reason: 'Read-only GET skill with sufficient confidence' };
}
