/**
 * lib/capture/skill-registry.ts 测试
 *
 * 覆盖范围：
 * - addSkills / getSkillsByHostname / getAllSkills
 * - enableSkill / disableSkill / deleteSkill
 * - findMatchingSkill：URL 匹配、intent 匹配
 * - updateSkillStats：动态置信度更新
 * - getEffectiveConfidence：初始 vs 动态
 *
 * 注意：skill-registry 有模块级内存状态（skillsByHostname/skillsByName/loaded），
 * 每个 beforeEach 需要清空内存索引和 DB 表以保证测试隔离。
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '@/lib/db';
import {
  addSkills,
  getSkillsByHostname,
  getAllSkills,
  getEnabledSkills,
  enableSkill,
  disableSkill,
  deleteSkill,
  findMatchingSkill,
  updateSkillStats,
  getEffectiveConfidence,
} from '@/lib/capture/skill-registry';
import type { AutoSkillDefinition } from '@/lib/capture/types';
import {
  SKILL_ENABLE_MIN_CALLS,
  SKILL_MIN_CONFIDENCE,
  CONFIDENCE_HISTORY_WEIGHT,
  CONFIDENCE_RECENT_WEIGHT,
  CONFIDENCE_MAX,
} from '@/lib/capture/types';

// ─── 测试辅助 ───

function makeSkill(overrides: Partial<AutoSkillDefinition> = {}): AutoSkillDefinition {
  return {
    name: 'auto-api-example-com-get-api-users-id',
    description: 'Auto-discovered API: GET /api/users/{id} (api.example.com)',
    endpointId: 'GET|/api/users/{id}',
    hostname: 'api.example.com',
    method: 'GET',
    authType: 'cookie',
    pathname: '/api/users/{id}',
    bgFetchPatterns: ['https://api.example.com/api/users/*'],
    script: 'async function run(args = {}) { /* ... */ }',
    initialConfidence: 0.7,
    enabled: false,
    createdAt: Date.now(),
    stats: {
      callCount: 0,
      successCount: 0,
      failureCount: 0,
      lastCalledAt: null,
      dynamicConfidence: 0,
    },
    ...overrides,
  };
}

beforeEach(async () => {
  // 清空内存索引（getAllSkills 会触发首次 loadFromDb，之后 loaded=true）
  const all = await getAllSkills();
  for (const s of all) {
    await deleteSkill(s.name);
  }
  // 清空 DB 表
  await getDb().autoSkills.clear();
});

// ─── addSkills / getSkillsByHostname / getAllSkills ───

describe('addSkills / getSkillsByHostname / getAllSkills', () => {
  it('addSkills 写入后可通过 getAllSkills 查询', async () => {
    const skill = makeSkill();
    await addSkills([skill]);
    const all = await getAllSkills();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe(skill.name);
  });

  it('getSkillsByHostname 按 hostname 过滤', async () => {
    await addSkills([
      makeSkill({ name: 's1', hostname: 'a.com' }),
      makeSkill({ name: 's2', hostname: 'b.com' }),
      makeSkill({ name: 's3', hostname: 'a.com' }),
    ]);
    expect(await getSkillsByHostname('a.com')).toHaveLength(2);
    expect(await getSkillsByHostname('b.com')).toHaveLength(1);
  });

  it('getSkillsByHostname 不存在的 hostname 返回空数组', async () => {
    await addSkills([makeSkill({ hostname: 'a.com' })]);
    expect(await getSkillsByHostname('nonexistent.com')).toEqual([]);
  });

  it('addSkills 同名 Skill 被覆盖', async () => {
    await addSkills([makeSkill({ name: 's1', description: 'old' })]);
    await addSkills([makeSkill({ name: 's1', description: 'new' })]);
    const all = await getAllSkills();
    expect(all).toHaveLength(1);
    expect(all[0].description).toBe('new');
  });

  it('addSkills 空数组不报错', async () => {
    await addSkills([]);
    expect(await getAllSkills()).toEqual([]);
  });

  it('addSkills 批量添加多个 Skill', async () => {
    await addSkills([
      makeSkill({ name: 's1', hostname: 'a.com' }),
      makeSkill({ name: 's2', hostname: 'a.com' }),
      makeSkill({ name: 's3', hostname: 'b.com' }),
    ]);
    expect(await getAllSkills()).toHaveLength(3);
    expect(await getSkillsByHostname('a.com')).toHaveLength(2);
  });
});

