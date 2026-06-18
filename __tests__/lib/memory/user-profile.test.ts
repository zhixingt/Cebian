import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  getUserProfile,
  setUserProfile,
  getAllUserProfile,
  deleteUserProfile,
} from '@/lib/memory/user-profile';

describe('user-profile CRUD', () => {
  beforeEach(async () => {
    await getDb().userProfile.clear();
  });

  it('setUserProfile 写入新记录后可读取', async () => {
    await setUserProfile('language', 'TypeScript');
    expect(await getUserProfile('language')).toBe('TypeScript');
  });

  it('setUserProfile 同 key 覆盖（upsert）', async () => {
    await setUserProfile('language', 'TypeScript');
    await setUserProfile('language', 'Rust');
    expect(await getUserProfile('language')).toBe('Rust');
    const all = await getAllUserProfile();
    expect(all).toHaveLength(1);
    expect(all[0].updatedAt).toBeGreaterThan(0);
  });

  it('getUserProfile 不存在的 key 返回 undefined', async () => {
    expect(await getUserProfile('nonexistent')).toBeUndefined();
  });

  it('getAllUserProfile 按 key 升序返回', async () => {
    await setUserProfile('zeta', '1');
    await setUserProfile('alpha', '2');
    await setUserProfile('middle', '3');
    const all = await getAllUserProfile();
    expect(all.map((p) => p.key)).toEqual(['alpha', 'middle', 'zeta']);
  });

  it('deleteUserProfile 删除指定 key', async () => {
    await setUserProfile('language', 'TypeScript');
    await deleteUserProfile('language');
    expect(await getUserProfile('language')).toBeUndefined();
    expect(await getAllUserProfile()).toHaveLength(0);
  });

  it('deleteUserProfile 不存在的 key 不报错', async () => {
    await expect(deleteUserProfile('nonexistent')).resolves.toBeUndefined();
  });
});
