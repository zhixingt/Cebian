/**
 * Smart Interact 工具 — 封装 interact，优先走 API 路径，失败回退 DOM。
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { executeApiFirst, NoMatchError } from '@/lib/capture/api-executor';
import { interactTool } from './interact';

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
  selector: Type.Optional(Type.String({ description: 'CSS 选择器（DOM 回退时使用）' })),
  text: Type.Optional(Type.String({ description: '输入文本（DOM 回退时使用）' })),
});

export const smartInteractTool: AgentTool<typeof smartInteractSchema> = {
  name: 'smart_interact',
  label: 'Smart Interact',
  description: 'Interact with page. api_submit/api_fill_form try API-first, fall back to DOM.',
  parameters: smartInteractSchema,
  execute: async (_toolCallId, params) => {
    const { tabId, action, url, intent, data, selector, text } = params;

    if ((action === 'api_submit' || action === 'api_fill_form') && url) {
      try {
        const method = action === 'api_submit' ? 'POST' : 'GET';
        const result = await executeApiFirst(url, method, intent, data);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              path: 'api',
              response: result.data,
              latency_ms: result.latencyMs,
              skill_id: result.skillName,
              confidence: result.confidence,
            }, null, 2),
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
                text: `[fallback: ${err.message}]\n\n${fallback.content[0].text}`,
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