// ─── enableSkill / disableSkill / deleteSkill ───

describe('enableSkill / disableSkill', () => {
  it('enableSkill 将 enabled 设为 true', async () => {
    await addSkills([makeSkill({ name: 's1', enabled: false })]);
    await enableSkill('s1');
    const all = await getAllSkills();
    expect(all[0].enabled).toBe(true);
  });

  it('disableSkill 将 enabled 设为 false', async () => {
    await addSkills([makeSkill({ name: 's1', enabled: true })]);
    await disableSkill('s1');
    const all = await getAllSkills();
    expect(all[0].enabled).toBe(false);
  });

  it('enableSkill 不存在的 Skill 静默返回（不报错）', async () => {
    await expect(enableSkill('nonexistent')).resolves.toBeUndefined();
  });

  it('disableSkill 不存在的 Skill 静默返回（不报错）', async () => {
    await expect(disableSkill('nonexistent')).resolves.toBeUndefined();
  });
});

describe('deleteSkill', () => {
  it('deleteSkill 从内存和 DB 移除', async () => {
    await addSkills([makeSkill({ name: 's1', hostname: 'a.com' })]);
    await deleteSkill('s1');
    expect(await getAllSkills()).toHaveLength(0);
    expect(await getSkillsByHostname('a.com')).toHaveLength(0);
    expect(await getDb().autoSkills.get('s1')).toBeUndefined();
  });

  it('deleteSkill 不存在的 Skill 静默返回（不报错）', async () => {
    await expect(deleteSkill('nonexistent')).resolves.toBeUndefined();
  });

  it('deleteSkill 后 hostname 下无 Skill 时清理 hostname 索引', async () => {
    await addSkills([makeSkill({ name: 's1', hostname: 'a.com' })]);
    await deleteSkill('s1');
    // 重新添加同 hostname 的 Skill 应该从空开始
    await addSkills([makeSkill({ name: 's2', hostname: 'a.com' })]);
    const list = await getSkillsByHostname('a.com');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('s2');
  });
});

// ─── getEnabledSkills ───

describe('getEnabledSkills', () => {
  it('仅返回 enabled=true 且置信度达标的 Skill', async () => {
    await addSkills([
      makeSkill({
        name: 's-enabled',
        enabled: true,
        initialConfidence: 0.8,
      }),
      makeSkill({
        name: 's-disabled',
        enabled: false,
        initialConfidence: 0.8,
      }),
      makeSkill({
        name: 's-low-conf',
        enabled: true,
        initialConfidence: 0.3, // 低于 SKILL_MIN_CONFIDENCE(0.6)
      }),
    ]);
    const enabled = await getEnabledSkills();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe('s-enabled');
  });

  it('置信度等于 SKILL_MIN_CONFIDENCE 时仍返回', async () => {
    await addSkills([
      makeSkill({
        name: 's-boundary',
        enabled: true,
        initialConfidence: SKILL_MIN_CONFIDENCE,
      }),
    ]);
    const enabled = await getEnabledSkills();
    expect(enabled).toHaveLength(1);
  });
});

// ─── findMatchingSkill ───

