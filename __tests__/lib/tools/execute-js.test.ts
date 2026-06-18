import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── execute-js.ts 的核心逻辑测试 ───
// 由于 execute-js 依赖 chrome.scripting.executeScript 和 CDP，
// 这里测试其结果处理逻辑（序列化、CSP 回退、outputPath 写入）

// 模拟核心结果处理逻辑（从 execute-js.ts 提取）
const CSP_BLOCKED = '__cebian_csp_blocked__';

function processExecuteResult(
  rawResult: unknown,
  cspFallbackText?: string,
): { text: string; canWrite: boolean } {
  if (rawResult === CSP_BLOCKED) {
    const text = cspFallbackText ?? '';
    if (text.startsWith('Error: ')) {
      throw new Error(text.slice('Error: '.length).trim());
    }
    return { text, canWrite: text !== '(no return value)' };
  }

  if (rawResult === undefined || rawResult === null) {
    return { text: '(no return value)', canWrite: false };
  }

  try {
    const text = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
    return { text, canWrite: true };
  } catch {
    return { text: `(result could not be serialized — got ${typeof rawResult})`, canWrite: false };
  }
}

describe('execute-js result processing', () => {
  it('returns string value verbatim', () => {
    const { text, canWrite } = processExecuteResult('hello world');
    expect(text).toBe('hello world');
    expect(canWrite).toBe(true);
  });

  it('JSON-serializes non-string values', () => {
    const { text, canWrite } = processExecuteResult({ name: 'test', count: 42 });
    expect(text).toBe('{\n  "name": "test",\n  "count": 42\n}');
    expect(canWrite).toBe(true);
  });

  it('returns (no return value) for undefined', () => {
    const { text, canWrite } = processExecuteResult(undefined);
    expect(text).toBe('(no return value)');
    expect(canWrite).toBe(false);
  });

  it('returns (no return value) for null', () => {
    const { text, canWrite } = processExecuteResult(null);
    expect(text).toBe('(no return value)');
    expect(canWrite).toBe(false);
  });

  it('handles CSP blocked fallback with normal result', () => {
    const { text, canWrite } = processExecuteResult(CSP_BLOCKED, 'page title');
    expect(text).toBe('page title');
    expect(canWrite).toBe(true);
  });

  it('handles CSP blocked fallback with no return value', () => {
    const { text, canWrite } = processExecuteResult(CSP_BLOCKED, '(no return value)');
    expect(text).toBe('(no return value)');
    expect(canWrite).toBe(false);
  });

  it('throws on CSP blocked fallback with error', () => {
    try {
      processExecuteResult(CSP_BLOCKED, 'Error: something went wrong');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toBe('something went wrong');
    }
  });

  it('handles circular reference gracefully', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj; // 循环引用
    const { text, canWrite } = processExecuteResult(obj);
    expect(text).toContain('could not be serialized');
    expect(canWrite).toBe(false);
  });

  it('serializes arrays correctly', () => {
    const { text, canWrite } = processExecuteResult([1, 2, 3]);
    expect(text).toBe('[\n  1,\n  2,\n  3\n]');
    expect(canWrite).toBe(true);
  });

  it('serializes numbers as JSON', () => {
    const { text, canWrite } = processExecuteResult(42);
    expect(text).toBe('42');
    expect(canWrite).toBe(true);
  });

  it('serializes booleans as JSON', () => {
    const { text, canWrite } = processExecuteResult(true);
    expect(text).toBe('true');
    expect(canWrite).toBe(true);
  });
});
