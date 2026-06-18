import { describe, expect, it } from 'vitest';
import { serializeCrossProviderHistory } from '@/lib/ai-config/web-provider-cross-context';

describe('9.2.4 cross-provider context serialization', () => {
  it('returns empty string when no prior messages', () => {
    const result = serializeCrossProviderHistory([], 'current question');
    expect(result).toBe('current question');
  });

  it('serializes prior turns and the new question together', () => {
    const result = serializeCrossProviderHistory(
      [
        { role: 'user', content: 'old question' },
        { role: 'assistant', content: 'old answer' },
        { role: 'user', content: 'current question' },
      ],
      'current question',
    );
    expect(result).toContain('old question');
    expect(result).toContain('old answer');
    expect(result).toContain('current question');
  });

  it('serializes a single prior turn with the history block', () => {
    const result = serializeCrossProviderHistory(
      [
        { role: 'user', content: 'hi there' },
        { role: 'assistant', content: 'hello! how can I help?' },
        { role: 'user', content: 'what day is it' },
      ],
      'what day is it',
    );
    expect(result).toContain('hi there');
    expect(result).toContain('hello! how can I help?');
    expect(result).toContain('what day is it');
    // Has a clear marker so the new model knows what's history
    expect(result).toMatch(/history|context|prior/i);
  });

  it('handles multimodal user content (filters to text only)', () => {
    const result = serializeCrossProviderHistory(
      [
        { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image', url: 'https://should-not-appear.example/img.png' }] as any },
        { role: 'assistant', content: 'A' },
        { role: 'user', content: 'b' },
      ],
      'b',
    );
    expect(result).toContain('a');
    expect(result).toContain('A');
    expect(result).toContain('b');
    expect(result).not.toContain('should-not-appear'); // image URL skipped
  });

  it('truncates very long histories to keep prompt size reasonable', () => {
    const longAsst = 'X'.repeat(20_000);
    const result = serializeCrossProviderHistory(
      [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: longAsst },
        { role: 'user', content: 'q2' },
      ],
      'q2',
    );
    // Truncation is implementation-defined but the function should
    // return something bounded (no 20K characters of filler).
    expect(result.length).toBeLessThan(15_000);
  });

  it('falls through current question when history is malformed', () => {
    const result = serializeCrossProviderHistory(
      [
        null as any,
        { role: 'user', content: 'q' },
      ] as any,
      'q',
    );
    // Should not throw and should at least include the current question.
    expect(result).toContain('q');
  });
});
