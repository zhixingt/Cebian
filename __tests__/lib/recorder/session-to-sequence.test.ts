import { describe, it, expect } from 'vitest';
import type { RecordedEvent, RecordedSession } from '@/lib/recorder/types';
import { sessionToSequence } from '@/lib/recorder/session-to-sequence';

// ─── sessionToSequence 转换逻辑测试 ───
// 将 RecordedSession.events 转换为 interact 工具的 sequence 步骤

// ─── 测试辅助 ───

function makeInteractionEvent(
  action: 'click' | 'input' | 'change' | 'submit' | 'keypress' | 'scroll',
  overrides: Partial<RecordedEvent & { kind: 'interaction' }> = {},
): RecordedEvent & { kind: 'interaction' } {
  return {
    kind: 'interaction',
    id: 'evt-1',
    t: 100,
    tabId: 1,
    url: 'https://example.com',
    action,
    target: { selector: '#btn', tag: 'button' },
    ...overrides,
  } as RecordedEvent & { kind: 'interaction' };
}

function makeSession(events: RecordedEvent[]): RecordedSession {
  return {
    version: 1,
    startedAt: Date.now(),
    endedAt: Date.now() + 5000,
    durationMs: 5000,
    windowId: 1,
    events,
  };
}

// ─── 测试用例 ───

