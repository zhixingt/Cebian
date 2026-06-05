import { describe, expect, it } from 'vitest';
import { filterDeepSeekStream, deepSeekStreamResult } from '@/lib/ai-config/web-provider-content-fetch-deepseek';

describe('9.2.3 DeepSeek thinking-process filter', () => {
  it('drops everything up to and including a FINISHED marker', () => {
    const r = filterDeepSeekStream([
      { v: '根据当前日期2026年6月5日' },
      { v: '推算星期几。' },
      { v: 'FINISHED' },
      { v: '今天是星期五' },
      { v: '。' },
    ]);
    expect(r).toEqual([
      { type: 'text', text: '今天是星期五。' },
      { type: 'finish' },
    ]);
  });

  it('handles FINISHED inline (same chunk as first answer text)', () => {
    const r = filterDeepSeekStream([
      { v: 'some thinking' },
      { v: 'FINISHED回答：今天是星期五' },
    ]);
    expect(r).toEqual([
      { type: 'text', text: '回答：今天是星期五' },
      { type: 'finish' },
    ]);
  });

  it('emits all content if no FINISHED marker is found (no thinking mode)', () => {
    const r = filterDeepSeekStream([
      { v: 'hello' },
      { v: ' world' },
    ]);
    expect(r).toEqual([
      { type: 'text', text: 'hello world' },
      { type: 'finish' },
    ]);
  });

  it('handles whitespace around FINISHED marker', () => {
    const r = filterDeepSeekStream([
      { v: 'thinking' },
      { v: '  FINISHED\n' },
      { v: 'answer here' },
    ]);
    expect(r).toEqual([
      { type: 'text', text: 'answer here' },
      { type: 'finish' },
    ]);
  });

  it('emits a finish marker at the end of every stream', () => {
    const r = filterDeepSeekStream([
      { v: 'thinking' },
      { v: 'FINISHED' },
      { v: 'answer' },
    ]);
    expect(r[r.length - 1]).toEqual({ type: 'finish' });
  });

  it('returns only finish when only thinking was emitted', () => {
    const r = filterDeepSeekStream([
      { v: 'thinking chunk 1' },
      { v: 'thinking chunk 2' },
      { v: 'FINISHED' },
    ]);
    expect(r).toEqual([{ type: 'finish' }]);
  });

  it('handles a single chunk containing FINISHED only', () => {
    const r = filterDeepSeekStream([{ v: 'FINISHED' }, { v: 'answer' }]);
    expect(r).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'finish' },
    ]);
  });
});
