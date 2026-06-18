// ─── 用户画像 CRUD ───
//
// 键值对存储用户偏好（语言、常用网站、工作习惯等）。
// 见 openspec/changes/2026-06-18-layered-memory-system/design.md。

import { getDb } from '../db';
import type { UserProfileRecord } from './types';

/**
 * 读取单个用户画像字段。
 */
export async function getUserProfile(key: string): Promise<string | undefined> {
  const record = await getDb().userProfile.get(key);
  return record?.value;
}

/**
 * 写入用户画像字段（upsert）。同 key 覆盖，updatedAt 刷新。
 */
export async function setUserProfile(key: string, value: string): Promise<void> {
  const updatedAt = Date.now();
  await getDb().userProfile.put({ key, value, updatedAt });
}

/**
 * 读取全部用户画像，按 key 升序返回。
 */
export async function getAllUserProfile(): Promise<UserProfileRecord[]> {
  const all = await getDb().userProfile.toArray();
  return all.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * 删除单个用户画像字段。
 */
export async function deleteUserProfile(key: string): Promise<void> {
  await getDb().userProfile.delete(key);
}