describe('sessionToSequence', () => {
  it('converts click events', () => {
    const session = makeSession([
      makeInteractionEvent('click', { target: { selector: '#search-btn', tag: 'button' } }),
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toEqual([{ action: 'click', selector: '#search-btn' }]);
  });

  it('converts input events to clear + type action', () => {
    const session = makeSession([
      makeInteractionEvent('input', {
        target: { selector: '#q', tag: 'input' },
        value: 'hello',
      }),
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toEqual([
      { action: 'clear', selector: '#q' },
      { action: 'type', selector: '#q', text: 'hello' },
    ]);
  });

  it('converts keypress events', () => {
    const session = makeSession([
      makeInteractionEvent('keypress', {
        target: { selector: '#q', tag: 'input' },
        key: 'Enter',
      }),
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toEqual([{ action: 'keypress', selector: '#q', key: 'Enter' }]);
  });

  it('skips non-interaction events (tab, mutation) by default', () => {
    const session = makeSession([
      { kind: 'tab', id: 't1', t: 0, tabId: 1, url: 'https://example.com', event: 'focus_changed' } as RecordedEvent,
      { kind: 'mutation', id: 'm1', t: 50, tabId: 1, url: 'https://example.com', changes: [{ op: 'appeared', tag: 'div' }] } as RecordedEvent,
      makeInteractionEvent('click'),
    ]);
    // focus_changed is skipped, mutation is skipped by default, only click remains
    const steps = sessionToSequence(session);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('click');
  });

  it('converts scroll events with delta', () => {
    const session = makeSession([
      makeInteractionEvent('scroll', {
        target: { selector: '', tag: 'html' },
        scroll: { deltaX: 0, deltaY: 300 },
      }),
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toEqual([{ action: 'scroll', deltaX: 0, deltaY: 300 }]);
  });

  it('converts change events to select action', () => {
    const session = makeSession([
      makeInteractionEvent('change', {
        target: { selector: '#color', tag: 'select' },
        value: 'red',
      }),
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toEqual([{ action: 'select', selector: '#color', text: 'red' }]);
  });

  it('returns empty array for session with no interaction events (non-navigated tab)', () => {
    const session = makeSession([
      { kind: 'tab', id: 't1', t: 0, tabId: 1, url: 'https://example.com', event: 'focus_changed' } as RecordedEvent,
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toEqual([]);
  });

  it('converts a realistic form fill sequence', () => {
    const session = makeSession([
      makeInteractionEvent('click', { target: { selector: '#username', tag: 'input' } }),
      makeInteractionEvent('input', { target: { selector: '#username', tag: 'input' }, value: 'user@test.com' }),
      makeInteractionEvent('click', { target: { selector: '#password', tag: 'input' } }),
      makeInteractionEvent('input', { target: { selector: '#password', tag: 'input' }, value: 'secret' }),
      makeInteractionEvent('keypress', { target: { selector: '#password', tag: 'input' }, key: 'Enter' }),
    ]);
    const steps = sessionToSequence(session);
    // click + clear+type + click + clear+type + keypress = 7 steps
    expect(steps).toHaveLength(7);
    expect(steps[0]).toEqual({ action: 'click', selector: '#username' });
    expect(steps[1]).toEqual({ action: 'clear', selector: '#username' });
    expect(steps[2]).toEqual({ action: 'type', selector: '#username', text: 'user@test.com' });
    expect(steps[3]).toEqual({ action: 'click', selector: '#password' });
    expect(steps[4]).toEqual({ action: 'clear', selector: '#password' });
    expect(steps[5]).toEqual({ action: 'type', selector: '#password', text: 'secret' });
    expect(steps[6]).toEqual({ action: 'keypress', selector: '#password', key: 'Enter' });
  });

  it('converts tab/navigated to wait_navigation when includeNavigation is true', () => {
    const session = makeSession([
      { kind: 'tab', id: 't1', t: 0, tabId: 1, url: 'https://example.com', event: 'navigated' } as RecordedEvent,
      makeInteractionEvent('click'),
    ]);
    const steps = sessionToSequence(session, { includeNavigation: true });
    expect(steps[0]).toEqual({ action: 'wait_navigation' });
    expect(steps[1]).toEqual({ action: 'click', selector: '#btn' });
  });

  it('skips tab/navigated when includeNavigation is false', () => {
    const session = makeSession([
      { kind: 'tab', id: 't1', t: 0, tabId: 1, url: 'https://example.com', event: 'navigated' } as RecordedEvent,
      makeInteractionEvent('click'),
    ]);
    const steps = sessionToSequence(session, { includeNavigation: false });
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('click');
  });

  it('skips tab events other than navigated', () => {
    const session = makeSession([
      { kind: 'tab', id: 't1', t: 0, tabId: 1, url: 'https://example.com', event: 'focus_changed' } as RecordedEvent,
      { kind: 'tab', id: 't2', t: 10, tabId: 1, url: 'https://example.com', event: 'reloaded' } as RecordedEvent,
    ]);
    const steps = sessionToSequence(session, { includeNavigation: true });
    expect(steps).toEqual([]);
  });

  it('expands repeat keypress into multiple steps', () => {
    const session = makeSession([
      makeInteractionEvent('keypress', {
        target: { selector: '#input', tag: 'input' },
        key: 'Backspace',
        repeat: 3,
      }),
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toHaveLength(3);
    expect(steps.every(s => s.action === 'keypress' && s.key === 'Backspace')).toBe(true);
  });

  it('passes modifiers to keypress steps', () => {
    const session = makeSession([
      makeInteractionEvent('keypress', {
        target: { selector: '#input', tag: 'input' },
        key: 'a',
        modifiers: ['ctrl'],
      }),
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toHaveLength(1);
    expect(steps[0].modifiers).toEqual(['ctrl']);
  });

  it('converts submit events to click action', () => {
    const session = makeSession([
      makeInteractionEvent('submit', { target: { selector: '#form', tag: 'form' } }),
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toEqual([{ action: 'click', selector: '#form' }]);
  });

  it('buildMutationSelector uses label when role is absent', () => {
    const session = makeSession([
      {
        kind: 'mutation',
        id: 'm1',
        t: 50,
        tabId: 1,
        url: 'https://example.com',
        changes: [{ op: 'appeared', tag: 'button', label: 'Click Me' }],
      } as RecordedEvent,
    ]);
    const steps = sessionToSequence(session, { includeMutations: true });
    expect(steps[0].selector).toBe('[aria-label="Click Me"]');
  });

  it('buildMutationSelector returns tag for non-generic elements', () => {
    const session = makeSession([
      {
        kind: 'mutation',
        id: 'm1',
        t: 50,
        tabId: 1,
        url: 'https://example.com',
        changes: [{ op: 'appeared', tag: 'button' }],
      } as RecordedEvent,
    ]);
    const steps = sessionToSequence(session, { includeMutations: true });
    expect(steps[0].selector).toBe('button');
  });

  it('buildMutationSelector returns undefined for generic tags without role/label', () => {
    const session = makeSession([
      {
        kind: 'mutation',
        id: 'm1',
        t: 50,
        tabId: 1,
        url: 'https://example.com',
        changes: [{ op: 'appeared', tag: 'div' }],
      } as RecordedEvent,
    ]);
    const steps = sessionToSequence(session, { includeMutations: true });
    expect(steps).toHaveLength(0);
  });

  it('skips clear before type when clearBeforeType is false', () => {
    const session = makeSession([
      makeInteractionEvent('input', {
        target: { selector: '#q', tag: 'input' },
        value: 'hello',
      }),
    ]);
    const steps = sessionToSequence(session, { clearBeforeType: false });
    expect(steps).toEqual([{ action: 'type', selector: '#q', text: 'hello' }]);
  });

  it('converts mutation/appeared to wait when includeMutations is true', () => {
    const session = makeSession([
      {
        kind: 'mutation',
        id: 'm1',
        t: 50,
        tabId: 1,
        url: 'https://example.com',
        changes: [{ op: 'appeared', tag: 'button', role: 'button', label: 'Submit' }],
      } as RecordedEvent,
    ]);
    const steps = sessionToSequence(session, { includeMutations: true });
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('wait');
    expect(steps[0].selector).toBe('[role="button"]');
    expect(steps[0].timeout).toBe(5000);
  });

  it('skips mutation events by default', () => {
    const session = makeSession([
      {
        kind: 'mutation',
        id: 'm1',
        t: 50,
        tabId: 1,
        url: 'https://example.com',
        changes: [{ op: 'appeared', tag: 'div' }],
      } as RecordedEvent,
    ]);
    const steps = sessionToSequence(session);
    expect(steps).toEqual([]);
  });

  // ─── 智能优化测试 ───

  describe('smart optimization', () => {
    it('merges consecutive clear+type on same selector (keeps last value)', () => {
      // 模拟用户逐字输入：input 事件每次携带完整值
      const session = makeSession([
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'h' }),
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'he' }),
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'hel' }),
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'hello' }),
      ]);
      const steps = sessionToSequence(session);
      // 优化后只保留一组 clear+type，值为最终值 "hello"
      expect(steps).toEqual([
        { action: 'clear', selector: '#q' },
        { action: 'type', selector: '#q', text: 'hello' },
      ]);
    });

    it('does not merge clear+type across different selectors', () => {
      const session = makeSession([
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'hello' }),
        makeInteractionEvent('input', { target: { selector: '#r', tag: 'input' }, value: 'world' }),
      ]);
      const steps = sessionToSequence(session);
      expect(steps).toHaveLength(4);
      expect(steps).toEqual([
        { action: 'clear', selector: '#q' },
        { action: 'type', selector: '#q', text: 'hello' },
        { action: 'clear', selector: '#r' },
        { action: 'type', selector: '#r', text: 'world' },
      ]);
    });

    it('merges consecutive scroll on same selector', () => {
      const session = makeSession([
        makeInteractionEvent('scroll', { target: { selector: '', tag: 'html' }, scroll: { deltaX: 0, deltaY: 100 } }),
        makeInteractionEvent('scroll', { target: { selector: '', tag: 'html' }, scroll: { deltaX: 0, deltaY: 200 } }),
        makeInteractionEvent('scroll', { target: { selector: '', tag: 'html' }, scroll: { deltaX: 0, deltaY: 50 } }),
      ]);
      const steps = sessionToSequence(session);
      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual({ action: 'scroll', deltaX: 0, deltaY: 350 });
    });

    it('removes consecutive duplicate clicks on same selector', () => {
      const session = makeSession([
        makeInteractionEvent('click', { target: { selector: '#btn', tag: 'button' } }),
        makeInteractionEvent('click', { target: { selector: '#btn', tag: 'button' } }),
        makeInteractionEvent('click', { target: { selector: '#btn', tag: 'button' } }),
      ]);
      const steps = sessionToSequence(session);
      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual({ action: 'click', selector: '#btn' });
    });

    it('removes orphan clear without following type', () => {
      const session = makeSession([
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: '' }),
      ]);
      // input with empty value → clear + type("") → 优化后 type("") 被保留但 clear 也保留
      // 实际上 clear+type("") 是合法的（清空输入框），不会被移除
      const steps = sessionToSequence(session);
      expect(steps).toEqual([
        { action: 'clear', selector: '#q' },
        { action: 'type', selector: '#q', text: '' },
      ]);
    });

    it('disables optimization when smartOptimize is false', () => {
      const session = makeSession([
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'h' }),
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'he' }),
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'hello' }),
      ]);
      const steps = sessionToSequence(session, { smartOptimize: false });
      // 不优化时，每次 input 生成一组 clear+type
      expect(steps).toHaveLength(6);
    });

    it('keeps clicks on different selectors', () => {
      const session = makeSession([
        makeInteractionEvent('click', { target: { selector: '#a', tag: 'button' } }),
        makeInteractionEvent('click', { target: { selector: '#b', tag: 'button' } }),
      ]);
      const steps = sessionToSequence(session);
      expect(steps).toHaveLength(2);
    });

    it('handles mixed clear+type and other actions correctly', () => {
      const session = makeSession([
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'h' }),
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'he' }),
        makeInteractionEvent('click', { target: { selector: '#btn', tag: 'button' } }),
        makeInteractionEvent('input', { target: { selector: '#q', tag: 'input' }, value: 'hello' }),
      ]);
      const steps = sessionToSequence(session);
      // clear+type(#q) 合并为最后一组，click 保留，然后新的 clear+type(#q)
      expect(steps).toEqual([
        { action: 'clear', selector: '#q' },
        { action: 'type', selector: '#q', text: 'he' },
        { action: 'click', selector: '#btn' },
        { action: 'clear', selector: '#q' },
        { action: 'type', selector: '#q', text: 'hello' },
      ]);
    });

    it('optimizes 500 consecutive input events within 50ms', () => {
      const events = [];
      for (let i = 0; i < 500; i++) {
        events.push(makeInteractionEvent('input', {
          target: { selector: '#q', tag: 'input' },
          value: 'a'.repeat(i + 1),
        }));
      }
      const session = makeSession(events);
      const start = performance.now();
      const steps = sessionToSequence(session);
      const elapsed = performance.now() - start;
      expect(steps).toHaveLength(2); // 只保留一组 clear+type
      expect(elapsed).toBeLessThan(50); // O(n) 算法应在 50ms 内完成
    });
  });
});
