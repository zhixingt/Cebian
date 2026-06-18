// ─── Agent 记忆 CRUD ───
//
// 存储 Agent 的任务经验和教训（成功模式、失败教训等）。
// 见 openspec/changes/2026-06-18-layered-memory-system/design.md。

import { getDb } from '../db';
import type { AgentMemoryRecord } from './types';

/**
 * 新增 Agent 记忆。生成 UUID 与 createdAt。
 * @returns 新记录的 id
 */
export async function addAgentMemory(
  memory: Omit<AgentMemoryRecord, 'id' | 'createdAt'>,
): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const record: AgentMemoryRecord = { ...memory, id, createdAt };
  await getDb().agentMemory.add(record);
  return id;
}

/**
 * 读取单条 Agent 记忆。
 */
export async function getAgentMemory(
  id: string,
): Promise<AgentMemoryRecord | undefined> {
  return getDb().agentMemory.get(id);
}

/**
 * 列出全部 Agent 记忆，按 createdAt 降序（最新在前）。
 */
export async function listAgentMemory(): Promise<AgentMemoryRecord[]> {
  const all = await getDb().agentMemory.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 删除单条 Agent 记忆。
 */
export async function deleteAgentMemory(id: string): Promise<void> {
  await getDb().agentMemory.delete(id);
}
