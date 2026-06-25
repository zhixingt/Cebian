/**
 * Smart Interact 工具 — 封装 interact，优先走 API 路径，失败回退 DOM。
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { executeApiFirst, NoMatchError } from '@/lib/capture/api-executor';
import { findMatchingSkill } from '@/lib/capture/skill-registry';
import { canAutoInvokeSkill } from '@/lib/capture/api-policy';
import { interactTool } from './interact';
import type { AutoSkillDefinition } from '@/lib/capture/types';

const smartInteractSchema = Type.Object({
  tabId: Type.Integer({ description: '目标标签页 ID' }),
  action: Type.Union([
    Type.Literal('click'),
    Type.Literal('type'),
    Type.Literal('select'),
    Type.Literal('scroll'),
    Type.Literal('keypress'),
    Type.Literal('api_submit'),
    Type.Literal('api_fill_form'),
  ], { description: '操作类型。api_submit/api_fill_form 走 API 优先路径' }),
  url: Type.Optional(Type.String({ description: '当 action=api_* 时，目标 API URL' })),
  intent: Type.Optional(Type.String({ description: '操作意图描述' })),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'API 请求体数据' })),
  confirmed: Type.Optional(Type.Boolean({ description: 'Set to true after user explicitly approved a write-capable API call.' })),
  selector: Type.Optional(Type.String({ description: 'CSS 选择器（DOM 回退时使用）' })),
  text: Type.Optional(Type.String({ description: '输入文本（DOM 回退时使用）' })),
});

function formatApiPrefix(skill: AutoSkillDefinition, result: { latencyMs: number; confidence: number }): string {
  const confidencePct = Math.round(result.confidence * 100);
  return `[API ${skill.method} ${skill.pathname}] latency=${result.latencyMs}ms confidence=${confidencePct}%`;
}

export const smartInteractTool: AgentTool<typeof smartInteractSchema> = {
  name: 'smart_interact',
  label: 'Smart Interact',
  description: 'Interact with page. api_submit/api_fill_form try API-first, fall back to DOM.',
  parameters: smartInteractSchema,
  execute: async (_toolCallId, params) => {
    const { tabId, action, url, intent, data, confirmed, selector, text } = params;

    if ((action === 'api_submit' || action === 'api_fill_form') && url) {
      try {
        // 查找匹配的 Skill，同时检查未启用的 Skill，以便给出明确错误
        const skill = await findMatchingSkill(url, intent, true);
        if (!skill) {
          const fallbackMethod = action === 'api_submit' ? 'POST' : 'GET';
          throw new NoMatchError(`No matching API skill for ${fallbackMethod} ${url}`);
        }

        // Skill 未启用时直接拒绝，不进入确认流程
        if (!skill.enabled) {
          return {
            content: [{
              type: 'text' as const,
              text: `API skill is disabled: ${skill.method} ${skill.pathname}. Enable it before use.`,
            }],
            details: {},
          } satisfies AgentToolResult<unknown>;
        }

        const method = action === 'api_submit' ? 'POST' : 'GET';

        // 判断是否可以自动调用；不允许自动调用且未获得用户确认时，请求确认
        // 使用 action 推导的实际执行方法进行策略检查，避免 skill.method 与真实请求方法不一致导致错误放行
        const policy = canAutoInvokeSkill(skill, method);
        if (!policy.allowed && confirmed !== true) {
          return {
            content: [{
              type: 'text' as const,
              text: `This API call requires user confirmation before execution: ${skill.method} ${skill.pathname}. Risk reason: ${policy.reason}. Please ask the user for approval and call again with confirmed=true.`,
            }],
            details: {},
          } satisfies AgentToolResult<unknown>;
        }

        // 已确认或无需确认，执行 API 调用（传入已匹配的 Skill 避免重复查找）
        const result = await executeApiFirst(url, method, intent, data, skill);
        const prefix = formatApiPrefix(skill, result);
        const body = JSON.stringify({
          success: true,
          path: 'api',
          response: result.data,
          latency_ms: result.latencyMs,
          skill_id: result.skillName,
          confidence: result.confidence,
        }, null, 2);

        return {
          content: [{
            type: 'text' as const,
            text: `${prefix}\n\n${body}`,
          }],
          details: {},
        } satisfies AgentToolResult<unknown>;
      } catch (err) {
        if (err instanceof NoMatchError) {
          const fallbackAction = action === 'api_submit' ? 'click' : 'type';
          const fallback = await interactTool.execute(_toolCallId, {
            tabId,
            action: fallbackAction as 'click' | 'type',
            selector,
            text,
          });
          if (fallback.content[0]?.type === 'text') {
            return {
              ...fallback,
              content: [{
                type: 'text' as const,
                text: `[DOM fallback] reason: ${err.message}\n\n${fallback.content[0].text}`,
              }],
            };
          }
          return fallback;
        }
        throw err;
      }
    }

    return interactTool.execute(_toolCallId, { tabId, action: action as 'click' | 'type' | 'select' | 'scroll' | 'keypress', selector, text });
  },
};