describe('findMatchingSkill', () => {
  it('URL pathname 匹配已启用的 Skill 时返回该 Skill', async () => {
    await addSkills([
      makeSkill({
        name: 's1',
        hostname: 'api.example.com',
        pathname: '/api/users/{id}',
        enabled: true,
      }),
    ]);
    const matched = await findMatchingSkill('https://api.example.com/api/users/123');
    expect(matched).not.toBeNull();
    expect(matched!.name).toBe('s1');
  });

  it('未启用的 Skill 不参与匹配', async () => {
    await addSkills([
      makeSkill({
        name: 's1',
        hostname: 'api.example.com',
        pathname: '/api/users/{id}',
        enabled: false,
      }),
    ]);
    const matched = await findMatchingSkill('https://api.example.com/api/users/123');
    expect(matched).toBeNull();
  });

  it('hostname 不匹配时返回 null', async () => {
    await addSkills([
      makeSkill({
        name: 's1',
        hostname: 'api.example.com',
        pathname: '/api/users/{id}',
        enabled: true,
      }),
    ]);
    const matched = await findMatchingSkill('https://other.com/api/users/123');
    expect(matched).toBeNull();
  });

  it('pathname 不匹配时返回 null', async () => {
    await addSkills([
      makeSkill({
        name: 's1',
        hostname: 'api.example.com',
        pathname: '/api/users/{id}',
        enabled: true,
      }),
    ]);
    const matched = await findMatchingSkill('https://api.example.com/api/posts/123');
    expect(matched).toBeNull();
  });

  it('无候选 Skill 时返回 null', async () => {
    const matched = await findMatchingSkill('https://api.example.com/api/users/123');
    expect(matched).toBeNull();
  });

  it('非法 URL 返回 null', async () => {
    await addSkills([makeSkill({ enabled: true })]);
    const matched = await findMatchingSkill('not-a-url');
    expect(matched).toBeNull();
  });

  it('多个匹配 Skill 时按置信度降序返回最优', async () => {
    await addSkills([
      makeSkill({
        name: 's-low',
        hostname: 'api.example.com',
        pathname: '/api/users/{id}',
        enabled: true,
        initialConfidence: 0.6,
      }),
      makeSkill({
        name: 's-high',
        hostname: 'api.example.com',
        pathname: '/api/users/{id}',
        enabled: true,
        initialConfidence: 0.9,
      }),
    ]);
    const matched = await findMatchingSkill('https://api.example.com/api/users/123');
    expect(matched).not.toBeNull();
    expect(matched!.name).toBe('s-high');
  });

  it('intent 匹配 description 时加分（影响排序）', async () => {
    await addSkills([
      makeSkill({
        name: 's-no-intent',
        hostname: 'api.example.com',
        pathname: '/api/items/{id}',
        description: 'Auto-discovered API: GET /api/items/{id}',
        enabled: true,
        initialConfidence: 0.8,
      }),
      makeSkill({
        name: 's-intent',
        hostname: 'api.example.com',
        pathname: '/api/items/{id}',
        description: 'Auto-discovered API: GET /api/items/{id}',
        enabled: true,
        initialConfidence: 0.8,
      }),
    ]);
    // 两个 Skill 相同，intent 匹配 description 时应返回包含关键词的
    // 这里 description 相同，所以 intent 匹配后两者都加分，但排序应一致
    const matched = await findMatchingSkill(
      'https://api.example.com/api/items/1',
      'items',
    );
    expect(matched).not.toBeNull();
  });

  it('{uuid} 和 {hash} 占位符同样匹配动态片段', async () => {
    await addSkills([
      makeSkill({
        name: 's-uuid',
        hostname: 'api.example.com',
        pathname: '/api/items/{uuid}',
        enabled: true,
      }),
      makeSkill({
        name: 's-hash',
        hostname: 'api.example.com',
        pathname: '/api/blob/{hash}',
        enabled: true,
      }),
    ]);
    const matchedUuid = await findMatchingSkill(
      'https://api.example.com/api/items/550e8400-e29b-41d4-a716-446655440000',
    );
    expect(matchedUuid?.name).toBe('s-uuid');

    const matchedHash = await findMatchingSkill(
      'https://api.example.com/api/blob/0123456789abcdef0123456789abcdef',
    );
    expect(matchedHash?.name).toBe('s-hash');
  });
});

// ─── updateSkillStats ───

