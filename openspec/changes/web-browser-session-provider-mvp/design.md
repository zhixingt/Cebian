## Context

Cebian is a Chrome extension that wraps multi-provider LLM chat in a side panel. The current architecture requires every LLM provider to authenticate via API key (managed by `lib/custom-models.ts` + `components/settings/provider/`). This change adds an entirely new provider category — "Web (Browser Session)" — that authenticates by reusing the user's already-logged-in browser session to web-based AI chat services.

The design is split across 4 layers (UI / React hooks / Dexie repository / config presets). All persistence flows through Dexie; the existing `lib/db.ts` is extended with one new table on a strictly additive `version(2)` migration.

The full design rationale and code samples are committed at `docs/superpowers/specs/2026-06-03-web-browser-session-provider-design.md` (spec, 950 lines). This document captures the high-level technical decisions; refer to the spec for code-level detail.

## Goals / Non-Goals

**Goals:**
- Add a fully working Settings UI for the new provider category, with 3 built-in presets (GLM, Kimi, DeepSeek) and per-preset controls (enable, login status, model ID, capabilities)
- Persist all state in Dexie using a strictly additive schema migration (no existing data affected)
- Reserve an `encryptedCookieBundle` field on the persisted row so future milestones can add real cookie storage without schema changes
- Drive a TDD red-green cycle for all new logic: 31 unit tests covering Repository (10), useWebProviders (8), useWebProviderSimulatedLogin (6), crypto placeholder (3), WebProviderCard (4)
- Add full i18n coverage in 3 locales (en, zh_CN, zh_TW) — the project's i18n lint script enforces parity automatically
- Make the **mocked** login flow structurally identical to the future **real** login flow, so swapping is a localized, single-file change

**Non-Goals:**
- ② Real `chrome.cookies.getAll()` extraction (separate milestone)
- ③ Real encrypted IndexedDB storage via Web Crypto API (separate milestone)
- ④ Cross-origin network relay (separate milestone)
- ⑤ pi-agent-core integration (separate milestone)
- User-defined custom presets (future feature)
- Cross-tab state synchronization (YAGNI for 3 presets)
- Dexie `liveQuery` reactive subscriptions (YAGNI at this row count)

## Decisions

### 1. Four-layer architecture (UI / hooks / repository / config)

**Why:** Each layer has a single responsibility and can be replaced or extended without touching the others. The mock/real swap for the login flow is localized to one hook (Layer 2); the encryption placeholder can be filled in without touching any UI code; new presets are config-file additions without code changes.

**Alternatives considered:**
- *Two-layer (UI + repository)*: rejected — would force the mock login state to live in the repository, which makes the real-cookie swap more invasive
- *Single-layer with all logic in components*: rejected — would scatter Dexie access and mock-state management across many files, breaking encapsulation

### 2. Dexie `version(2)` with strictly additive migration

**Why:** The new `webProviders` table is added in a fresh `version(2).stores(...)` block that also re-declares the existing tables. This is Dexie's mandated pattern for safe migrations — old version blocks are never modified, and Dexie applies them in order. Existing users' chats, messages, and other tables are untouched.

**Alternatives considered:**
- *Bumping existing tables to include new fields*: rejected — would risk corrupting existing data if the existing tables had been modified by parallel branches
- *Using a separate IndexedDB database*: rejected — breaks the existing single-DB architecture and complicates the test setup

### 3. Write-then-refresh pattern in `useWebProviders`

**Why:** Every `update.*` call writes to Dexie and then calls `repo.list()` to re-read all rows. The UI always renders from a single source of truth (the Dexie fetch result). With 3 rows, the full table read is < 1ms — `Dexie.liveQuery()` would add complexity for no measurable benefit at this scale.

**Alternatives considered:**
- *Optimistic update with rollback*: rejected — over-engineered for 3 rows; rollback semantics on Dexie error add complexity without practical benefit
- *Dexie.liveQuery subscription*: deferred to a future milestone if row count grows past ~20

### 4. Encryption field reserved, but not implemented

**Why:** `WebProvider.encryptedCookieBundle: string | null` is declared in the TypeScript interface and always written as `null` in MVP. ② will fill in real AES-GCM encryption without changing the type, the Repository, the UI, or any callsite. The placeholder module `lib/ai-config/web-provider-crypto.ts` defines the public surface (3 functions) so that callers compile today.

**Alternatives considered:**
- *Implementing encryption now with hardcoded keys*: rejected — premature and potentially insecure
- *Deferring the field declaration to ②*: rejected — would force a schema migration in ② instead of using the reserved field

### 5. Decoupled hooks: `useWebProviders` + `useWebProviderSimulatedLogin`

