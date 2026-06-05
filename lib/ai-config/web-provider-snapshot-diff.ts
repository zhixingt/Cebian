/**
 * ⑨.2: Server change monitor — structural diff between two
 * captured snapshots.
 *
 * A "snapshot" is a normalized JSON tree of a real provider
 * session: the request URL/method/headers/body, the response
 * status/headers/body chunks, the auth shape, etc. Snapshots
 * are produced by `scripts/devtools-capture.cjs` and saved to
 * `__tests__/snapshots/web-providers/<provider>-<timestamp>.json`.
 *
 * The diff walks both trees depth-first, collecting:
 *   - `added`: paths present in candidate but not in baseline
 *   - `removed`: paths present in baseline but not in candidate
 *   - `changed`: paths whose leaf value differs (and the values)
 *   - `breaking`: subset of `changed` whose path is in the
 *     `requiredPaths` list (fields the adapter must keep working
 *     for our integration to keep functioning)
 *
 * Why a separate module: the diff is pure logic, easy to unit
 * test. The CLI wrapper (`scripts/regression-check.cjs`) handles
 * file I/O + capture invocation. The same diff can also be
 * used by the future CI pipeline to fail builds on breaking
 * server changes.
 */

export type SnapshotNode =
  | string
  | number
  | boolean
  | null
  | undefined
  | SnapshotNode[]
  | { [key: string]: SnapshotNode };

export interface SnapshotChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface SnapshotDiffResult {
  added: string[];
  removed: string[];
  changed: SnapshotChange[];
  /** True iff any changed path is in the `requiredPaths` list. */
  breaking: boolean;
  /** The subset of `changed` that flipped a required field. */
  breakingReasons: SnapshotChange[];
}

/**
 * Walk `baseline` and `candidate` in lockstep, collecting structural
 * differences. The `path` argument tracks the current JSON-pointer-ish
 * location (e.g. 'request.headers.x-foo', 'tags[2]') for human-readable
 * output.
 *
 * `requiredPaths` is an optional list of dot-paths the integration
 * depends on. Any change to a required path flags the diff as
 * `breaking: true` and surfaces the specific field(s) that changed.
 */
export function diffSnapshot(
  baseline: SnapshotNode,
  candidate: SnapshotNode,
  requiredPaths: string[] = [],
): SnapshotDiffResult {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: SnapshotChange[] = [];

  walk(baseline, candidate, '', baseline, candidate, added, removed, changed);

  const requiredSet = new Set(requiredPaths);
  const breakingReasons = changed.filter((c) => requiredSet.has(c.path));
  return {
    added,
    removed,
    changed,
    breaking: breakingReasons.length > 0,
    breakingReasons,
  };
}

function walk(
  a: SnapshotNode,
  b: SnapshotNode,
  path: string,
  aRoot: SnapshotNode,
  bRoot: SnapshotNode,
  added: string[],
  removed: string[],
  changed: SnapshotChange[],
): void {
  // Same leaf type and equal value: no diff
  if (deepEqual(a, b)) return;

  // Type change (e.g. number → string, object → null)
  if (typeOf(a) !== typeOf(b)) {
    changed.push({ path: path || '(root)', from: a, to: b });
    return;
  }

  // Both arrays: walk by index up to min(len(a), len(b)) and
  // report added/removed tails
  if (Array.isArray(a) && Array.isArray(b)) {
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) {
      walk(a[i], b[i], `${path}[${i}]`, aRoot, bRoot, added, removed, changed);
    }
    for (let i = b.length; i < a.length; i++) {
      removed.push(`${path}[${i}]`);
    }
    for (let i = a.length; i < b.length; i++) {
      added.push(`${path}[${i}]`);
    }
    return;
  }

  // Both objects: walk keys
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    const aKeySet = new Set(aKeys);
    const bKeySet = new Set(bKeys);
    for (const k of aKeys) {
      if (!bKeySet.has(k)) {
        removed.push(joinPath(path, k));
      }
    }
    for (const k of bKeys) {
      if (!aKeySet.has(k)) {
        added.push(joinPath(path, k));
      }
    }
    for (const k of bKeys) {
      if (aKeySet.has(k)) {
        walk(
          (a as Record<string, SnapshotNode>)[k],
          (b as Record<string, SnapshotNode>)[k],
          joinPath(path, k),
          aRoot,
          bRoot,
          added,
          removed,
          changed,
        );
      }
    }
    return;
  }

  // Same primitive type but different value
  changed.push({ path: path || '(root)', from: a, to: b });
}

function isObject(v: unknown): v is Record<string, SnapshotNode> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  if (parent.endsWith(']')) return `${parent}.${child}`;
  return `${parent}.${child}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * CLI-friendly formatter: returns a human-readable summary suitable
 * for printing to stdout. The CI integration calls this and decides
 * whether to fail based on the `breaking` flag.
 */
export function formatDiffSummary(
  result: SnapshotDiffResult,
  options: { label?: string } = {},
): string {
  const lines: string[] = [];
  const label = options.label ?? 'snapshot diff';
  lines.push(`== ${label} ==`);
  lines.push(`  added (${result.added.length}): ${result.added.join(', ') || '(none)'}`);
  lines.push(`  removed (${result.removed.length}): ${result.removed.join(', ') || '(none)'}`);
  lines.push(`  changed (${result.changed.length}):`);
  for (const c of result.changed) {
    lines.push(`    ${c.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  }
  if (result.breaking) {
    lines.push(`  BREAKING (${result.breakingReasons.length}):`);
    for (const c of result.breakingReasons) {
      lines.push(`    ! ${c.path}`);
    }
  }
  return lines.join('\n');
}
