import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  extractKeywords,
  scoreByKeywordAndTime,
  retrieveRelevantMemories,
} from '@/lib/memory/retrieval';
import { setUserProfile } from '@/lib/memory/user-profile';
import { addAgentMemory } from '@/lib/memory/agent-memory';
import { saveSessionSummary } from '@/lib/memory/session-history';
import type { SessionRecord } from '@/lib/db';

async function seedSession(
  id: string,
  title: string,
  messages: { role: string; content: string; timestamp: number }[],
): Promise<void> {
  const now = Date.now();
  const session: SessionRecord = {
    id,
    title,
    model: 'test-model',
    provider: 'test',
    userInstructions: '',
    thinkingLevel: 'medium',
    messageCount: messages.length,
    createdAt: now,
    updatedAt: now,
    messages: messages as never,
  };
  await getDb().sessions.add(session);
}

describe('extractKeywords', () => {
  it('空字符串返回空数组', () => {
    expect(extractKeywords('')).toEqual([]);
  });

  it('英文按空格/标点分词，过滤停用词', () => {
    // 重复 quick/brown/fox 提高频次，确保进入 top-5
    const keywords = extractKeywords('the quick quick brown brown fox the lazy dog');
    expect(keywords).toContain('quick');
    expect(keywords).toContain('brown');
    expect(keywords).toContain('fox');
    expect(keywords).not.toContain('the');
    expect(keywords.length).toBeLessThanOrEqual(5);
  });

  it('中文按单字切分，过滤停用词', () => {
    // 重复"调""试"提高频次，确保进入 top-5；WXT 重复确保进入 top-5
    const keywords = extractKeywords('我正在调试调试 WXT WXT 构建问题');
    expect(keywords).not.toContain('我');
    expect(keywords).not.toContain('的');
    expect(keywords).toContain('调');
    expect(keywords).toContain('试');
    expect(keywords).toContain('wxt');
    expect(keywords.length).toBeLessThanOrEqual(5);
  });

  it('取 top-5', () => {
    // 重复词提高频次
    const text = 'apple apple apple banana banana cherry date elderberry fig grape';
    const keywords = extractKeywords(text);
    expect(keywords.length).toBeLessThanOrEqual(5);
    expect(keywords[0]).toBe('apple');
  });
});

describe('scoreByKeywordAndTime', () => {
  it('无查询关键词时 keywordMatchScore = 0.5（中性）', () => {
    const now = Date.now();
    const score = scoreByKeywordAndTime(
      { keywords: ['a', 'b'], createdAt: now },
      [],
    );
    // 0.5 * 0.7 + 1.0 * 0.3 = 0.65
    expect(score).toBeCloseTo(0.65, 5);
  });

  it('关键词全部匹配得满分', () => {
    const now = Date.now();
    const score = scoreByKeywordAndTime(
      { keywords: ['a', 'b'], createdAt: now },
      ['a', 'b'],
    );
    // 1.0 * 0.7 + 1.0 * 0.3 = 1.0
    expect(score).toBeCloseTo(1.0, 5);
  });

  it('关键词部分匹配', () => {
    const now = Date.now();
    const score = scoreByKeywordAndTime(
      { keywords: ['a', 'b'], createdAt: now },
      ['a', 'c'],
    );
    // 0.5 * 0.7 + 1.0 * 0.3 = 0.65
    expect(score).toBeCloseTo(0.65, 5);
  });

  it('记录无关键词时 keywordMatchScore = 0', () => {
    const now = Date.now();
    const score = scoreByKeywordAndTime(
      { keywords: [], createdAt: now },
      ['a'],
    );
    // 0 * 0.7 + 1.0 * 0.3 = 0.3
    expect(score).toBeCloseTo(0.3, 5);
  });

  it('时间衰减：30 天前 score 约为 0.5 * 0.3 + 0.5 * 0.7 = 0.5', () => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const score = scoreByKeywordAndTime(
      { keywords: ['a'], createdAt: thirtyDaysAgo },
      [],
    );
    // 0.5 * 0.7 + exp(-1) * 0.3 ≈ 0.35 + 0.1104 = 0.4604
    expect(score).toBeCloseTo(0.5 * 0.7 + Math.exp(-1) * 0.3, 3);
  });

  it('关键词大小写不敏感', () => {
    const now = Date.now();
    const score = scoreByKeywordAndTime(
      { keywords: ['TypeScript'], createdAt: now },
      ['typescript'],
    );
    expect(score).toBeCloseTo(1.0, 5);
  });
});

describe('retrieveRelevantMemories', () => {
  beforeEach(async () => {
    await getDb().userProfile.clear();
    await getDb().agentMemory.clear();
    await getDb().sessionSummary.clear();
    await getDb().sessions.clear();
  });

  it('返回 profile 全量 + summaries/memories top-K', async () => {
    await setUserProfile('language', 'TypeScript');
    await setUserProfile('editor', 'VSCode');

    await seedSession('s1', '调试 WXT', [
      { role: 'user', content: '调试 WXT 构建问题', timestamp: Date.now() },
      { role: 'assistant', content: '解决了', timestamp: Date.now() },
    ]);
    await saveSessionSummary('s1');

    await addAgentMemory({
      type: 'success',
      content: '使用 chrome.scripting 注入',
      keywords: ['chrome', 'scripting'],
      relevance: 0.8,
    });

    const result = await retrieveRelevantMemories('WXT 构建', { topK: 5 });
    expect(result.profile).toHaveLength(2);
    expect(result.summaries.length).toBeGreaterThan(0);
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it('topK 限制返回数量', async () => {
    for (let i = 0; i < 10; i++) {
      await addAgentMemory({
        type: 'pattern',
        content: `pattern-${i}`,
        keywords: [`kw${i}`],
        relevance: 0.5,
      });
    }
    const result = await retrieveRelevantMemories('test', { topK: 3 });
    expect(result.memories.length).toBeLessThanOrEqual(3);
  });

  it('空数据库返回空数组', async () => {
    const result = await retrieveRelevantMemories('anything');
    expect(result.profile).toEqual([]);
    expect(result.summaries).toEqual([]);
    expect(result.memories).toEqual([]);
  });

  it('profile 按 key 升序', async () => {
    await setUserProfile('zeta', '1');
    await setUserProfile('alpha', '2');
    const result = await retrieveRelevantMemories('test');
    expect(result.profile.map((p) => p.key)).toEqual(['alpha', 'zeta']);
  });
});
