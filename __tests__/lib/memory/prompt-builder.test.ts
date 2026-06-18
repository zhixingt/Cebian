import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  estimateTokens,
  formatUserProfile,
  formatSessionSummaries,
  formatAgentMemories,
  buildMemoryPrompt,
} from '@/lib/memory/prompt-builder';
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

describe('estimateTokens', () => {
  it('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('4 字符约等于 1 token（向上取整）', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});

describe('formatUserProfile', () => {
  it('空数组返回空字符串', () => {
    expect(formatUserProfile([])).toBe('');
  });

  it('格式化为 <user-profile> 块', () => {
    const result = formatUserProfile([
      { key: 'language', value: 'TypeScript', updatedAt: 0 },
      { key: 'editor', value: 'VSCode', updatedAt: 0 },
    ]);
    expect(result).toContain('<user-profile>');
    expect(result).toContain('</user-profile>');
    expect(result).toContain('language: TypeScript');
    expect(result).toContain('editor: VSCode');
  });
});

describe('formatSessionSummaries', () => {
  it('空数组返回空字符串', () => {
    expect(formatSessionSummaries([])).toBe('');
  });

  it('格式化为 <recent-context> 块，包含天数标签', () => {
    const now = Date.now();
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    const result = formatSessionSummaries([
      {
        id: '1',
        sessionId: 's1',
        title: '调试 WXT',
        summary: '解决了 content script 注入失败',
        keywords: [],
        createdAt: threeDaysAgo,
      },
    ]);
    expect(result).toContain('<recent-context>');
    expect(result).toContain('</recent-context>');
    expect(result).toContain('[3天前]');
    expect(result).toContain('调试 WXT');
  });

  it('今天的摘要显示 [今天]', () => {
    const now = Date.now();
    const result = formatSessionSummaries([
      {
        id: '1',
        sessionId: 's1',
        title: 'test',
        summary: 'test',
        keywords: [],
        createdAt: now,
      },
    ]);
    expect(result).toContain('[今天]');
  });
});

describe('formatAgentMemories', () => {
  it('空数组返回空字符串', () => {
    expect(formatAgentMemories([])).toBe('');
  });

  it('格式化为 <agent-memory> 块，包含类型标签', () => {
    const result = formatAgentMemories([
      {
        id: '1',
        type: 'success',
        content: '使用 chrome.scripting 注入',
        keywords: [],
        createdAt: 0,
        relevance: 0.8,
      },
      {
        id: '2',
        type: 'failure',
        content: '直接 eval 在 MV3 不可用',
        keywords: [],
        createdAt: 0,
        relevance: 0.6,
      },
      {
        id: '3',
        type: 'pattern',
        content: '使用 interact sequence 批量操作',
        keywords: [],
        createdAt: 0,
        relevance: 0.7,
      },
    ]);
    expect(result).toContain('<agent-memory>');
    expect(result).toContain('</agent-memory>');
    expect(result).toContain('[成功]');
    expect(result).toContain('[失败]');
    expect(result).toContain('[模式]');
  });
});

describe('buildMemoryPrompt', () => {
  beforeEach(async () => {
    await getDb().userProfile.clear();
    await getDb().agentMemory.clear();
    await getDb().sessionSummary.clear();
    await getDb().sessions.clear();
  });

  it('空数据库返回空字符串', async () => {
    const result = await buildMemoryPrompt('test');
    expect(result).toBe('');
  });

  it('只有 profile 时只输出 <user-profile> 块', async () => {
    await setUserProfile('language', 'TypeScript');
    const result = await buildMemoryPrompt('test');
    expect(result).toContain('<user-profile>');
    expect(result).not.toContain('<recent-context>');
    expect(result).not.toContain('<agent-memory>');
  });

  it('三种记忆都存在时全部输出', async () => {
    await setUserProfile('language', 'TypeScript');
    await seedSession('s1', '测试会话', [
      { role: 'user', content: '用户消息', timestamp: Date.now() },
      { role: 'assistant', content: '助手消息', timestamp: Date.now() },
    ]);
    await saveSessionSummary('s1');
    await addAgentMemory({
      type: 'success',
      content: '成功经验',
      keywords: ['test'],
      relevance: 0.8,
    });

    const result = await buildMemoryPrompt('test');
    expect(result).toContain('<user-profile>');
    expect(result).toContain('<recent-context>');
    expect(result).toContain('<agent-memory>');
  });

  it('token 限制截断：极小 tokenLimit 时只保留 profile', async () => {
    await setUserProfile('language', 'TS');
    await seedSession('s1', '测试会话', [
      { role: 'user', content: '用户消息', timestamp: Date.now() },
      { role: 'assistant', content: '助手消息', timestamp: Date.now() },
    ]);
    await saveSessionSummary('s1');
    await addAgentMemory({
      type: 'success',
      content: '成功经验',
      keywords: ['test'],
      relevance: 0.8,
    });

    // 给一个能容纳 profile 但容纳不下其他块的极小限制
    const profileBlock = formatUserProfile([
      { key: 'language', value: 'TS', updatedAt: 0 },
    ]);
    const profileTokens = estimateTokens(profileBlock);
    const result = await buildMemoryPrompt('test', {
      tokenLimit: profileTokens + 1,
    });
    expect(result).toContain('<user-profile>');
    // 极小限制下不应同时包含其他块
    expect(result).not.toContain('<recent-context>');
    expect(result).not.toContain('<agent-memory>');
  });

  it('token 限制为 0 时返回空字符串', async () => {
    await setUserProfile('language', 'TypeScript');
    const result = await buildMemoryPrompt('test', { tokenLimit: 0 });
    expect(result).toBe('');
  });
});
