/**
 * Smart Read Page 工具 — 封装 read_page，优先走 API 路径，失败回退 DOM。
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { executeApiFirst, NoMatchError } from '@/lib/capture/api-executor';
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
});

export const smartReadPageTool: AgentTool<typeof smartReadPageSchema> = {
  name: 'smart_read_page',
  label: 'Smart Read Page',
  description: 'Read page content. When mode=json, tries API-first (auto-discovered), falls back to DOM.',
  parameters: smartReadPageSchema,
  execute: async (_toolCallId, params) => {
    const { tabId, mode, url, intent } = params;

    if (mode === 'json' && url) {
      try {
        const result = await executeApiFirst(url, 'GET', intent);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              path: 'api',
              data: result.data,
              latency_ms: result.latencyMs,
              skill_id: result.skillName,
              confidence: result.confidence,
            }, null, 2),
          }],
          details: {},
        } satisfies AgentToolResult<unknown>;
      } catch (err) {
        if (err instanceof NoMatchError) {
          const fallback = await readPageTool.execute(_toolCallId, { tabId, mode: 'markdown' });
          if (fallback.content[0]?.type === 'text') {
            return {
              ...fallback,
              content: [{
                type: 'text' as const,
                text: `[fallback: ${err.message}]\n\n${fallback.content[0].text}`,
              }],
            };
          }
          return fallback;
        }
        throw err;
      }
    }

    // 非 json 模式直接走 DOM（mode 类型兼容：json/text → 映射到 read_page 的 text/markdown）
    const domMode = mode === 'text' ? 'text' : 'markdown' as 'text' | 'markdown';
    return readPageTool.execute(_toolCallId, { tabId, mode: domMode });
  },
};