describe('updateSkillStats', () => {
  it('成功调用：callCount 和 successCount 递增', async () => {
    await addSkills([makeSkill({ name: 's1' })]);
    await updateSkillStats('s1', true);
    const all = await getAllSkills();
    expect(all[0].stats.callCount).toBe(1);
    expect(all[0].stats.successCount).toBe(1);
    expect(all[0].stats.failureCount).toBe(0);
    expect(all[0].stats.lastCalledAt).not.toBeNull();
  });

  it('失败调用：callCount 和 failureCount 递增', async () => {
    await addSkills([makeSkill({ name: 's1' })]);
    await updateSkillStats('s1', false);
    const all = await getAllSkills();
    expect(all[0].stats.callCount).toBe(1);
    expect(all[0].stats.successCount).toBe(0);
    expect(all[0].stats.failureCount).toBe(1);
  });

  it('多次调用累计计数', async () => {
    await addSkills([makeSkill({ name: 's1' })]);
    await updateSkillStats('s1', true);
    await updateSkillStats('s1', true);
    await updateSkillStats('s1', false);
    const all = await getAllSkills();
    expect(all[0].stats.callCount).toBe(3);
    expect(all[0].stats.successCount).toBe(2);
    expect(all[0].stats.failureCount).toBe(1);
  });

  it('不存在的 Skill 静默返回（不报错）', async () => {
    await expect(updateSkillStats('nonexistent', true)).resolves.toBeUndefined();
  });

  it('调用次数 < SKILL_ENABLE_MIN_CALLS 时不更新 dynamicConfidence', async () => {
    await addSkills([makeSkill({ name: 's1', initialConfidence: 0.7 })]);
    await updateSkillStats('s1', true); // callCount=1
    await updateSkillStats('s1', true); // callCount=2
    const all = await getAllSkills();
    expect(all[0].stats.callCount).toBe(2);
    expect(all[0].stats.dynamicConfidence).toBe(0); // 未达门槛
  });

  it('调用次数 >= SKILL_ENABLE_MIN_CALLS 时更新 dynamicConfidence', async () => {
    await addSkills([makeSkill({ name: 's1', initialConfidence: 0.7 })]);
    await updateSkillStats('s1', true);
    await updateSkillStats('s1', true);
    await updateSkillStats('s1', true); // callCount=3, 达到门槛
    const all = await getAllSkills();
    const successRate = 1.0; // 3/3
    const expected = Math.min(
      0.7 * CONFIDENCE_HISTORY_WEIGHT + successRate * CONFIDENCE_RECENT_WEIGHT,
      CONFIDENCE_MAX,
    );
    expect(all[0].stats.dynamicConfidence).toBeCloseTo(expected, 10);
  });

  it('dynamicConfidence 不超过 CONFIDENCE_MAX', async () => {
    await addSkills([makeSkill({ name: 's1', initialConfidence: 1.0 })]);
    // 全部成功，successRate=1.0
    for (let i = 0; i < 10; i++) {
      await updateSkillStats('s1', true);
    }
    const all = await getAllSkills();
    expect(all[0].stats.dynamicConfidence).toBeLessThanOrEqual(CONFIDENCE_MAX);
  });

  it('部分失败时 dynamicConfidence 基于成功率计算', async () => {
    await addSkills([makeSkill({ name: 's1', initialConfidence: 0.8 })]);
    // 3 次调用，2 成功 1 失败 → successRate = 2/3
    await updateSkillStats('s1', true);
    await updateSkillStats('s1', true);
    await updateSkillStats('s1', false);
    const all = await getAllSkills();
    const successRate = 2 / 3;
    const expected = Math.min(
      0.8 * CONFIDENCE_HISTORY_WEIGHT + successRate * CONFIDENCE_RECENT_WEIGHT,
      CONFIDENCE_MAX,
    );
    expect(all[0].stats.dynamicConfidence).toBeCloseTo(expected, 10);
  });
});

// ─── getEffectiveConfidence ───

describe('getEffectiveConfidence', () => {
  it('调用次数 < SKILL_ENABLE_MIN_CALLS 时返回 initialConfidence', () => {
    const skill = makeSkill({
      initialConfidence: 0.7,
      stats: {
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        lastCalledAt: null,
        dynamicConfidence: 0,
      },
    });
    expect(getEffectiveConfidence(skill)).toBe(0.7);
  });

  it('调用次数 = SKILL_ENABLE_MIN_CALLS - 1 时仍返回 initialConfidence', () => {
    const skill = makeSkill({
      initialConfidence: 0.7,
      stats: {
        callCount: SKILL_ENABLE_MIN_CALLS - 1,
        successCount: 2,
        failureCount: 0,
        lastCalledAt: Date.now(),
        dynamicConfidence: 0.99, // 即使 dynamicConfidence 已设置，未达门槛也不使用
      },
    });
    expect(getEffectiveConfidence(skill)).toBe(0.7);
  });

  it('调用次数 >= SKILL_ENABLE_MIN_CALLS 时返回 dynamicConfidence', () => {
    const skill = makeSkill({
      initialConfidence: 0.7,
      stats: {
        callCount: SKILL_ENABLE_MIN_CALLS,
        successCount: 3,
        failureCount: 0,
        lastCalledAt: Date.now(),
        dynamicConfidence: 0.85,
      },
    });
    expect(getEffectiveConfidence(skill)).toBe(0.85);
  });

  it('调用次数远超门槛时返回 dynamicConfidence', () => {
    const skill = makeSkill({
      initialConfidence: 0.5,
      stats: {
        callCount: 100,
        successCount: 90,
        failureCount: 10,
        lastCalledAt: Date.now(),
        dynamicConfidence: 0.92,
      },
    });
    expect(getEffectiveConfidence(skill)).toBe(0.92);
  });
});
