import { describe, expect, it, vi } from 'vitest';
import {
  cn,
  formatCharCount,
  formatDuration,
  randomId,
  escapeXml,
  unescapeXml,
  escapeRegExp,
  downloadFile,
} from '@/lib/utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('handles conditional classes', () => {
    const isHidden = false as boolean;
    expect(cn('base', isHidden && 'hidden', 'block')).toBe('base block');
  });
});

describe('formatCharCount', () => {
  it('formats small numbers', () => {
    expect(formatCharCount(0)).toBe('0');
    expect(formatCharCount(999)).toBe('999');
  });

  it('formats thousands', () => {
    expect(formatCharCount(1000)).toBe('1K');
    expect(formatCharCount(1500)).toBe('1.5K');
  });

  it('formats millions', () => {
    expect(formatCharCount(1_000_000)).toBe('1M');
    expect(formatCharCount(3_400_000)).toBe('3.4M');
  });

  it('clamps negatives to 0', () => {
    expect(formatCharCount(-5)).toBe('0');
  });

  it('drops trailing .0', () => {
    expect(formatCharCount(2000)).toBe('2K');
  });
});

describe('formatDuration', () => {
  it('formats under one minute', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(45000)).toBe('0:45');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2:05');
  });

  it('formats hours', () => {
    expect(formatDuration(3661000)).toBe('1:01:01');
  });

  it('clamps negatives', () => {
    expect(formatDuration(-1000)).toBe('0:00');
  });
});

describe('randomId', () => {
  it('generates requested length', () => {
    expect(randomId(8).length).toBe(8);
    expect(randomId(16).length).toBe(16);
  });

  it('generates alphanumeric by default', () => {
    const id = randomId(20);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it('generates hex when base 16', () => {
    const id = randomId(10, 16);
    expect(id).toMatch(/^[a-f0-9]+$/);
  });
});

describe('escapeXml', () => {
  it('escapes ampersand and less-than', () => {
    expect(escapeXml('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('escapes ]]> sequence', () => {
    expect(escapeXml(']]>')).toBe(']]&gt;');
  });

  it('escapes quotes in attribute mode', () => {
    expect(escapeXml('say "hi"', { forAttribute: true })).toBe('say &quot;hi&quot;');
  });

  it('does not escape > outside ]]> by default', () => {
    expect(escapeXml('5 > 3')).toBe('5 > 3');
  });
});

describe('unescapeXml', () => {
  it('round-trips escapeXml', () => {
    const original = 'a & b < c';
    expect(unescapeXml(escapeXml(original))).toBe(original);
  });

  it('decodes all entities', () => {
    expect(unescapeXml('&quot;&lt;&gt;&amp;')).toBe('"<>&');
  });
});

describe('downloadFile', () => {
  it('creates anchor and triggers download', () => {
    vi.useFakeTimers();
    const a = document.createElement('a');
    const clickSpy = vi.spyOn(a, 'click');
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(a);
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockReturnValue(a);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockReturnValue(a);
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    downloadFile('test.txt', 'hello world', 'text/plain');

    expect(a.download).toBe('test.txt');
    expect(clickSpy).toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeSpy).toHaveBeenCalled();

    createElementSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
    revokeSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe('escapeRegExp', () => {
  it('escapes metacharacters', () => {
    expect(escapeRegExp('.*+?^${}()|[]\\')).toBe(
      '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\',
    );
  });

  it('leaves normal text unchanged', () => {
    expect(escapeRegExp('hello')).toBe('hello');
  });
});
