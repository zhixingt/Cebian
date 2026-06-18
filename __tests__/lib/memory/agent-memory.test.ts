import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  addAgentMemory,
  getAgentMemory,
  listAgentMemory,
  deleteAgentMemory,
} from '@/lib/memory/agent-memory';

describe('agent-memory CRUD', () => {
  beforeEach(async () => {
    await getDb().agentMemory.clear();
  });

  it('addAgentMemory 生成 UUID 与 createdAt', async () => {
    const id = await addAgentMemory({
      type: 'success',
      content: '使用 chrome.scripting.executeScript 注入 content script',
      keywords: ['chrome', 'scripting', 'inject'],
      relevance: 0.8,
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    const record = await getAgentMemory(id);
    expect(record).toBeDefined();
    expect(record?.id).toBe(id);
    expect(record?.createdAt).toBeGreaterThan(0);
    expect(record?.type).toBe('success');
  });

  it('getAgentMemory 不存在的 id 返回 undefined', async () => {
    expect(await getAgentMemory('nonexistent')).toBeUndefined();
  });

  it('listAgentMemory 按 createdAt 降序', async () => {
    const id1 = await addAgentMemory({
      type: 'success',
      content: 'first',
      keywords: [],
      relevance: 0.5,
    });
    // 确保时间戳不同
    await new Promise((r) => setTimeout(r, 5));
    const id2 = await addAgentMemory({
      type: 'failure',
      content: 'second',
      keywords: [],
      relevance: 0.5,
    });
    const list = await listAgentMemory();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(id2);
    expect(list[1].id).toBe(id1);
  });

  it('deleteAgentMemory 删除指定记录', async () => {
    const id = await addAgentMemory({
      type: 'pattern',
      content: 'test',
      keywords: [],
      relevance: 0.5,
    });
    await deleteAgentMemory(id);
    expect(await getAgentMemory(id)).toBeUndefined();
    expect(await listAgentMemory()).toHaveLength(0);
  });

  it('deleteAgentMemory 不存在的 id 不报错', async () => {
    await expect(deleteAgentMemory('nonexistent')).resolves.toBeUndefined();
  });
});
