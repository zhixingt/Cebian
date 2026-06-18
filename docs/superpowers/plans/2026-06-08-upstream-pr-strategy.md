# Plan: ⑨.3 — Upstream PR to maotoumao/Cebian

> **For agentic workers:** Only do this if/when the user decides to upstream their work. Per the user's prior instruction ("不提交 PR 到 upstream"), this is OPTIONAL. Pick this up only when explicitly asked.

## Goal

Open a PR against [maotoumao/Cebian](https://github.com/maotoumao/Cebian) upstreaming the Web (Browser Session) Provider feature so other Cebian users can benefit from it.

## Prerequisites

Before opening the PR, the following must be true:

1. **Issue 1 (Stop button) is fixed** — submitting a feature with a known broken UX issue is a poor first impression
2. **⑨.2 (Multi-turn memory) is done** — the feature is not production-ready without it
3. **Code is rebased onto current upstream main** — Cebian may have moved on
4. **All tests pass on current upstream main** — no merge conflicts
5. **No credentials, tokens, or localStorage dumps in commits**

## CLA (Contributor License Agreement)

**maotoumao/Cebian does NOT require a CLA** (it's a personal fork-style repo, not an org with legal infrastructure). Verify this in their `CONTRIBUTING.md` or by asking the maintainer directly.

If they DO require a CLA (low probability but possible), the user signs it before the PR can merge. This is a personal/legal decision — the agent cannot sign on the user's behalf.

## Step-by-step procedure

### Step 1: Sync with upstream
```bash
git remote add upstream https://github.com/maotoumao/Cebian.git
git fetch upstream
git rebase upstream/main
# Resolve any conflicts; rerun full test suite
pnpm vitest run
pnpm check  # confirm 0 new errors
pnpm build  # confirm clean build
```

### Step 2: Split into reviewable PRs (NOT one mega-PR)

The Web Provider feature is too large for a single PR. Split into logical chunks:

| PR | Scope | Commits (relative to upstream/main) |
|---|---|---|
| **PR 1**: Web Provider foundation | Cookie extraction + presets + storage | ② milestones |
| **PR 2**: DOM-injection + agent integration | Content script + relay + ⑧ DOM strategy | ⑧ + ③+④ milestones |
| **PR 3**: Maintenance + 401 detection | Cleanup, stale state, session watcher | ⑤ + ⑨ Issue 2 |

Each PR should be **independently mergeable** — i.e., can land without the next one being ready. That means:
- Each PR has its own schema/storage additions (compatible with the next)
- Each PR has its own tests
- Each PR has a "what's next" note in the description

### Step 3: PR description template

```markdown
## Summary
[1-2 sentence summary of what this PR adds]

## Why
[User-facing problem this solves]

## How (architecture)
[High-level architecture diagram or text]
[Link to design doc / plan]

## Test plan
- [ ] Unit tests added (N new, full suite N total, all green)
- [ ] pnpm check: 0 new errors
- [ ] pnpm build: clean
- [ ] Manual E2E on chatglm.cn: login → chat → 401 detection

## Screenshots
[Attach: settings page, chat in action, 401 toast + Settings navigation]

## Risks
[List of known limitations, esp. pre-existing issues that aren't fixed in this PR]

## Out of scope (follow-up issues/PRs to file)
- [ ] Stop button (Issue 1)
- [ ] Multi-turn memory (⑨.2)
- [ ] Other web providers (DeepSeek, Kimi were removed; adding new ones is a separate decision)
```

### Step 4: Open the PRs

```bash
git push origin <branch-name>
gh pr create --base main --title "feat(web-provider): [short title]" --body-file .github/pr-template.md
```

### Step 5: Respond to review

Upstream may have feedback. Be ready to:
- Rebase if main moves
- Address style nits
- Split PRs further if requested
- Defend design decisions with the plan doc as evidence

## Files the upstream PR will touch (rough estimate)

- ~20 new files (web-provider-* modules)
- ~10 modified files (entrypoints, hooks, components)
- ~30 new test files
- ~5000 lines of new code total across 3 PRs

## Non-goals (explicitly NOT in the PR)

- ❌ Custom web provider support (MVP is built-in GLM only)
- ❌ Cross-device sync (Dexie is local-only)
- ❌ E2E harness CI (in `e2e/` is dev-only, can't run in upstream CI)
- ❌ Performance optimizations (current code is fast enough for single-user)

## What if upstream rejects?

Possible reasons:
- "Out of scope" — too big a feature
- "No CLA" — blocked (rare)
- "Style mismatch" — easy to fix
- "Bugs found" — defer fixes, work with maintainer

If rejected, the user can still keep the feature in their personal fork (which they already do). Upstream PR is a "nice to have" for community benefit, not a requirement.

## Effort estimate

- 1-2 days to rebase + split into 3 PRs
- 1-3 days for review cycle (depends on maintainer responsiveness)
- Total: 1-2 weeks calendar time
