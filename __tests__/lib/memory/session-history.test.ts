import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import type { SessionRecord } from '@/lib/db';
import {
  saveSessionSummary,
  getSessionSummary,
  listSessionSummaries,
  deleteSessionSummary,
  deleteSessionSummaryBySessionId,
} from '@/lib/memory/session-history';

async function seedSession(
  id: string,
  overrides: Partial<SessionRecord> = {},
): Promise<SessionRecord> {
  const now = Date.now();
  const session: SessionRecord = {
    id,
    title: '测试会话',
    model: 'test-model',
    provider: 'test',
    userInstructions: '',
    thinkingLevel: 'medium',
    messageCount: 2,
    createdAt: now,
    updatedAt: now,
    messages: [
      { role: 'user', content: '帮我调试 WXT 构建问题', timestamp: now } as never,
      { role: 'assistant', content: '已解决 content script 注入失败', timestamp: now } as never,
    ],
    ...overrides,
  };
  await getDb().sessions.add(session);
  return session;
}

describe('session-history CRUD', () => {
  beforeEach(async () => {
    await getDb().sessionSummary.clear();
    await getDb().sessions.clear();
  });

  it('saveSessionSummary 从 session 生成摘要', async () => {
    await seedSession('sess-1');
    const id = await saveSessionSummary('sess-1');
    expect(id).toBeTruthy();
    const record = await getSessionSummary(id);
    expect(record).toBeDefined();
    expect(record?.sessionId).toBe('sess-1');
    expect(record?.title).toBe('测试会话');
    expect(record?.summary).toContain('帮我调试 WXT 构建问题');
    expect(record?.summary).toContain('已解决 content script 注入失败');
    expect(record?.keywords.length).toBeGreaterThan(0);
    expect(record?.createdAt).toBeGreaterThan(0);
  });

  it('saveSessionSummary 不存在的 session 抛错', async () => {
    await expect(saveSessionSummary('nonexistent')).rejects.toThrow(
      /Session not found/,
    );
  });

  it('saveSessionSummary 截取首条用户消息前 200 字', async () => {
    const longText = 'A'.repeat(500);
    await seedSession('sess-long', {
      messages: [
        { role: 'user', content: longText, timestamp: Date.now() } as never,
      ],
      messageCount: 1,
    });
    const id = await saveSessionSummary('sess-long');
    const record = await getSessionSummary(id);
    expect(record?.summary).toContain('A'.repeat(200));
    // 不应包含第 201 个字符之后的内容
    expect(record?.summary.length).toBeLessThan(longText.length + 20);
  });

  it('saveSessionSummary 无消息时摘要为空字符串', async () => {
    await seedSession('sess-empty', { messages: [], messageCount: 0 });
    const id = await saveSessionSummary('sess-empty');
    const record = await getSessionSummary(id);
    expect(record?.summary).toBe('');
  });

  it('listSessionSummaries 按 createdAt 降序', async () => {
    await seedSession('s1');
    await seedSession('s2');
    const id1 = await saveSessionSummary('s1');
    await new Promise((r) => setTimeout(r, 5));
    const id2 = await saveSessionSummary('s2');
    const list = await listSessionSummaries();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(id2);
    expect(list[1].id).toBe(id1);
  });

  it('deleteSessionSummary 删除指定记录', async () => {
    await seedSession('s1');
    const id = await saveSessionSummary('s1');
    await deleteSessionSummary(id);
    expect(await getSessionSummary(id)).toBeUndefined();
  });

  it('deleteSessionSummaryBySessionId 删除该会话所有摘要', async () => {
    await seedSession('s1');
    await saveSessionSummary('s1');
    await saveSessionSummary('s1');
    await seedSession('s2');
    await saveSessionSummary('s2');
    expect(await listSessionSummaries()).toHaveLength(3);
    await deleteSessionSummaryBySessionId('s1');
    const remaining = await listSessionSummaries();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionId).toBe('s2');
  });
});
