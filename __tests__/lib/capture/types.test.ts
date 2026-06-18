/**
 * lib/capture/types.ts 常量与类型测试
 *
 * 验证捕获会话相关常量的具体取值——这些值被 capture-session、analyzer、
 * skill-registry 等模块用作阈值/上限，变更会直接影响运行时行为，因此需要
 * 显式断言以防止意外修改。
 */
import { describe, it, expect } from 'vitest';
import {
  CAPTURE_MAX_DURATION_MS,
  CAPTURE_MAX_REQUESTS,
  CAPTURE_HEARTBEAT_INTERVAL_MS,
  SKILL_MIN_SAMPLES,
  SKILL_MIN_CONFIDENCE,
  SKILL_ENABLE_MIN_CALLS,
  CONFIDENCE_HISTORY_WEIGHT,
  CONFIDENCE_RECENT_WEIGHT,
  CONFIDENCE_MAX,
  API_DISCOVERY_MSG,
} from '@/lib/capture/types';

describe('capture/types 常量', () => {
  it('CAPTURE_MAX_DURATION_MS 为 5 分钟（300_000 ms）', () => {
    expect(CAPTURE_MAX_DURATION_MS).toBe(5 * 60 * 1000);
    expect(CAPTURE_MAX_DURATION_MS).toBe(300_000);
  });

  it('CAPTURE_MAX_REQUESTS 为 2000', () => {
    expect(CAPTURE_MAX_REQUESTS).toBe(2000);
  });

  it('CAPTURE_HEARTBEAT_INTERVAL_MS 为 20 秒，小于 SW 30s 超时', () => {
    expect(CAPTURE_HEARTBEAT_INTERVAL_MS).toBe(20_000);
    expect(CAPTURE_HEARTBEAT_INTERVAL_MS).toBeLessThan(30_000);
  });

  it('SKILL_MIN_SAMPLES 为 2（生成 Skill 的最少样本数）', () => {
    expect(SKILL_MIN_SAMPLES).toBe(2);
  });

  it('SKILL_MIN_CONFIDENCE 为 0.6（展示给 Agent 的最低置信度）', () => {
    expect(SKILL_MIN_CONFIDENCE).toBe(0.6);
  });

  it('SKILL_ENABLE_MIN_CALLS 为 3（动态置信度启用门槛）', () => {
    expect(SKILL_ENABLE_MIN_CALLS).toBe(3);
  });

  it('置信度权重之和为 1.0（history 0.7 + recent 0.3）', () => {
    expect(CONFIDENCE_HISTORY_WEIGHT).toBe(0.7);
    expect(CONFIDENCE_RECENT_WEIGHT).toBe(0.3);
    expect(CONFIDENCE_HISTORY_WEIGHT + CONFIDENCE_RECENT_WEIGHT).toBeCloseTo(1.0, 10);
  });

  it('CONFIDENCE_MAX 为 0.95（置信度上限）', () => {
    expect(CONFIDENCE_MAX).toBe(0.95);
  });

  it('API_DISCOVERY_MSG 消息类型标识为 cebianx:api-discovery', () => {
    expect(API_DISCOVERY_MSG).toBe('cebianx:api-discovery');
  });
});