**Why:** The CRUD hook does not know about the login flow; the login flow does not know about Dexie. They communicate via callbacks (`onSuccess`, `onFailure`). The container component (`WebProvidersSubSection`) wires them together. This makes each hook independently unit-testable, and ② replaces only the login hook internals (from simulated to real `chrome.cookies.getAll`).

**Alternatives considered:**
- *Single mega-hook doing both CRUD and login*: rejected — would mix concerns and force test setup to mock both Dexie and the login flow for every test
- *Direct repository access from the login flow*: rejected — would couple the mock to the data layer, making ② harder

### 6. shadcn primitives only — zero new components

**Why:** All UI is assembled from existing project shadcn components: `<Card>`, `<Switch>`, `<Input>`, `<Button>`, `<Badge>`, `<Skeleton>`. No new primitive is added. This minimizes merge conflicts and visual drift.

**Alternatives considered:**
- *Custom design system*: rejected — out of scope; project uses shadcn
- *Building a generic "ProviderCard" that handles API Key / OAuth / Web*: deferred to a future refactor; not justified by current cardinality (3 cards)

### 7. `useRef`-backed in-flight lock for `useWebProviderSimulatedLogin`

**Why:** The lock uses `useRef` (synchronous, no re-render) rather than `useState` (asynchronous, triggers render). A `useState` lock would race with the React batching model, allowing two simultaneous recheck calls to slip through. The state-based `checkingId` is used separately for UI display, which is the right use of `useState`.

**Alternatives considered:**
- *State-based lock only*: rejected — race conditions under double-click
- *External mutex (e.g., a singleton in the module scope)*: rejected — over-engineered; `useRef` is sufficient

### 8. i18n: 3 locales, lint-enforced parity

**Why:** The project already has a pre-commit i18n lint script (`scripts/lint-i18n.mjs`) that enforces (a) all top-level keys match an allow-list, (b) full key parity across en/zh_CN/zh_TW, (c) no hard-coded Chinese in source. By adding the new `webProviders` namespace to all three locale files plus the allow-list, we get parity enforcement for free at every commit. No custom tooling is needed.

**Alternatives considered:**
- *English-only with translation deferred*: rejected — the lint script would block pre-commit hooks
- *Adding a 4th locale (e.g., ja)*: rejected — out of scope; the project's existing 3-locale policy is enforced by the lint

## Risks / Trade-offs

- **Dexie schema conflicts with parallel branches** — Mitigation: PR review should check that `lib/db.ts` hasn't been touched in `master` since this branch started. If it has, rebase and re-test.
- **`fake-indexeddb` Node compatibility** — Mitigation: Task 0 (env verification) catches this before any production code is written. Fallback: `mem-indexeddb` or `indexeddb-shim`.
- **I18n key naming mismatch with project convention** — Mitigation: The project's `.agents/skills/i18n-naming/SKILL.md` should be read during implementation; the design doc used `webProviders.presets.glm.name` style which matches the project's existing `settings.providers.title` nesting convention. If the convention differs, fix the keys before Task 6 (i18n additions) is marked done.
- **`@earendil-works/pi-ai` already has a "web session" abstraction** — Mitigation: Task 0 should check the pi-ai API documentation. If a suitable abstraction exists, we should integrate with it rather than re-implement. The MVP's architecture is designed to make this swap painless.
- **No visual regression coverage** — Mitigation: Task 14 (manual verification) walks through the 12 acceptance criteria with the loaded extension. Future milestones can add Playwright screenshot tests if needed.
- **Pre-commit hook blocks commits during local development** — The hook runs `pnpm run check` (TS + i18n). If a commit is blocked, fix the lint/TS error before retrying. Do not bypass with `--no-verify`.

## Migration Plan

**For users with an existing Cebian install:**
- Dexie's additive `version(2)` migration runs automatically on extension upgrade
- All existing data (chats, messages, skills, OAuth tokens, etc.) is preserved
- The new "Web (Browser Session)" section appears empty for users who haven't logged in to any of the 3 supported sites; the 3 preset rows are auto-seeded on first `WebProvidersSubSection` mount
- **No user action required** for the upgrade itself

**For developers:**
- Pull the branch, run `pnpm install`, then `pnpm run check` to verify
- Run `pnpm test` to confirm 31 new tests pass
- Optional: load `.output/chrome-mv3/` in Chrome via `chrome://extensions` to manually verify the 12 acceptance criteria

**Rollback strategy:**
- The new Dexie table is purely additive; reverting the code does not lose data
- If a future bug corrupts `webProviders` rows, users can clear them via the Dexie DevTools or by reinstalling the extension
- No production data dependencies on this table exist until ② ships

## Open Questions

None at the time of writing. All design questions raised during brainstorming have been resolved. Implementation subagents will surface any new sub-decisions (e.g., exact shadcn variants, project-specific i18n convention) as they encounter them; the plan is structured to handle these inline.
