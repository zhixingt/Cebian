import { describe, expect, it } from 'vitest';
import { recordingToAttachment } from '@/lib/recorder/to-attachment';
import { MAX_RECORDING_SIZE } from '@/lib/attachments';
import type { RecordedSession, RecordedEvent } from '@/lib/recorder/types';

function makeSession(events: RecordedEvent[]): RecordedSession {
  return {
    version: 1,
    startedAt: Date.now(),
    endedAt: Date.now() + 1000,
    durationMs: 1000,
    windowId: 1,
    events,
  };
}

function makeEvent(overrides: Partial<RecordedEvent> = {}): RecordedEvent {
  return {
    id: 'e-' + Math.random().toString(36).slice(2),
    t: Date.now(),
    kind: 'interaction',
    tabId: 1,
    url: 'https://example.com',
    ...overrides,
  } as RecordedEvent;
}

describe('recordingToAttachment', () => {
  it('produces a valid attachment for empty events', () => {
    const session = makeSession([]);
    const att = recordingToAttachment(session);
    expect(att.type).toBe('recording');
    expect(att.eventCount).toBe(0);
    expect(att.sizeBytes).toBeGreaterThan(0);
    expect(att.json).toBeDefined();
    expect(att.name).toMatch(/^recording-\d{8}-\d{6}-[a-f0-9]+\.json$/);
  });

  it('compacts tab ids into tabs array', () => {
    const events = [
      makeEvent({ tabId: 5, kind: 'interaction', action: 'click' }),
      makeEvent({ tabId: 7, kind: 'interaction', action: 'scroll' }),
      makeEvent({ tabId: 5, kind: 'interaction', action: 'input' }),
    ];
    const att = recordingToAttachment(makeSession(events));
    const wire = JSON.parse(att.json);
    expect(wire.tabs).toEqual([5, 7]);
    expect(wire.events[0].tIdx).toBe(0);
    expect(wire.events[1].tIdx).toBe(1);
    expect(wire.events[2].tIdx).toBe(0);
    // tabId and url should be stripped from base events
    expect(wire.events[0].tabId).toBeUndefined();
    expect(wire.events[0].url).toBeUndefined();
  });

  it('preserves url for tab events', () => {
    const events = [makeEvent({ tabId: 3, kind: 'tab', url: 'https://new.com' })];
    const att = recordingToAttachment(makeSession(events));
    const wire = JSON.parse(att.json);
    expect(wire.events[0].url).toBe('https://new.com');
  });

  it('strips empty fields', () => {
    const events = [makeEvent({ tabId: 1, kind: 'interaction', action: 'click', url: '' })];
    const att = recordingToAttachment(makeSession(events));
    const wire = JSON.parse(att.json);
    expect(wire.events[0].url).toBeUndefined();
  });

  it('truncates when size exceeds MAX_RECORDING_SIZE', () => {
    // Create a huge payload that will definitely exceed the cap
    const bigString = 'x'.repeat(MAX_RECORDING_SIZE);
    const events = [
      makeEvent({ tabId: 1, kind: 'interaction', action: 'input', value: bigString }),
      makeEvent({ tabId: 1, kind: 'interaction', action: 'input', value: bigString }),
    ];
    const att = recordingToAttachment(makeSession(events));
    expect(att.sizeBytes).toBeLessThanOrEqual(MAX_RECORDING_SIZE);
    expect(att.truncatedAttachment).toBe(true);
    expect(att.eventCount).toBeLessThan(events.length);
  });

  it('preserves session metadata', () => {
    const session = makeSession([makeEvent()]);
    const att = recordingToAttachment(session);
    const wire = JSON.parse(att.json);
    expect(wire.version).toBe(1);
    expect(wire.startedAt).toBe(session.startedAt);
    expect(wire.endedAt).toBe(session.endedAt);
    expect(wire.durationMs).toBe(1000);
    expect(wire.windowId).toBe(1);
  });

  it('strips empty strings from event fields', () => {
    const events = [makeEvent({ tabId: 1, kind: 'interaction', action: 'click', url: '', value: '' })];
    const att = recordingToAttachment(makeSession(events));
    const wire = JSON.parse(att.json);
    expect(wire.events[0].url).toBeUndefined();
    expect(wire.events[0].value).toBeUndefined();
  });
});
