#!/usr/bin/env node
/* eslint-disable */
/**
 * 9.2 server change monitor — CLI wrapper around snapshot diff.
 *
 * Two modes:
 *
 * 1. DEFAULT (--baseline <path> --candidate <path>)
 *    Compare two snapshot files, print the diff, exit 1 if breaking.
 *    This is the path CI would use once a baseline is committed.
 *
 *    Example:
 *      node scripts/regression-check.cjs \
 *        --baseline __tests__/snapshots/web-providers/deepseek-2026-06-01.json \
 *        --candidate __tests__/snapshots/web-providers/deepseek-2026-06-05.json
 *
 * 2. --dir <path> (--provider <id>)
 *    Find the two most recent snapshots for a given provider in a
 *    directory, compare them, exit 1 if breaking. This is the
 *    "what changed since the last capture" mode.
 *
 *    Example:
 *      node scripts/regression-check.cjs \
 *        --dir __tests__/snapshots/web-providers \
 *        --provider deepseek
 *
 * For both modes, exit codes follow the convention:
 *   0 = no diff OR non-breaking diff (cosmetic additions/removed)
 *   1 = breaking change detected (one of the `requiredPaths` flipped)
 *   2 = invocation error (missing files, bad JSON, etc.)
 *
 * The requiredPaths are hard-coded per provider because the diff
 * tool itself is provider-agnostic. To extend: add a new entry to
 * the REQUIRED_PATHS map below when you add a new web provider.
 */

const fs = require('node:fs');
const path = require('node:path');

// We can't `import` the TS module directly from CJS — use a tiny
// child process or read+JSON.parse the test file? The simplest path
// is to inline the diff logic (it's small). But duplication is bad.
// Instead, we shell out to a small TS shim that vitest already loads
// the module for. Or: use the `tsx` runner we may already have.
//
// For now, the script loads the compiled diff via dynamic require
// from `node_modules/.bin/...` -- but that's a build step.
//
// 9.2: we keep this script self-contained by importing the diff
// logic from a JS port in `scripts/lib/snapshot-diff.mjs` (the TS
// module is compiled by `pnpm build` into .output/).
//
// ⑨.2: the canonical, version-controlled source is the TS module
// `lib/ai-config/web-provider-snapshot-diff.ts`. The .mjs shim is
// a hand-written mirror that matches it line-for-line. Whenever
// the TS source changes, this file must be updated to match.
// (We have a test that catches drift; see the README in
// __tests__/snapshots/web-providers/.)
const { diffSnapshot, formatDiffSummary } = require('./lib/snapshot-diff.cjs');

// Per-provider required fields. A change to any of these paths
// flips `breaking: true` and causes the script to exit 1.
// Keep this in sync with the field names the adapters read.
const REQUIRED_PATHS = {
  // ⑪.2 DeepSeek adapter reads: chat_session_id, parent_message_id,
  // PoW challenge, x-ds-pow-response header, Authorization Bearer.
  deepseek: [
    'request.headers.Authorization',
    'request.headers.x-ds-pow-response',
    'request.body.chat_session_id',
    'request.body.parent_message_id',
    'request.body.prompt',
    'response.status',
  ],
  // ⑪.1 GLM adapter reads: conversation_id, messages[].content[].text,
  // X-Sign, X-Nonce, X-Timestamp, Authorization Bearer.
  glm: [
    'request.headers.Authorization',
    'request.headers.X-Sign',
    'request.headers.X-Nonce',
    'request.headers.X-Timestamp',
    'request.body.conversation_id',
    'response.status',
  ],
};

function parseArgs(argv) {
  const args = { provider: null, baseline: null, candidate: null, dir: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--candidate') args.candidate = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--provider') args.provider = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  regression-check.cjs --baseline <path> --candidate <path> [--provider <id>]
  regression-check.cjs --dir <path> [--provider <id>]

Compares two web-provider snapshot JSON files and exits 1 if a
required field changed. See REQUIRED_PATHS in this script for
the field set per provider.

Exit codes:
  0  no breaking changes
  1  breaking change detected
  2  invocation error (missing file, bad JSON, etc.)
`);
}

function readSnapshot(file) {
  if (!fs.existsSync(file)) {
    console.error(`Snapshot not found: ${file}`);
    process.exit(2);
  }
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`Failed to read ${file}:`, e.message);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse ${file} as JSON:`, e.message);
    process.exit(2);
  }
}

/**
 * Find the two most recent snapshots for a provider in `dir`.
 * Filenames are expected to be `<provider>-<iso-timestamp>.json`.
 * Returns { latest, previous } or { latest: null } if < 2 files.
 */
function findLatestPair(dir, provider) {
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(2);
  }
  const prefix = provider ? `${provider}-` : '';
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && (!prefix || f.startsWith(prefix)))
    .sort();
  if (files.length < 2) {
    console.error(
      `Need at least 2 snapshots in ${dir}${
        provider ? ` for provider ${provider}` : ''
      } (found ${files.length})`,
    );
    process.exit(2);
  }
  return {
    latest: path.join(dir, files[files.length - 1]),
    previous: path.join(dir, files[files.length - 2]),
  };
}

function main() {
  const args = parseArgs(process.argv);
  let baselinePath, candidatePath, providerId;
  if (args.dir) {
    const pair = findLatestPair(args.dir, args.provider);
    baselinePath = pair.previous;
    candidatePath = pair.latest;
    // Try to infer provider from the filename: deepseek-2026-06-01.json → deepseek
    const m = path.basename(candidatePath).match(/^([^-]+)-/);
    providerId = args.provider ?? m?.[1] ?? null;
  } else if (args.baseline && args.candidate) {
    baselinePath = args.baseline;
    candidatePath = args.candidate;
    providerId = args.provider;
  } else {
    printHelp();
    process.exit(2);
  }

  const baseline = readSnapshot(baselinePath);
  const candidate = readSnapshot(candidatePath);
  const requiredPaths = providerId ? REQUIRED_PATHS[providerId] ?? [] : [];
  const result = diffSnapshot(baseline, candidate, requiredPaths);

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const label = `${path.basename(baselinePath)} → ${path.basename(candidatePath)}${
      providerId ? ` (${providerId})` : ''
    }`;
    process.stdout.write(formatDiffSummary(result, { label }) + '\n');
  }

  process.exit(result.breaking ? 1 : 0);
}

main();
