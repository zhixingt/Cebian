import { describe, it, expect } from 'vitest';
import type { RecordedEvent, RecordedSession } from '@/lib/recorder/types';
import type { SequenceStep } from '@/lib/recorder/session-to-sequence';
import {
  sequenceToWorkflowSteps,
  sessionToWorkflow,
} from '@/lib/workflow/session-to-workflow';

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

// ─── sequenceToWorkflowSteps ───

describe('sequenceToWorkflowSteps', () => {
  it('maps click to click step', () => {
    const seq: SequenceStep[] = [{ action: 'click', selector: '#btn' }];
    const steps = sequenceToWorkflowSteps(seq);
    expect(steps).toEqual([{ type: 'click', selector: '#btn' }]);
  });

  it('maps type to type step with clear: false', () => {
    const seq: SequenceStep[] = [{ action: 'type', selector: '#q', text: 'hello' }];
    const steps = sequenceToWorkflowSteps(seq);
    expect(steps).toEqual([{ type: 'type', selector: '#q', text: 'hello', clear: false }]);
  });

  it('merges clear + type into type with clear: true', () => {
    const seq: SequenceStep[] = [
      { action: 'clear', selector: '#q' },
      { action: 'type', selector: '#q', text: 'hello' },
    ];
    const steps = sequenceToWorkflowSteps(seq);
    expect(steps).toEqual([{ type: 'type', selector: '#q', text: 'hello', clear: true }]);
  });

  it('does not merge clear + type with different selectors', () => {
    const seq: SequenceStep[] = [
      { action: 'clear', selector: '#a' },
      { action: 'type', selector: '#b', text: 'hello' },
    ];
    const steps = sequenceToWorkflowSteps(seq);
    // clear drops, type remains with clear: false
    expect(steps).toEqual([{ type: 'type', selector: '#b', text: 'hello', clear: false }]);
  });

  it('drops standalone clear without following type', () => {
    const seq: SequenceStep[] = [{ action: 'clear', selector: '#q' }];
    const steps = sequenceToWorkflowSteps(seq);
    expect(steps).toEqual([]);
  });

  it('maps scroll with deltas', () => {
    const seq: SequenceStep[] = [{ action: 'scroll', selector: '#list', deltaX: 0, deltaY: 100 }];
    const steps = sequenceToWorkflowSteps(seq);
    expect(steps).toEqual([{ type: 'scroll', selector: '#list', deltaX: 0, deltaY: 100 }]);
  });

  it('maps keypress with modifiers', () => {
    const seq: SequenceStep[] = [{ action: 'keypress', selector: '#q', key: 'Enter', modifiers: ['ctrl'] }];
    const steps = sequenceToWorkflowSteps(seq);
    expect(steps).toEqual([{ type: 'keypress', selector: '#q', key: 'Enter', modifiers: ['ctrl'] }]);
  });

  it('maps wait_navigation', () => {
    const seq: SequenceStep[] = [{ action: 'wait_navigation' }];
    const steps = sequenceToWorkflowSteps(seq);
    expect(steps).toEqual([{ type: 'wait_navigation' }]);
  });

  it('maps focus/hover/dblclick/rightclick', () => {
    const seq: SequenceStep[] = [
      { action: 'focus', selector: '#i' },
      { action: 'hover', selector: '#h' },
      { action: 'dblclick', selector: '#d' },
      { action: 'rightclick', selector: '#r' },
    ];
    const steps = sequenceToWorkflowSteps(seq);
    expect(steps).toEqual([
      { type: 'focus', selector: '#i' },
      { type: 'hover', selector: '#h' },
      { type: 'dblclick', selector: '#d' },
      { type: 'rightclick', selector: '#r' },
    ]);
  });
});

// ─── sessionToWorkflow ───

describe('sessionToWorkflow', () => {
  it('generates workflow from click session', () => {
    const session = makeSession([
      makeInteractionEvent('click', { target: { selector: '#btn', tag: 'button' } }),
    ]);
    const wf = sessionToWorkflow(session);
    expect(wf.name).toContain('example.com');
    expect(wf.steps).toEqual([{ type: 'click', selector: '#btn' }]);
    expect(wf.runCount).toBe(0);
    expect(wf.trigger).toEqual({ type: 'manual' });
    expect(wf.id).toMatch(/^wf-\d+/);
  });

  it('uses custom name when provided', () => {
    const session = makeSession([]);
    const wf = sessionToWorkflow(session, { name: 'My Flow' });
    expect(wf.name).toBe('My Flow');
  });

  it('uses custom description when provided', () => {
    const session = makeSession([]);
    const wf = sessionToWorkflow(session, { description: 'Custom desc' });
    expect(wf.description).toBe('Custom desc');
  });

  it('trims custom name and description', () => {
    const session = makeSession([]);
    const wf = sessionToWorkflow(session, { name: '  Name  ', description: '  Desc  ' });
    expect(wf.name).toBe('Name');
    expect(wf.description).toBe('Desc');
  });

  it('falls back to date-based name when URL invalid', () => {
    const session = makeSession([]);
    session.events = [];
    const wf = sessionToWorkflow(session);
    expect(wf.name).toMatch(/^Workflow /);
  });

  it('includes navigation when includeNavigation=true', () => {
    const session = makeSession([
      { kind: 'tab', id: 't1', t: 0, tabId: 1, url: 'https://example.com', event: 'navigated' } as RecordedEvent,
      makeInteractionEvent('click'),
    ]);
    const wf = sessionToWorkflow(session, { includeNavigation: true });
    expect(wf.steps.some((s) => s.type === 'wait_navigation')).toBe(true);
  });

  it('excludes navigation when includeNavigation=false', () => {
    const session = makeSession([
      { kind: 'tab', id: 't1', t: 0, tabId: 1, url: 'https://example.com', event: 'navigated' } as RecordedEvent,
      makeInteractionEvent('click'),
    ]);
    const wf = sessionToWorkflow(session, { includeNavigation: false });
    expect(wf.steps.some((s) => s.type === 'wait_navigation')).toBe(false);
  });

  it('sets createdAt and updatedAt to current time', () => {
    const before = Date.now();
    const session = makeSession([]);
    const wf = sessionToWorkflow(session);
    const after = Date.now();
    expect(wf.createdAt).toBeGreaterThanOrEqual(before);
    expect(wf.createdAt).toBeLessThanOrEqual(after);
    expect(wf.updatedAt).toBe(wf.createdAt);
  });
});
