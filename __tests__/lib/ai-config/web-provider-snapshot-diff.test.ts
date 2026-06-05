import { describe, expect, it } from 'vitest';
import {
  diffSnapshot,
  type SnapshotDiffResult,
  type SnapshotNode,
} from '@/lib/ai-config/web-provider-snapshot-diff';

describe('9.2 server change monitor: snapshot diff', () => {
  // A snapshot is a normalized JSON tree (captures of a real chat
  // session, with the request/response/auth/headers normalized).
  // We just need the diff to walk any JSON-shaped tree.

  it('detects new fields in candidate', () => {
    const baseline: SnapshotNode = { a: 1, b: 2 };
    const candidate: SnapshotNode = { a: 1, b: 2, c: 3 };
    const r = diffSnapshot(baseline, candidate);
    expect(r.added).toEqual(['c']);
    expect(r.removed).toEqual([]);
    expect(r.changed).toEqual([]);
  });

  it('detects removed fields in candidate', () => {
    const baseline: SnapshotNode = { a: 1, b: 2, c: 3 };
    const candidate: SnapshotNode = { a: 1, c: 3 };
    const r = diffSnapshot(baseline, candidate);
    expect(r.removed).toEqual(['b']);
    expect(r.added).toEqual([]);
  });

  it('detects value changes in scalar fields', () => {
    const baseline: SnapshotNode = { version: '1.0', name: 'foo' };
    const candidate: SnapshotNode = { version: '2.0', name: 'foo' };
    const r = diffSnapshot(baseline, candidate);
    expect(r.changed).toEqual([
      { path: 'version', from: '1.0', to: '2.0' },
    ]);
  });

  it('detects type changes (string vs number)', () => {
    const baseline: SnapshotNode = { difficulty: 20 };
    const candidate: SnapshotNode = { difficulty: '20' };
    const r = diffSnapshot(baseline, candidate);
    expect(r.changed).toEqual([
      { path: 'difficulty', from: 20, to: '20' },
    ]);
  });

  it('walks nested objects with dot paths', () => {
    const baseline: SnapshotNode = {
      request: { headers: { 'x-foo': 'a', 'x-bar': 'b' } },
    };
    const candidate: SnapshotNode = {
      request: { headers: { 'x-foo': 'a', 'x-bar': 'B', 'x-baz': 'c' } },
    };
    const r = diffSnapshot(baseline, candidate);
    expect(r.changed).toEqual([
      { path: 'request.headers.x-bar', from: 'b', to: 'B' },
    ]);
    expect(r.added).toEqual(['request.headers.x-baz']);
  });

  it('treats arrays by element (order-sensitive, length-aware)', () => {
    // 3 → 4 elements: index 2 changes ('c' → 'd'), index 3 is added ('e')
    const baseline: SnapshotNode = { tags: ['a', 'b', 'c'] };
    const candidate: SnapshotNode = { tags: ['a', 'b', 'd', 'e'] };
    const r = diffSnapshot(baseline, candidate);
    expect(r.changed).toEqual([
      { path: 'tags[2]', from: 'c', to: 'd' },
    ]);
    expect(r.added).toEqual(['tags[3]']);
    expect(r.removed).toEqual([]);
  });

  it('reports array elements removed at the tail', () => {
    // 3 → 2 elements: index 2 is removed
    const baseline: SnapshotNode = { tags: ['a', 'b', 'c'] };
    const candidate: SnapshotNode = { tags: ['a', 'b'] };
    const r = diffSnapshot(baseline, candidate);
    expect(r.removed).toEqual(['tags[2]']);
    expect(r.added).toEqual([]);
  });

  it('marks snapshot as breaking when required fields change', () => {
    // requiredPaths lists the field paths the user cares about.
    // A change to any of them flags the diff as breaking.
    const baseline: SnapshotNode = {
      request: { url: 'https://api/v0/chat/completion', method: 'POST' },
    };
    const candidate: SnapshotNode = {
      request: { url: 'https://api/v1/chat/completion', method: 'POST' },
    };
    const r = diffSnapshot(
      baseline,
      candidate,
      ['request.url', 'request.method'],
    );
    expect(r.breaking).toBe(true);
    expect(r.breakingReasons).toEqual([
      { path: 'request.url', from: 'https://api/v0/chat/completion', to: 'https://api/v1/chat/completion' },
    ]);
  });

  it('returns empty result for identical snapshots', () => {
    const snapshot: SnapshotNode = { a: 1, b: { c: 2, d: [1, 2] } };
    const r = diffSnapshot(snapshot, snapshot);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.changed).toEqual([]);
    expect(r.breaking).toBe(false);
  });

  it('handles null and undefined values', () => {
    const baseline: SnapshotNode = { x: null };
    const candidate: SnapshotNode = { x: 'now-a-string' };
    const r = diffSnapshot(baseline, candidate);
    expect(r.changed).toEqual([{ path: 'x', from: null, to: 'now-a-string' }]);
  });
});
