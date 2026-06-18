// ─── 记忆检索 ───
//
// 关键词匹配（0.7 权重）+ 时间衰减（0.3 权重，30 天半衰期）。
// 无查询关键词时 keywordMatchScore = 0.5（中性）。
// 见 openspec/changes/2026-06-18-layered-memory-system/design.md。

import { getDb } from '../db';
import type {
  AgentMemoryRecord,
  RetrievedMemories,
  SessionSummaryRecord,
  UserProfileRecord,
} from './types';

/** 默认 top-K */
const DEFAULT_TOP_K = 5;

/** 时间衰减半衰期（天） */
const TIME_DECAY_HALF_LIFE_DAYS = 30;

/** 关键词权重 */
const KEYWORD_WEIGHT = 0.7;
/** 时间衰减权重 */
const TIME_WEIGHT = 0.3;

/**
 * 中英文停用词表。分词后过滤这些词。
 */
const STOP_WORDS = new Set<string>([
  // 中文停用词
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这',
  // 英文停用词
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'but',
]);

/**
 * 简单分词：按空格/标点分割，过滤停用词与过短词，取 top-5。
 *
 * 中文按单字切分（粗粒度，MVP 可接受）；英文按非字母数字字符切分。
 * 频次统计后取 top-5。
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];

  // 用非字母数字（含中文字符以外的标点空格）切分；中文字符保留为连续段
  // 然后对连续中文段按单字切分。
  const tokens: string[] = [];
  // 先按非字母数字非中文字符切分
  const segments = text.split(/[^\p{L}\p{N}]+/u);
  for (const seg of segments) {
    if (!seg) continue;
    // 提取中文段与英文/数字段
    const subSegments = seg.match(/[\u4e00-\u9fa5]+|[A-Za-z0-9]+/g) ?? [];
    for (const sub of subSegments) {
      if (/^[\u4e00-\u9fa5]+$/.test(sub)) {
        // 中文：按单字切分
        for (const ch of sub) {
          tokens.push(ch);
        }
      } else {
        // 英文/数字：整体作为一个 token（小写化）
        tokens.push(sub.toLowerCase());
      }
    }
  }

  // 过滤停用词与长度 < 1 的 token
  const filtered = tokens.filter((t) => t.length >= 1 && !STOP_WORDS.has(t));

  // 频次统计
  const freq = new Map<string, number>();
  for (const t of filtered) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  // 按频次降序，相同频次按字典序，取 top-5
  const sorted = Array.from(freq.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return sorted.slice(0, 5).map(([word]) => word);
}

/**
 * 计算关键词匹配 + 时间衰减综合分数。
 *
 * score = keywordMatchScore * 0.7 + timeDecayScore * 0.3
 * - keywordMatchScore = (匹配关键词数 / 总关键词数) * 1.0
 *   - 如果查询无关键词，keywordMatchScore = 0.5（中性）
 *   - 如果记录无关键词，keywordMatchScore = 0
 * - timeDecayScore = exp(-daysSinceCreated / 30)
 */
export function scoreByKeywordAndTime(
  record: { keywords: string[]; createdAt: number },
  queryKeywords: string[],
): number {
  // 关键词匹配
  let keywordMatchScore: number;
  if (queryKeywords.length === 0) {
    keywordMatchScore = 0.5;
  } else if (record.keywords.length === 0) {
    keywordMatchScore = 0;
  } else {
    const recordSet = new Set(record.keywords.map((k) => k.toLowerCase()));
    let matched = 0;
    for (const q of queryKeywords) {
      if (recordSet.has(q.toLowerCase())) matched++;
    }
    keywordMatchScore = matched / queryKeywords.length;
  }

  // 时间衰减
  const daysSinceCreated = (Date.now() - record.createdAt) / (1000 * 60 * 60 * 24);
  const timeDecayScore = Math.exp(-daysSinceCreated / TIME_DECAY_HALF_LIFE_DAYS);

  return keywordMatchScore * KEYWORD_WEIGHT + timeDecayScore * TIME_WEIGHT;
}

/**
 * 检索相关记忆：用户画像全量 + 会话摘要 top-K + Agent 记忆 top-K。
 */
export async function retrieveRelevantMemories(
  query: string,
  options?: { topK?: number },
): Promise<RetrievedMemories> {
  const topK = options?.topK ?? DEFAULT_TOP_K;
  const queryKeywords = extractKeywords(query);

  // 用户画像：全量，按 key 升序
  const profileAll = await getDb().userProfile.toArray();
  const profile: UserProfileRecord[] = profileAll.sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  // 会话摘要：按 score 降序取 top-K
  const summariesAll = await getDb().sessionSummary.toArray();
  const summariesWithScore = summariesAll.map((s) => ({
    record: s,
    score: scoreByKeywordAndTime(s, queryKeywords),
  }));
  summariesWithScore.sort((a, b) => b.score - a.score);
  const summaries: SessionSummaryRecord[] = summariesWithScore
    .slice(0, topK)
    .map((x) => x.record);

  // Agent 记忆：按 score 降序取 top-K
  const memoriesAll = await getDb().agentMemory.toArray();
  const memoriesWithScore = memoriesAll.map((m) => ({
    record: m,
    score: scoreByKeywordAndTime(m, queryKeywords),
  }));
  memoriesWithScore.sort((a, b) => b.score - a.score);
  const memories: AgentMemoryRecord[] = memoriesWithScore
    .slice(0, topK)
    .map((x) => x.record);

  return { profile, summaries, memories };
}
