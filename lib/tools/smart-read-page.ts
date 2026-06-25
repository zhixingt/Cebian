/**
 * Smart Read Page 工具 — 封装 read_page，优先走 API 路径，失败回退 DOM。
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { executeApiFirst } from '@/lib/capture/api-executor';
import { findMatchingSkill } from '@/lib/capture/skill-registry';
import { canAutoInvokeSkill } from '@/lib/capture/api-policy';
import { readPageTool } from './read-page';

const smartReadPageSchema = Type.Object({
  tabId: Type.Integer({ description: '目标标签页 ID' }),
  mode: Type.Optional(Type.Union([
    Type.Literal('markdown'),
    Type.Literal('json'),
    Type.Literal('text'),
  ], { description: '读取模式：markdown（默认）| json（API优先）| text' })),
  url: Type.Optional(Type.String({ description: '当 mode=json 时，目标 API URL' })),
  intent: Type.Optional(Type.String({ description: '操作意图描述，用于 API Skill 匹配' })),
  method: Type.Optional(Type.Literal('GET', { description: 'HTTP 方法：仅支持 GET（只读）' })),
});

export const smartReadPageTool: AgentTool<typeof smartReadPageSchema> = {
  name: 'smart_read_page',
  label: 'Smart Read Page',
  description: 'Read page content. When mode=json, tries API-first (auto-discovered), falls back to DOM.',
  parameters: smartReadPageSchema,
  execute: async (_toolCallId, params) => {
    const { tabId, mode, url, intent, method } = params;

    async function fallbackToDom(reason: string): Promise<AgentToolResult<unknown>> {
      const fallback = await readPageTool.execute(_toolCallId, { tabId, mode: 'markdown' });
      if (fallback.content[0]?.type === 'text') {
        return {
          ...fallback,
          content: [{
            type: 'text' as const,
            text: `[path: dom, fallback reason: ${reason}]\n\n${fallback.content[0].text}`,
          }],
        };
      }
      return fallback;
    }

    if (mode === 'json' && url) {
      try {
        // 在调用 API 前先检查自动调用策略：未匹配或策略拒绝时直接回退 DOM
        const skill = await findMatchingSkill(url, intent);
        if (!skill) {
          return await fallbackToDom(`No matching API skill for ${method ?? 'GET'} ${url}`);
        }

        const policy = canAutoInvokeSkill(skill);
        if (!policy.allowed) {
          return await fallbackToDom(policy.reason);
        }

        const result = await executeApiFirst(url, method, intent, undefined, skill);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              path: 'api',
              data: result.data,
              latency_ms: result.latencyMs,
              skill_id: result.skillName,
              confidence: result.confidence,
              method: result.method,
            }, null, 2),
          }],
          details: {},
        } satisfies AgentToolResult<unknown>;
      } catch (err) {
        // API 路径任何异常都透明回退到 DOM，用户感知为一次工具调用
        const reason = err instanceof Error ? err.message : String(err);
        return await fallbackToDom(reason);
      }
    }

    // 非 json 模式直接走 DOM（mode 类型兼容：json/text → 映射到 read_page 的 text/markdown）
    const domMode = mode === 'text' ? 'text' : 'markdown' as 'text' | 'markdown';
    return readPageTool.execute(_toolCallId, { tabId, mode: domMode });
  },
};
