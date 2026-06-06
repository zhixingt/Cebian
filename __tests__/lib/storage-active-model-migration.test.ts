import { describe, it, expect } from 'vitest';
import { isValidActiveModel } from '@/lib/ai-config/web-provider-active-model-validation';

describe('isValidActiveModel', () => {
  it('rejects null / undefined / non-object', () => {
    expect(isValidActiveModel(null)).toBe(false);
    expect(isValidActiveModel(undefined)).toBe(false);
    expect(isValidActiveModel('web:glm:x')).toBe(false);
    expect(isValidActiveModel(42)).toBe(false);
  });

  it('rejects empty object {}', () => {
    expect(isValidActiveModel({})).toBe(false);
  });

  it('rejects object missing provider or modelId', () => {
    expect(isValidActiveModel({ provider: 'web' })).toBe(false);
    expect(isValidActiveModel({ modelId: 'x' })).toBe(false);
  });

  it('rejects empty string provider or modelId', () => {
    expect(isValidActiveModel({ provider: '', modelId: 'x' })).toBe(false);
    expect(isValidActiveModel({ provider: 'web', modelId: '' })).toBe(false);
  });

  it('accepts a valid GLM web: id', () => {
    expect(isValidActiveModel({
      provider: 'web',
      modelId: 'web:glm:GLM-4.6',
    })).toBe(true);
  });

  it('rejects a stale web:deepseek: id (preset removed)', () => {
    expect(isValidActiveModel({
      provider: 'web',
      modelId: 'web:deepseek:deepseek-chat',
    })).toBe(false);
  });

  it('rejects a stale web:kimi: id (preset removed)', () => {
    expect(isValidActiveModel({
      provider: 'web',
      modelId: 'web:kimi:moonshot-v1',
    })).toBe(false);
  });

  it('rejects web: id with empty presetId (web::modelId)', () => {
    expect(isValidActiveModel({
      provider: 'web',
      modelId: 'web::modelId',
    })).toBe(false);
  });

  it('accepts a non-web provider (e.g. anthropic)', () => {
    expect(isValidActiveModel({
      provider: 'anthropic',
      modelId: 'claude-3-7-sonnet',
    })).toBe(true);
  });
});
