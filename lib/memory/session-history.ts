// ─── 会话摘要 CRUD ───
//
// 从 db.sessions 读取会话，生成简单摘要（标题 + 首条用户消息前 200 字 +
// 末条助手消息前 200 字），提取关键词，写入 db.sessionSummary。
// 见 openspec/changes/2026-06-18-layered-memory-system/design.md。

import { getDb } from '../db';
import type { SessionSummaryRecord } from './types';
import { extractKeywords } from './retrieval';

/** 首条/末条消息截取长度 */
const MESSAGE_EXCERPT_LEN = 200;

/**
 * 从消息数组中提取首条用户消息的纯文本。
 */
function firstUserMessageText(messages: readonly { role?: string; content?: unknown }[]): string {
  const msg = messages.find((m) => m.role === 'user');
  if (!msg) return '';
  return contentToText(msg.content);
}

/**
 * 从消息数组中提取末条助手消息的纯文本。
 */
function lastAssistantMessageText(messages: readonly { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') return contentToText(m.content);
  }
  return '';
}

/**
 * 将消息 content（string 或 content block 数组）转为纯文本。
 */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text: unknown }).text);
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * 保存会话摘要：从 db.sessions 读取会话，生成摘要，提取关键词，写入 db.sessionSummary。
 * 去重：同一会话只保留一条摘要（先删除旧摘要再添加新摘要）。
 * @returns 新摘要记录的 id
 */
export async function saveSessionSummary(sessionId: string): Promise<string> {
  const db = getDb();
  const session = await db.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // 去重：先删除该会话的旧摘要，再添加新摘要
  await deleteSessionSummaryBySessionId(sessionId);

  const firstUser = firstUserMessageText(session.messages).slice(0, MESSAGE_EXCERPT_LEN);
  const lastAssistant = lastAssistantMessageText(session.messages).slice(0, MESSAGE_EXCERPT_LEN);

  const summaryParts: string[] = [];
  if (firstUser) summaryParts.push(`用户: ${firstUser}`);
  if (lastAssistant) summaryParts.push(`助手: ${lastAssistant}`);
  const summary = summaryParts.join('\n');

  // 关键词从标题 + 摘要文本提取
  const keywordSource = `${session.title} ${summary}`;
  const keywords = extractKeywords(keywordSource);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const record: SessionSummaryRecord = {
    id,
    sessionId,
    title: session.title,
    summary,
    keywords,
    createdAt,
  };
  await db.sessionSummary.add(record);
  return id;
}

/**
 * 读取单条会话摘要。
 */
export async function getSessionSummary(
  id: string,
): Promise<SessionSummaryRecord | undefined> {
  return getDb().sessionSummary.get(id);
}

/**
 * 列出全部会话摘要，按 createdAt 降序（最新在前）。
 */
export async function listSessionSummaries(): Promise<SessionSummaryRecord[]> {
  const all = await getDb().sessionSummary.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 删除单条会话摘要。
 */
export async function deleteSessionSummary(id: string): Promise<void> {
  await getDb().sessionSummary.delete(id);
}

/**
 * 删除指定会话的所有摘要记录。
 */
export async function deleteSessionSummaryBySessionId(sessionId: string): Promise<void> {
  await getDb().sessionSummary.where('sessionId').equals(sessionId).delete();
}
