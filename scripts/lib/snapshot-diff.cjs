/* eslint-disable */
/**
 * ⑨.2: Hand-written CJS mirror of
 * `lib/ai-config/web-provider-snapshot-diff.ts`. Kept in sync
 * manually because `regression-check.cjs` is a CJS script that
 * runs before the build pipeline, and we don't want to require
 * a TS compile just to read snapshots.
 *
 * The test `__tests__/lib/ai-config/web-provider-snapshot-diff.test.ts`
 * covers the TS source. If you change either file, change both.
 * A future PR can replace this with `node --import tsx/esm scripts/...`
 * to drop the duplication.
 */

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function joinPath(parent, child) {
  if (!parent) return child;
  if (parent.endsWith(']')) return `${parent}.${child}`;
  return `${parent}.${child}`;
}

function deepEqual(a, b) {
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
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function walk(a, b, path, added, removed, changed) {
  if (deepEqual(a, b)) return;
  if (typeOf(a) !== typeOf(b)) {
    changed.push({ path: path || '(root)', from: a, to: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) {
      walk(a[i], b[i], `${path}[${i}]`, added, removed, changed);
    }
    for (let i = b.length; i < a.length; i++) {
      removed.push(`${path}[${i}]`);
    }
    for (let i = a.length; i < b.length; i++) {
      added.push(`${path}[${i}]`);
    }
    return;
  }
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    const aKeySet = new Set(aKeys);
    const bKeySet = new Set(bKeys);
    for (const k of aKeys) {
      if (!bKeySet.has(k)) removed.push(joinPath(path, k));
    }
    for (const k of bKeys) {
      if (!aKeySet.has(k)) added.push(joinPath(path, k));
    }
    for (const k of bKeys) {
      if (aKeySet.has(k)) walk(a[k], b[k], joinPath(path, k), added, removed, changed);
    }
    return;
  }
  changed.push({ path: path || '(root)', from: a, to: b });
}

function diffSnapshot(baseline, candidate, requiredPaths) {
  const added = [];
  const removed = [];
  const changed = [];
  walk(baseline, candidate, '', added, removed, changed);
  const requiredSet = new Set(requiredPaths || []);
  const breakingReasons = changed.filter((c) => requiredSet.has(c.path));
  return {
    added,
    removed,
    changed,
    breaking: breakingReasons.length > 0,
    breakingReasons,
  };
}

function formatDiffSummary(result, options) {
  const lines = [];
  const label = (options && options.label) || 'snapshot diff';
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

module.exports = { diffSnapshot, formatDiffSummary };
