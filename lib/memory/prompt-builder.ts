// ─── Prompt 注入 ───
//
// 将检索到的记忆格式化为结构化文本块，追加到 system prompt。
// 总记忆注入 ≤500 tokens（按字符数/4 估算）。超限时按 score 降序截断。
// 见 openspec/changes/2026-06-18-layered-memory-system/design.md。

import { retrieveRelevantMemories, scoreByKeywordAndTime, extractKeywords } from './retrieval';
import type {
  AgentMemoryRecord,
  SessionSummaryRecord,
  UserProfileRecord,
} from './types';

/** 默认 token 上限 */
const DEFAULT_TOKEN_LIMIT = 500;

/** 4 字符约等于 1 token */
const CHARS_PER_TOKEN = 4;

/**
 * 简单 token 估算：字符数 / 4。
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * 格式化用户画像为 `<user-profile>` 块。
 */
export function formatUserProfile(profile: UserProfileRecord[]): string {
  if (profile.length === 0) return '';
  const lines = profile.map((p) => `${p.key}: ${p.value}`);
  return `<user-profile>\n${lines.join('\n')}\n</user-profile>`;
}

/**
 * 格式化会话摘要为 `<recent-context>` 块。
 * 每条格式：`[N天前] 标题 — 摘要`
 */
export function formatSessionSummaries(summaries: SessionSummaryRecord[]): string {
  if (summaries.length === 0) return '';
  const lines = summaries.map((s) => {
    const daysAgo = Math.max(
      0,
      Math.floor((Date.now() - s.createdAt) / (1000 * 60 * 60 * 24)),
    );
    const daysLabel = daysAgo === 0 ? '今天' : `${daysAgo}天前`;
    const summaryText = s.summary.replace(/\n/g, ' ').slice(0, 100);
    return `[${daysLabel}] ${s.title} — ${summaryText}`;
  });
  return `<recent-context>\n${lines.join('\n')}\n</recent-context>`;
}

/**
 * 格式化 Agent 记忆为 `<agent-memory>` 块。
 * 每条格式：`[类型] 内容`
 */
export function formatAgentMemories(memories: AgentMemoryRecord[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => {
    const label = m.type === 'success' ? '成功' : m.type === 'failure' ? '失败' : '模式';
    return `[${label}] ${m.content}`;
  });
  return `<agent-memory>\n${lines.join('\n')}\n</agent-memory>`;
}

/**
 * 检索记忆并格式化为 ≤ tokenLimit tokens 的文本块。
 *
 * 截断策略：用户画像优先（全量），然后会话摘要（按 score 降序），最后 Agent 记忆（按 score 降序）。
 * 超限时停止添加。
 *
 * @param query 检索查询（通常是 sessionId 或用户最近消息）
 * @param options.tokenLimit 默认 500
 */
export async function buildMemoryPrompt(
  query: string,
  options?: { tokenLimit?: number },
): Promise<string> {
  const tokenLimit = options?.tokenLimit ?? DEFAULT_TOKEN_LIMIT;
  const queryKeywords = extractKeywords(query);

  const { profile, summaries, memories } = await retrieveRelevantMemories(query, {
    topK: 5,
  });

  // 用户画像优先（全量）
  const profileBlock = formatUserProfile(profile);
  const blocks: string[] = [];
  let usedTokens = 0;

  if (profileBlock) {
    const tokens = estimateTokens(profileBlock);
    if (usedTokens + tokens <= tokenLimit) {
      blocks.push(profileBlock);
      usedTokens += tokens;
    }
  }

  // 会话摘要按 score 降序
  const summariesWithScore = summaries
    .map((s) => ({ record: s, score: scoreByKeywordAndTime(s, queryKeywords) }))
    .sort((a, b) => b.score - a.score);

  // 逐条添加，超限时停止
  const selectedSummaries: SessionSummaryRecord[] = [];
  for (const { record } of summariesWithScore) {
    const candidate = [...selectedSummaries, record];
    const block = formatSessionSummaries(candidate);
    const tokens = estimateTokens(block);
    if (usedTokens + tokens <= tokenLimit) {
      selectedSummaries.push(record);
    } else {
      break;
    }
  }
  if (selectedSummaries.length > 0) {
    const block = formatSessionSummaries(selectedSummaries);
    blocks.push(block);
    usedTokens += estimateTokens(block);
  }

  // Agent 记忆按 score 降序
  const memoriesWithScore = memories
    .map((m) => ({ record: m, score: scoreByKeywordAndTime(m, queryKeywords) }))
    .sort((a, b) => b.score - a.score);

  const selectedMemories: AgentMemoryRecord[] = [];
  for (const { record } of memoriesWithScore) {
    const candidate = [...selectedMemories, record];
    const block = formatAgentMemories(candidate);
    const tokens = estimateTokens(block);
    if (usedTokens + tokens <= tokenLimit) {
      selectedMemories.push(record);
    } else {
      break;
    }
  }
  if (selectedMemories.length > 0) {
    blocks.push(formatAgentMemories(selectedMemories));
  }

  return blocks.join('\n\n');
}
