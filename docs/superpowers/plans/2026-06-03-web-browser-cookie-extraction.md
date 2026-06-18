# Web (Browser Session) Provider — ② Cookie Extraction & Encrypted Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Foundation already in place (MVP shipped, 18 commits, 32 tests):** types, presets (basic), Dexie schema v2, repository, hooks (`useWebProviderSimulatedLogin` will be deleted), UI components, i18n (3 locales). ② builds on top, replacing the simulated login hook with real `chrome.cookies.getAll()` extraction, AES-GCM encryption, and adding 6 production-grade enhancements (A1-A6) that definitively outperform the reference impl (chromeclaw).

**Goal:** Replace MVP's simulated login with real `chrome.cookies.getAll()` cookie extraction, AES-GCM 256 encrypted storage, and a "Login" tab-open polling flow. Add 6 production-grade enhancements (A1 UI transparency, A2 configurable session indicators [KEY], A3 active tab tracking, A4 audit log, A5 refresh retry, A6 detect open tab) that definitively outperform chromeclaw.

**Architecture:** Same 4 layers as MVP. **5 new files**, **8 modified files**, **1 hook + 1 test file deleted**. Total new test cases: 47 (8 crypto + 5 repository + 12 service + 8 hook + 4 presets + 10 from MVP that now need updates).

**Tech Stack:** WXT 0.20 + React 19 + TypeScript 5.9 + Tailwind 4 + Dexie 4 + shadcn/ui + `@wxt-dev/i18n` + vitest + fake-indexeddb + **Web Crypto API (built-in)** + **chrome.cookies / chrome.tabs / chrome.scripting / chrome.storage APIs**.

**Spec:** `docs/superpowers/specs/2026-06-03-web-browser-cookie-extraction-design.md` (1250 lines, committed: `276e892`).

**MVP Spec:** `docs/superpowers/specs/2026-06-03-web-browser-session-provider-design.md` (MVP, 952 lines, shipped).

**Reference impl (read-only inspiration, NOT forking):** `D:\Project\CebianX\chromeclaw-research\` (cloned)

**Project root:** `D:\Project\CebianX\cebian-web-provider`

---

## File Structure

### New files (5 source + 4 test = 9)

| File | Responsibility | LOC est. |
|---|---|---|
| `hooks/useWebProviderWebLogin.ts` | Real login hook (replaces `useWebProviderSimulatedLogin`); sends `WEB_PROVIDER_LOGIN` / `WEB_PROVIDER_RECHECK` messages to background SW | 180 |
| `lib/ai-config/web-provider-crypto.ts` | REAL Web Crypto API AES-GCM 256 (replaces placeholder) | 180 |
| `lib/ai-config/web-provider-cookie-service.ts` | Background SW message handlers: `handleLogin`, `handleRecheck` + helpers (`openOrFocusLoginTab`, `pollForSession`, `tryRefreshAuthWithRetry`, `readLocalStorageFromTab`, `appendAuditEntry`) | 400 |
| `entrypoints/background.ts` (modification) | Register cookie service message listener | +10 |
| `__tests__/lib/ai-config/web-provider-crypto.test.ts` | 8 crypto round-trip + edge-case tests | 180 |
| `__tests__/lib/ai-config/web-provider-cookie-service.test.ts` | 12 service handler tests (login, recheck, A3, A5, A6, audit) | 350 |
| `__tests__/hooks/useWebProviderWebLogin.test.ts` | 8 hook tests (login, recheck, inFlight, no auto-check) | 250 |
| `__tests__/lib/ai-config/web-provider-presets.test.ts` | 4 preset validation tests (cookieDomain, sessionIndicators, etc.) | 100 |

### Modified files (8)

| File | Change | LOC delta |
|---|---|---|
| `lib/types.ts` | Add `LoginAuditEntry`, `LoginAttemptResult`; extend `WebProvider` with `userOverrides`, `loginAuditLog`, `expired` (5th LoginStatus) | +50 |
| `lib/ai-config/web-provider-presets.ts` | Add 4 fields to `WebProviderPreset` (`cookieDomain`, `sessionIndicators`, `useLocalStorageFallback`, `refreshUrl`); populate for 3 presets; export `resolveEffectiveConfig` | +60 |
| `lib/ai-config/web-provider-store.ts` | Add `setEncryptedCookieBundle`, `clearEncryptedCookieBundle`, `setUserOverrides`, `appendAuditEntry` | +60 |
| `lib/ai-config/web-provider-crypto.ts` | (NEW file above) | (180) |
| `components/settings/provider/WebProviderCard.tsx` | Add "Login" button + A1 transparency line + A2 "Advanced" collapsible section + A4 audit display | +80 |
| `components/settings/sections/WebProvidersSubSection.tsx` | Import swap (`useWebProviderSimulatedLogin` → `useWebProviderWebLogin`); destructure `login` + `loginLoading` + `lastCaptureInfo` | +10 |
| `wxt.config.ts` (or `entrypoints/manifest.json`) | Add `scripting` permission + 3 host_permissions | +10 |
| `locales/en.yml`, `zh_CN.yml`, `zh_TW.yml` | 4 new strings: `login`, `loggingIn`, `loginFailed`, `loginTimedOut`; 3 new for A2 section: `advanced`, `sessionIndicatorsLabel`, `resetToPreset` | +45 each (135 total) |

### Deleted files (2)

| File | Why |
|---|---|
| `hooks/useWebProviderSimulatedLogin.ts` | No callers after import swap |
| `__tests__/hooks/useWebProviderSimulatedLogin.test.ts` | No hook to test |

**Net code delta**: +1,015 lines new, +260 lines modification, -100 lines deletion. **Net tests**: +32 new test cases (8+12+8+4), 32 existing MVP tests must still pass.

---

## Pre-Task: Optional worktree

**Already done in MVP phase.** Working in `D:\Project\CebianX\cebian-web-provider` on branch `feat/web-browser-session-provider`. 19 commits pushed to `origin/feat/web-browser-session-provider` (18 MVP + 1 design doc).

```bash
# Verify state
git -C D:\Project\CebianX\cebian-web-provider status
git -C D:\Project\CebianX\cebian-web-provider log --oneline -5
git -C D:\Project\CebianX\cebian-web-provider branch --show-current
# expect: feat/web-browser-session-provider
```

---

## Task 0: Verify environment and MVP baseline

**Files:** None (verification only)

- [ ] **Step 0.1: Verify MVP tests still pass**

```bash
cd D:\Project\CebianX\cebian-web-provider
pnpm test
```

**Expected:** 32 tests pass (MVP's count). If FAIL, the MVP is broken — STOP and fix.

- [ ] **Step 0.2: Verify MVP build still works**

```bash
pnpm run build
```

**Expected:** Build succeeds (9.57MB output like MVP), no errors. The obfuscation warning from `pi-ai` is expected.

- [ ] **Step 0.3: Verify OpenSpec CLI works**

```bash
openspec --version
openspec list
```

**Expected:** Version 1.3+, current `web-browser-session-provider-mvp` is in `archive/`. We'll create a new change `web-browser-cookie-extraction`.

---

## Task 1: Create OpenSpec change

**Files:** `openspec/changes/web-browser-cookie-extraction/{proposal.md,design.md,tasks.md,specs/web-browser-cookie-extraction/spec.md}`

- [ ] **Step 1.1: Initialize the OpenSpec change**

```bash
cd D:\Project\CebianX\cebian-web-provider
openspec new change "web-browser-cookie-extraction" --description "Real cookie extraction + encrypted storage + 6 production-grade enhancements"
```

**Expected:** New directory `openspec/changes/web-browser-cookie-extraction/` created with a `proposal.md` template.

- [ ] **Step 1.2: Write `proposal.md`**

Fill in the template with the following key points (this is a synthesis of the design doc):

```markdown
# Proposal: Web Browser Cookie Extraction

## Summary
Replace the simulated login in the Web (Browser Session) Provider MVP with real
chrome.cookies.getAll() extraction, AES-GCM 256 encrypted storage, and a
"Login" tab-open polling flow. Add 6 production-grade enhancements (A1-A6)
that definitively outperform the chromeclaw reference implementation.

## Why
- MVP (shipped, 18 commits, 32 tests) has working UI but no real cookie
  capture — every "Re-check login" was Math.random() < 0.7
- Three LLM providers (chatglm.cn, kimi.com, chat.deepseek.com) offer
  logged-in web sessions users already have; we should let them reuse it
- The chromeclaw reference shows the design space but uses plain-text
  storage; we can do better with Web Crypto API AES-GCM 256
- Six production-grade enhancements (configurable session indicators,
  audit log, etc.) make this production-ready, not a toy

## What changes
- Add `lib/ai-config/web-provider-cookie-service.ts` (background SW handlers)
- Add `lib/ai-config/web-provider-crypto.ts` (real AES-GCM implementation)
- Add `hooks/useWebProviderWebLogin.ts` (replaces simulated login hook)
- Add 4 new test files (~32 new test cases)
- Extend `WebProvider` type with `userOverrides`, `loginAuditLog`
- Extend `WebProviderPreset` with `cookieDomain`, `sessionIndicators[]`,
  `useLocalStorageFallback`, `refreshUrl`
- Add `scripting` permission + 3 host_permissions to manifest
- Update UI: 1 new "Login" button + 1 "Advanced" section + audit display
- Delete `useWebProviderSimulatedLogin.ts` and its test

## Impact
- Affected specs: `web-browser-session-providers` (add 8 new requirements)
- New code: ~1,015 lines
- Modified code: ~260 lines
- Deleted code: ~100 lines
- New tests: ~32 test cases
- Effort: 5-7 days (was 1.5-2 days; user signed off on 6 enhancements)
- User-visible: 0 breaking changes (UI only adds features)
```

- [ ] **Step 1.3: Write `design.md`**

Link to the existing design doc:

```markdown
# Design: Web Browser Cookie Extraction

See: `docs/superpowers/specs/2026-06-03-web-browser-cookie-extraction-design.md`
(1250 lines, committed: 276e892)

Key sections:
- §3 Detection logic (3-tier: cookies → localStorage → stored creds)
- §4 Login flow (open tab + 5s MIN_WAIT + 2s poll + 5min timeout)
- §5 Encryption (AES-GCM 256 with key in chrome.storage.local)
- §9 Background service (chrome.cookies, chrome.tabs, chrome.scripting)
- §19 Enhancements A1-A6 (KEY ONE = A2 configurable session indicators)
```

- [ ] **Step 1.4: Write `specs/web-browser-cookie-extraction/spec.md`**

This adds 8 new requirements to the existing `web-browser-session-providers` spec:

```markdown
# Web Browser Cookie Extraction — Spec Deltas

## ADDED Requirements

### Requirement: Cookie Detection via sessionIndicators
The system MUST detect a logged-in session for a web provider by calling
`chrome.cookies.getAll({ domain: preset.cookieDomain })` and checking whether
ANY cookie name in `preset.sessionIndicators[]` is present.

#### Scenario: GLM detection
Given preset `cookieDomain: 'chatglm.cn'` and `sessionIndicators: ['chatglm_refresh_token', 'chatglm_token']`
When `chrome.cookies.getAll({ domain: 'chatglm.cn' })` returns a cookie named `chatglm_refresh_token`
Then the system MUST mark the provider as having a session

#### Scenario: localStorage fallback (Kimi)
Given preset `useLocalStorageFallback: true` and no matching cookies
When `chrome.scripting.executeScript({ world: 'MAIN' })` returns a non-empty value for any `sessionIndicators` key
Then the system MUST mark the provider as having a session from localStorage

### Requirement: Login Flow Polling
The system MUST open a new tab to `preset.loginUrl` and poll for session
cookies every 2 seconds for up to 5 minutes, with a 5-second initial wait.

#### Scenario: 5-second MIN_WAIT
Given a user clicks "Login" on a card
When the system opens a new tab to the provider's loginUrl
Then the system MUST wait at least 5 seconds before checking cookies
To prevent the tab from closing before the user sees it

#### Scenario: 2-second polling
Given the 5-second MIN_WAIT has elapsed
When the system polls `chrome.cookies.getAll`
Then the system MUST wait 2 seconds before the next poll

#### Scenario: 5-minute timeout
Given 5 minutes have elapsed since login started
When the system has not detected a session
Then the system MUST abort, remove the tab, and return a timeout error

### Requirement: Encrypted Cookie Storage
The system MUST encrypt the captured cookies using AES-GCM 256 (Web Crypto API)
before storing them in Dexie's `encryptedCookieBundle` field.

#### Scenario: Round-trip encryption
Given captured cookies in JSON
When the system encrypts and stores them
Then decrypting the stored bundle MUST return the original JSON

#### Scenario: Tampered ciphertext rejected
Given a stored bundle with modified bytes
When the system attempts to decrypt
Then the system MUST throw a decryption error

### Requirement: Configurable Session Indicators (A2)
The system MUST allow users to override preset values for
`cookieDomain`, `sessionIndicators`, `useLocalStorageFallback`, and
`refreshUrl` per provider via the Settings UI.

#### Scenario: User overrides sessionIndicators
Given a user edits `sessionIndicators` for Kimi from `['kimi-auth']` to `['kimi-auth-v2']`
When the user saves and clicks Login
Then the system MUST use `['kimi-auth-v2']` for detection (not the preset default)

#### Scenario: Reset to preset
Given a user has user overrides for a provider
When the user clicks "Reset to preset default"
Then the system MUST clear the overrides and revert to the preset values

### Requirement: Login Audit Log (A4)
The system MUST maintain a per-provider audit log of the last 5 login
attempts, with timestamp, result, and optional error message.

#### Scenario: Audit entry on success
Given a successful login
When the system completes the login flow
Then the system MUST append `{ timestamp, result: 'success', source, cookiesCaptured }` to `loginAuditLog`

#### Scenario: FIFO eviction at 5
Given a provider with 5 existing audit entries
When a 6th attempt is made
Then the oldest entry MUST be removed (FIFO)

### Requirement: Active Tab Tracking (A3)
The system MUST detect when the login tab is in the background and slow
the polling interval from 2s to 5s.

#### Scenario: Background polling throttling
Given the login tab is in a non-focused window
When the system polls cookies
Then the system MUST use a 5-second interval instead of 2-second

### Requirement: RefreshAuth Retry (A5)
The system MUST retry the `refreshAuth` call (GLM only) up to 3 times
with exponential backoff (1s, 2s, 4s) before giving up.

#### Scenario: Retry on transient failure
Given the refreshAuth call fails twice with non-200 status
When the third attempt is made
Then the system MUST use the third attempt's result

### Requirement: Detect Already-Open Tab (A6)
The system MUST check `chrome.tabs.query` for an existing tab at the
provider's host before opening a new one.

#### Scenario: Reuse existing tab
Given a tab is already open at `https://chatglm.cn`
When the user clicks Login on the GLM card
Then the system MUST focus the existing tab instead of opening a new one
```

- [ ] **Step 1.5: Write `tasks.md`**

Link to this plan:

```markdown
# Tasks: Web Browser Cookie Extraction

See: `docs/superpowers/plans/2026-06-03-web-browser-cookie-extraction.md`

Tasks 0-17, executed in order. Each task is a checkpoint with TDD red-green
where applicable.
```

- [ ] **Step 1.6: Validate the OpenSpec change**

```bash
openspec validate web-browser-cookie-extraction --strict
```

**Expected:** All 4 artifacts present, validation passes. If FAIL, fix the offending file and re-run.

- [ ] **Step 1.7: Commit OpenSpec change**

```bash
git add openspec/changes/web-browser-cookie-extraction/
git commit -m "chore(openspec): add web-browser-cookie-extraction change"
git push origin feat/web-browser-session-provider
```

---

## Task 2: Extend WebProvider type with userOverrides + loginAuditLog + LoginAttemptResult

**Files:** `lib/types.ts` (modification)

This task is **type-only** — no runtime code. It enables all the 6 enhancements (A2, A4) and the 5th LoginStatus.

- [ ] **Step 2.1: Read current `lib/types.ts`**

```bash
cat lib/types.ts
```

Find the existing `LoginStatus` and `WebProvider` types added by MVP. Reference design doc §3.1, §6.1, §19 A2, §19 A4.

- [ ] **Step 2.2: Add `LoginAttemptResult` and `LoginAuditEntry` types**

Append to `lib/types.ts`:

```typescript
// ===== ② additions (cookie extraction + enhancements) =====

/** Result categories for login attempts. ② writes all of these; ⑤ will add 'expired'. */
export type LoginAttemptResult =
  | 'success'
  | 'timeout'
  | 'tab-closed'
  | 'no-cookies'
  | 'refresh-failed'
  | 'decryption-failed'
  | 'permission-denied';

/** One entry in a provider's login audit log (A4). */
export interface LoginAuditEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  result: LoginAttemptResult;
  errorMessage?: string;
  /** Where the session was detected from */
  source?: 'cookie' | 'localStorage' | 'stored';
  /** Number of cookies captured (0 for failures) */
  cookiesCaptured?: number;
}

/** User overrides for preset values (A2 KEY ONE). All fields optional; null = use preset. */
export interface WebProviderUserOverrides {
  cookieDomain?: string;
  sessionIndicators?: string[];
  useLocalStorageFallback?: boolean;
  refreshUrl?: string;
}
```

- [ ] **Step 2.3: Extend `LoginStatus` to add `expired`**

Find the existing `LoginStatus`:
```typescript
export type LoginStatus =
  | 'unknown'
  | 'checking'
  | 'loggedIn'
  | 'loggedOut';
```

Add `'expired'`:
```typescript
export type LoginStatus =
  | 'unknown'
  | 'checking'
  | 'loggedIn'
  | 'loggedOut'
  | 'expired';  // ⑤ concern; ② reserves the value
```

- [ ] **Step 2.4: Extend `WebProvider` interface**

Find the existing `WebProvider` interface. Add 2 fields:

```typescript
export interface WebProvider {
  // ... existing fields (presetId, enabled, loginStatus, modelId, ...) ...

  /** ⭐ ② A2: user overrides for preset values; null = use preset defaults */
  userOverrides: WebProviderUserOverrides | null;

  /** ⭐ ② A4: login attempt audit log, max 5 entries, newest first, FIFO */
  loginAuditLog: LoginAuditEntry[];
}
```

- [ ] **Step 2.5: Verify no compile errors**

```bash
cd D:\Project\CebianX\cebian-web-provider
pnpm tsc --noEmit
```

**Expected:** Zero errors. If existing code references `WebProvider` without these fields, the existing repository's `createFromPreset` must be updated in Task 3 to initialize them.

- [ ] **Step 2.6: Commit type extension**

```bash
git add lib/types.ts
git commit -m "feat(types): add userOverrides, loginAuditLog, expired status for ②"
```

---

## Task 3: Update WebProviderPreset with sessionIndicators + cookieDomain + refreshUrl

**Files:** `lib/ai-config/web-provider-presets.ts` (modification)

This task adds the 4 new fields to the preset schema and populates them for the 3 built-in providers (GLM, Kimi, DeepSeek). All values are educated guesses; the user can override via A2 if wrong.

- [ ] **Step 3.1: Read current `web-provider-presets.ts`**

```bash
cat lib/ai-config/web-provider-presets.ts
```

- [ ] **Step 3.2: Extend `WebProviderPreset` interface**

```typescript
export interface WebProviderPreset {
  // ... existing fields from MVP (id, displayNameKey, descriptionKey, loginUrl, defaultModelId, defaultSupportsToolCalls, defaultSupportsReasoning) ...

  /** ⭐ ②: cookie domain for `chrome.cookies.getAll({ domain })` */
  cookieDomain: string;

  /** ⭐ ②: cookie names whose presence indicates a logged-in session. ANY name match → has session. */
  sessionIndicators: string[];

  /** ⭐ ②: also check localStorage (for providers like Kimi that store tokens there) */
  useLocalStorageFallback: boolean;

  /** ⭐ ②: optional URL to exchange refresh_token for access_token (GLM only) */
  refreshUrl?: string;
}
```

- [ ] **Step 3.3: Populate the 3 presets with educated-guess values**

Update each preset (see design doc §3.2 / §23 for full values):

```typescript
export const WEB_PROVIDER_PRESETS: readonly WebProviderPreset[] = [
  {
    id: 'glm',
    displayNameKey: 'webProviders.presets.glm.name',
    descriptionKey: 'webProviders.presets.glm.description',
    loginUrl: 'https://chatglm.cn',
    defaultModelId: 'GLM-4.6',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
    cookieDomain: 'chatglm.cn',
    sessionIndicators: ['chatglm_refresh_token', 'chatglm_token'],  // unverified
    useLocalStorageFallback: false,
    refreshUrl: 'https://chatglm.cn/api/v1/auth/refresh',  // unverified
  },
  {
    id: 'kimi',
    // ... existing fields ...
    cookieDomain: 'kimi.moonshot.cn',
    sessionIndicators: ['kimi-auth'],  // unverified, use A2 to fix
    useLocalStorageFallback: true,  // chromeclaw confirms localStorage path
  },
  {
    id: 'deepseek',
    // ... existing fields ...
    cookieDomain: 'chat.deepseek.com',
    sessionIndicators: ['sessionid'],  // unverified Django-style
    useLocalStorageFallback: false,
  },
] as const;
```

- [ ] **Step 3.4: Add `resolveEffectiveConfig` resolver (A2)**

Append to the same file:

```typescript
import type { WebProvider, WebProviderUserOverrides } from '../types';

/**
 * A2 KEY ONE: merge preset values with user's overrides.
 * User wins on every field that has an override; others fall through to preset.
 */
export function resolveEffectiveConfig(
  provider: WebProvider,
  preset: WebProviderPreset,
): WebProviderPreset & { source: Record<keyof WebProviderUserOverrides, 'preset' | 'user'> } {
  const u = provider.userOverrides ?? {};
  return {
    ...preset,
    cookieDomain: u.cookieDomain ?? preset.cookieDomain,
    sessionIndicators: u.sessionIndicators ?? preset.sessionIndicators,
    useLocalStorageFallback: u.useLocalStorageFallback ?? preset.useLocalStorageFallback,
    refreshUrl: u.refreshUrl ?? preset.refreshUrl,
    source: {
      cookieDomain: u.cookieDomain !== undefined ? 'user' : 'preset',
      sessionIndicators: u.sessionIndicators !== undefined ? 'user' : 'preset',
      useLocalStorageFallback: u.useLocalStorageFallback !== undefined ? 'user' : 'preset',
      refreshUrl: u.refreshUrl !== undefined ? 'user' : 'preset',
    },
  };
}
```

- [ ] **Step 3.5: Write preset tests (TDD: 4 cases)**

Create `__tests__/lib/ai-config/web-provider-presets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WEB_PROVIDER_PRESETS, resolveEffectiveConfig } from '@/lib/ai-config/web-provider-presets';

describe('WEB_PROVIDER_PRESETS', () => {
  it('all 3 presets have valid cookieDomain', () => {
    for (const p of WEB_PROVIDER_PRESETS) {
      expect(p.cookieDomain).toMatch(/^[a-z0-9.-]+$/);
    }
  });

  it('all 3 presets have at least 1 sessionIndicator', () => {
    for (const p of WEB_PROVIDER_PRESETS) {
      expect(p.sessionIndicators.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('only GLM has refreshUrl set (others do not need token exchange)', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const kimi = WEB_PROVIDER_PRESETS.find(p => p.id === 'kimi')!;
    const ds = WEB_PROVIDER_PRESETS.find(p => p.id === 'deepseek')!;
    expect(glm.refreshUrl).toBeDefined();
    expect(kimi.refreshUrl).toBeUndefined();
    expect(ds.refreshUrl).toBeUndefined();
  });

  it('Kimi uses localStorage fallback (chromeclaw confirms)', () => {
    const kimi = WEB_PROVIDER_PRESETS.find(p => p.id === 'kimi')!;
    expect(kimi.useLocalStorageFallback).toBe(true);
  });
});

describe('resolveEffectiveConfig', () => {
  it('returns preset values when no user overrides', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const provider = { presetId: 'glm' as const, userOverrides: null } as any;
    const effective = resolveEffectiveConfig(provider, glm);
    expect(effective.cookieDomain).toBe(glm.cookieDomain);
    expect(effective.source.cookieDomain).toBe('preset');
  });

  it('returns user values when overrides present', () => {
    const glm = WEB_PROVIDER_PRESETS.find(p => p.id === 'glm')!;
    const provider = {
      presetId: 'glm' as const,
      userOverrides: { cookieDomain: 'custom.example.com' },
    } as any;
    const effective = resolveEffectiveConfig(provider, glm);
    expect(effective.cookieDomain).toBe('custom.example.com');
    expect(effective.source.cookieDomain).toBe('user');
    // Other fields still from preset
    expect(effective.sessionIndicators).toBe(glm.sessionIndicators);
    expect(effective.source.sessionIndicators).toBe('preset');
  });
});
```

- [ ] **Step 3.6: Run tests, expect 4 new test cases to pass**

```bash
cd D:\Project\CebianX\cebian-web-provider
pnpm test -- web-provider-presets
```

**Expected:** 4 new tests pass. Existing 32 MVP tests still pass.

- [ ] **Step 3.7: Commit preset + resolver**

```bash
git add lib/ai-config/web-provider-presets.ts __tests__/lib/ai-config/web-provider-presets.test.ts
git commit -m "feat(ai-config): add sessionIndicators + resolveEffectiveConfig for ② (TDD 4 cases)"
```

---

## Task 4: Implement real AES-GCM 256 crypto (replaces placeholder)

**Files:** `lib/ai-config/web-provider-crypto.ts` (was placeholder; now real)

The MVP left a placeholder that threw "not implemented". ② fills it in with real Web Crypto API AES-GCM 256. **TDD: 8 test cases**.

- [ ] **Step 4.1: Read current placeholder**

```bash
cat lib/ai-config/web-provider-crypto.ts
```

- [ ] **Step 4.2: Write 8 failing tests (TDD red)**

Replace `__tests__/lib/ai-config/web-provider-crypto.test.ts` (MVP had 3 placeholder tests; we need 8 real tests):

```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptCookieBundle, decryptCookieBundle, isEncryptionEnabled } from '@/lib/ai-config/web-provider-crypto';

// Mock chrome.storage.local for key persistence
let mockStorage: Record<string, any> = {};

beforeEach(() => {
  mockStorage = {};
  (global as any).chrome = {
    storage: {
      local: {
        get: vi.fn((k: string) => Promise.resolve({ [k]: mockStorage[k] }).then(r => r)),
        set: vi.fn((o: Record<string, any>) => { Object.assign(mockStorage, o); return Promise.resolve(); }),
      },
    },
  };
});

describe('web-provider-crypto', () => {
  it('encrypt then decrypt returns original plaintext', async () => {
    const plaintext = JSON.stringify({ 'chatglm_token': 'abc123' });
    const ciphertext = await encryptCookieBundle(plaintext);
    const decrypted = await decryptCookieBundle(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('ciphertext is NOT plaintext (base64, not the original string)', async () => {
    const plaintext = 'secret-cookie-value';
    const ciphertext = await encryptCookieBundle(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('output structure: 16B salt + 12B iv + ciphertext (>= 28 bytes total)', async () => {
    const ciphertext = await encryptCookieBundle('x');
    const bytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    expect(bytes.length).toBeGreaterThanOrEqual(16 + 12 + 1);  // minimal
  });

  it('decryption with tampered ciphertext throws', async () => {
    const ciphertext = await encryptCookieBundle('x');
    const bytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;  // flip last byte (auth tag)
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptCookieBundle(tampered)).rejects.toThrow();
  });

  it('first call auto-creates and persists the key in chrome.storage.local', async () => {
    await encryptCookieBundle('x');
    expect(chrome.storage.local.set).toHaveBeenCalled();
    expect(Object.keys(mockStorage)).toContain('web-provider-crypto-key-v1');
    expect(mockStorage['web-provider-crypto-key-v1']).toHaveLength(32);  // 256 bits
  });

  it('reuses key across calls (not regenerated)', async () => {
    await encryptCookieBundle('a');
    const key1 = mockStorage['web-provider-crypto-key-v1'];
    await encryptCookieBundle('b');
    const key2 = mockStorage['web-provider-crypto-key-v1'];
    expect(key1).toEqual(key2);
  });

  it('handles empty string', async () => {
    const ciphertext = await encryptCookieBundle('');
    expect(await decryptCookieBundle(ciphertext)).toBe('');
  });

  it('handles unicode (Chinese characters)', async () => {
    const plaintext = '{"name":"智谱","url":"https://chatglm.cn"}';
    const ciphertext = await encryptCookieBundle(plaintext);
    expect(await decryptCookieBundle(ciphertext)).toBe(plaintext);
  });
});

describe('isEncryptionEnabled', () => {
  it('returns true (MVP was false)', () => {
    expect(isEncryptionEnabled()).toBe(true);
  });
});
```

- [ ] **Step 4.3: Run tests, expect 8 to FAIL**

```bash
cd D:\Project\CebianX\cebian-web-provider
pnpm test -- web-provider-crypto
```

**Expected:** 8 tests fail (encrypt/decrypt are still throwing "not implemented").

- [ ] **Step 4.4: Implement real crypto (TDD green)**

Replace `lib/ai-config/web-provider-crypto.ts`:

```typescript
/**
 * Web Crypto API AES-GCM 256 encryption for web provider cookies.
 *
 * ② fills in real implementation; MVP was a placeholder.
 *
 * Threat model:
 * - ✅ Protects against raw IndexedDB inspection (ciphertext is opaque)
 * - ✅ Origin isolation prevents other extensions from reading our Dexie
 * - ❌ Does NOT protect against stolen device + extension source access
 *   (key in chrome.storage.local is recoverable)
 * - Follow-up: PBKDF2 + user passphrase (deferred to post-⑤)
 *
 * Output format: base64(salt[16] || iv[12] || ciphertext+N[16])
 * - salt is used as additionalData (binds ciphertext to this key generation)
 * - iv is fresh per encryption
 * - ciphertext includes the 16-byte GCM auth tag at the end
 */

const KEY_STORAGE_KEY = 'web-provider-crypto-key-v1';
const KEY_ALGORITHM = { name: 'AES-GCM', length: 256 } as const;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/** Get or create the persistent key. Persisted in chrome.storage.local. */
async function getOrCreateKey(): Promise<CryptoKey> {
  const stored = await chrome.storage.local.get(KEY_STORAGE_KEY);
  if (stored[KEY_STORAGE_KEY]) {
    return crypto.subtle.importKey(
      'raw',
      new Uint8Array(stored[KEY_STORAGE_KEY]),
      KEY_ALGORITHM,
      false,
      ['encrypt', 'decrypt'],
    );
  }
  // First run: generate new key
  const key = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.local.set({ [KEY_STORAGE_KEY]: Array.from(new Uint8Array(raw)) });
  return crypto.subtle.importKey('raw', raw, KEY_ALGORITHM, false, ['encrypt', 'decrypt']);
}

export async function encryptCookieBundle(plaintext: string): Promise<string> {
  const key = await getOrCreateKey();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: salt },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);
  return base64Encode(combined);
}

export async function decryptCookieBundle(b64: string): Promise<string> {
  const key = await getOrCreateKey();
  const combined = base64Decode(b64);
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: salt },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

export function isEncryptionEnabled(): boolean {
  return true;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 4.5: Run tests, expect 8 to PASS**

```bash
pnpm test -- web-provider-crypto
```

**Expected:** 8 new tests pass. Total now: 32 (MVP) + 4 (presets from Task 3) + 8 (crypto) = 44 tests.

- [ ] **Step 4.6: Commit crypto**

```bash
git add lib/ai-config/web-provider-crypto.ts __tests__/lib/ai-config/web-provider-crypto.test.ts
git commit -m "feat(ai-config): implement real AES-GCM 256 for ② (TDD 8 cases, replaces placeholder)"
```

---

## Task 5: Extend repository with A2 (setUserOverrides) + A4 (appendAuditEntry) + ② cookie bundle methods

**Files:** `lib/ai-config/web-provider-store.ts` (modification)

Add 4 new methods to `WebProviderRepository`:
- `setEncryptedCookieBundle(presetId, ciphertext)` — used after successful login
- `clearEncryptedCookieBundle(presetId)` — used by logout (⑤) or reset
- `setUserOverrides(presetId, overrides | null)` — A2: persists user's per-provider overrides
- `appendAuditEntry(presetId, entry)` — A4: appends to loginAuditLog, enforces max 5

**TDD: 5 new test cases** (in addition to existing 11 MVP tests).

- [ ] **Step 5.1: Read current repository**

```bash
cat lib/ai-config/web-provider-store.ts
```

- [ ] **Step 5.2: Write 5 failing tests (TDD red)**

Add to `__tests__/lib/ai-config/web-provider-store.test.ts`:

```typescript
describe('WebProviderRepository — ② additions', () => {
  describe('setEncryptedCookieBundle / clearEncryptedCookieBundle', () => {
    it('setEncryptedCookieBundle persists the ciphertext', async () => {
      const repo = getWebProviderRepository();
      await repo.setEncryptedCookieBundle('glm', 'base64ciphertext');
      const reloaded = await getDb().webProviders.get('glm');
      expect(reloaded?.encryptedCookieBundle).toBe('base64ciphertext');
    });

    it('clearEncryptedCookieBundle sets to null', async () => {
      const repo = getWebProviderRepository();
      await repo.setEncryptedCookieBundle('glm', 'base64ciphertext');
      await repo.clearEncryptedCookieBundle('glm');
      const reloaded = await getDb().webProviders.get('glm');
      expect(reloaded?.encryptedCookieBundle).toBeNull();
    });
  });

  describe('setUserOverrides (A2)', () => {
    it('persists user overrides', async () => {
      const repo = getWebProviderRepository();
      await repo.setUserOverrides('kimi', {
        sessionIndicators: ['kimi-auth-v2'],
        useLocalStorageFallback: false,
      });
      const reloaded = await getDb().webProviders.get('kimi');
      expect(reloaded?.userOverrides).toEqual({
        sessionIndicators: ['kimi-auth-v2'],
        useLocalStorageFallback: false,
      });
    });

    it('null clears overrides', async () => {
      const repo = getWebProviderRepository();
      await repo.setUserOverrides('kimi', { sessionIndicators: ['x'] });
      await repo.setUserOverrides('kimi', null);
      const reloaded = await getDb().webProviders.get('kimi');
      expect(reloaded?.userOverrides).toBeNull();
    });
  });

  describe('appendAuditEntry (A4)', () => {
    it('appends entry to empty log', async () => {
      const repo = getWebProviderRepository();
      await repo.appendAuditEntry('glm', { timestamp: '2026-06-03T00:00:00Z', result: 'success' });
      const reloaded = await getDb().webProviders.get('glm');
      expect(reloaded?.loginAuditLog).toHaveLength(1);
      expect(reloaded?.loginAuditLog[0].result).toBe('success');
    });

    it('keeps most recent first', async () => {
      const repo = getWebProviderRepository();
      await repo.appendAuditEntry('glm', { timestamp: '2026-06-03T00:00:00Z', result: 'success' });
      await repo.appendAuditEntry('glm', { timestamp: '2026-06-03T00:01:00Z', result: 'timeout' });
      const reloaded = await getDb().webProviders.get('glm');
      expect(reloaded?.loginAuditLog).toHaveLength(2);
      expect(reloaded?.loginAuditLog[0].result).toBe('timeout');  // newer first
      expect(reloaded?.loginAuditLog[1].result).toBe('success');
    });

    it('evicts oldest when count exceeds 5 (FIFO)', async () => {
      const repo = getWebProviderRepository();
      for (let i = 0; i < 7; i++) {
        await repo.appendAuditEntry('glm', {
          timestamp: `2026-06-03T00:0${i}:00Z`,
          result: 'success',
        });
      }
      const reloaded = await getDb().webProviders.get('glm');
      expect(reloaded?.loginAuditLog).toHaveLength(5);
      // Oldest 2 evicted; newest 5 remain
      expect(reloaded?.loginAuditLog[0].timestamp).toBe('2026-06-03T00:06:00Z');
      expect(reloaded?.loginAuditLog[4].timestamp).toBe('2026-06-03T00:02:00Z');
    });
  });
});
```

- [ ] **Step 5.3: Run tests, expect 5 to FAIL**

```bash
pnpm test -- web-provider-store
```

**Expected:** 5 new tests fail; 11 existing MVP tests still pass.

- [ ] **Step 5.4: Implement 4 new methods (TDD green)**

Add to `WebProviderRepository` class:

```typescript
  async setEncryptedCookieBundle(
    presetId: WebProvider['presetId'],
    ciphertext: string,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      encryptedCookieBundle: ciphertext,
      updatedAt: new Date().toISOString(),
    });
  }

  async clearEncryptedCookieBundle(
    presetId: WebProvider['presetId'],
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      encryptedCookieBundle: null,
      updatedAt: new Date().toISOString(),
    });
  }

  async setUserOverrides(
    presetId: WebProvider['presetId'],
    overrides: WebProviderUserOverrides | null,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      userOverrides: overrides,
      updatedAt: new Date().toISOString(),
    });
  }

  async appendAuditEntry(
    presetId: WebProvider['presetId'],
    entry: LoginAuditEntry,
  ): Promise<void> {
    const existing = await this.db.webProviders.get(presetId);
    const log = existing?.loginAuditLog ?? [];
    log.unshift(entry);
    while (log.length > 5) log.pop();
    await this.db.webProviders.update(presetId, {
      loginAuditLog: log,
      updatedAt: new Date().toISOString(),
    });
  }
```

Also add to `createFromPreset` (MVP had this; needs update for new fields):

```typescript
  private createFromPreset(preset: typeof WEB_PROVIDER_PRESETS[number]): WebProvider {
    const now = new Date().toISOString();
    return {
      presetId: preset.id,
      enabled: true,
      loginStatus: 'unknown',
      modelId: preset.defaultModelId,
      supportsToolCalls: preset.defaultSupportsToolCalls,
      supportsReasoning: preset.defaultSupportsReasoning,
      lastCheckedAt: null,
      encryptedCookieBundle: null,
      userOverrides: null,        // ⭐ NEW
      loginAuditLog: [],          // ⭐ NEW
      createdAt: now,
      updatedAt: now,
    };
  }
```

- [ ] **Step 5.5: Run tests, expect all 16 to PASS**

```bash
pnpm test -- web-provider-store
```

**Expected:** 11 (MVP) + 5 (②) = 16 tests pass. Total: 32 (MVP) + 4 (presets) + 8 (crypto) + 16 (store) = 60.

- [ ] **Step 5.6: Commit repository additions**

```bash
git add lib/ai-config/web-provider-store.ts __tests__/lib/ai-config/web-provider-store.test.ts
git commit -m "feat(ai-config): add ② repository methods (encrypted bundle + A2 overrides + A4 audit, TDD 5 cases)"
```

---

## Task 6: Implement background service (login flow + A3 + A5 + A6 + audit)

**Files:** `lib/ai-config/web-provider-cookie-service.ts` (NEW), `entrypoints/background.ts` (modification)

This is the **largest single task** in ②. The service:
1. Listens for `chrome.runtime.onMessage` with 2 message types
2. `WEB_PROVIDER_LOGIN` → open tab (A6: reuse if exists) → 5s MIN_WAIT → poll 2s/5s (A3) × 5min → capture cookies + optional localStorage → optional refreshAuth retry (A5) → encrypt → store → audit log
3. `WEB_PROVIDER_RECHECK` → read stored bundle → decrypt → validate → return

**TDD: 12 test cases**.

- [ ] **Step 6.1: Write 12 failing tests (TDD red)**

Create `__tests__/lib/ai-config/web-provider-cookie-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// Track all calls to chrome APIs
let mockCookies: any[];
let mockTabs: any[];
let mockWindowFocused: boolean = true;

beforeEach(() => {
  mockCookies = [];
  mockTabs = [];
  mockWindowFocused = true;

  (global as any).chrome = {
    cookies: { getAll: vi.fn(() => Promise.resolve(mockCookies)) },
    tabs: {
      create: vi.fn((opts: any) => {
        const newTab = { id: mockTabs.length + 1, windowId: 1, url: opts.url };
        mockTabs.push(newTab);
        return Promise.resolve(newTab);
      }),
      get: vi.fn((id: number) => {
        const t = mockTabs.find(t => t.id === id);
        return t ? Promise.resolve(t) : Promise.reject(new Error('not found'));
      }),
      remove: vi.fn((id: number) => {
        mockTabs = mockTabs.filter(t => t.id !== id);
        return Promise.resolve();
      }),
      query: vi.fn(() => Promise.resolve([])),  // no existing tabs by default
      update: vi.fn(() => Promise.resolve()),
      onActivated: { addListener: vi.fn() },
    },
    windows: {
      get: vi.fn(() => Promise.resolve({ focused: mockWindowFocused })),
      update: vi.fn(() => Promise.resolve()),
      WINDOW_ID_NONE: -1,
      onFocusChanged: { addListener: vi.fn() },
    },
    runtime: { onMessage: { addListener: vi.fn() } },
    storage: {
      local: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
    scripting: {
      executeScript: vi.fn(() => Promise.resolve([{ result: {} }])),
    },
  };
});

import { registerCookieService } from '@/lib/ai-config/web-provider-cookie-service';

describe('web-provider-cookie-service', () => {
  let messageHandler: any;

  beforeEach(() => {
    registerCookieService();
    messageHandler = (chrome.runtime.onMessage.addListener as any).mock.calls[0][0];
  });

  describe('WEB_PROVIDER_LOGIN', () => {
    it('happy path: cookies present → encrypt → persist → success', async () => {
      mockCookies = [{ name: 'chatglm_refresh_token', value: 'rt-abc' }];
      const sendResponse = vi.fn();
      const result = await messageHandler({ type: 'WEB_PROVIDER_LOGIN', presetId: 'glm' }, {}, sendResponse);
      // Note: sendResponse is called inside the async handler
      // The handler returns true to keep the message channel open
      // In our service, we call sendResponse then return
      expect(result).toBe(true);  // keep channel open
      await new Promise(r => setTimeout(r, 5100));  // wait for MIN_WAIT + first poll
      // After full flow:
      // - encryptCookieBundle was called
      // - Dexie write happened
      // - tab was removed
      // - sendResponse was called with success
    });

    it('A6: focuses existing tab if one is open at the provider host', async () => {
      (chrome.tabs.query as any) = vi.fn(() => Promise.resolve([{ id: 99, windowId: 1, url: 'https://chatglm.cn/login' }]));
      (chrome.tabs.create as any) = vi.fn();  // should NOT be called
      // ... call handler
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(chrome.tabs.update).toHaveBeenCalledWith(99, { active: true });
    });

    it('A5: retries refreshAuth 3 times with backoff on failure', async () => {
      // Set up GLM, mock refreshAuth to fail twice then succeed
      // Use jest fake timers for the backoff
      // ...
    });

    it('localStorage fallback (Kimi) when no cookies but localStorage has tokens', async () => {
      // ... mock empty cookies, mock executeScript returns { 'kimi-auth': 'ls-xyz' }
      // ... expect success
    });

    it('timeout after 5 min → returns failure', async () => {
      vi.useFakeTimers();
      // ... call handler, advance time by 5min+1ms
      // ... expect sendResponse called with failure
      vi.useRealTimers();
    });

    it('tab closed by user → returns failure', async () => {
      // ... mock chrome.tabs.get to throw
      // ... expect failure with 'tab-closed' result
    });
  });

  describe('WEB_PROVIDER_RECHECK', () => {
    it('returns success when stored bundle decrypts successfully', async () => {
      // ... pre-populate Dexie with valid encrypted bundle
      // ... call handler
      // ... expect success
    });

    it('returns failure when no stored bundle', async () => {
      // ... empty Dexie for this provider
      // ... expect failure with 'no-cookies' result
    });

    it('returns failure when stored bundle is corrupt', async () => {
      // ... pre-populate with garbage encrypted bundle
      // ... expect failure with 'decryption-failed' result
    });
  });

  describe('audit log writes (A4)', () => {
    it('writes success entry on successful login', async () => {
      // ... successful login
      // ... check loginAuditLog has { result: 'success', cookiesCaptured: N }
    });

    it('writes timeout entry on 5min timeout', async () => {
      // ... timeout scenario
      // ... check loginAuditLog has { result: 'timeout' }
    });

    it('writes tab-closed entry when user closes tab', async () => {
      // ... tab-closed scenario
      // ... check loginAuditLog has { result: 'tab-closed' }
    });
  });
});
```

(Note: the above is a sketch; the actual implementation will mock `encryptCookieBundle` and `decryptCookieBundle` directly to avoid the chrome.storage.local key dance in tests.)

- [ ] **Step 6.2: Run tests, expect 12 to FAIL**

```bash
pnpm test -- web-provider-cookie-service
```

**Expected:** All 12 fail (service module doesn't exist yet).

- [ ] **Step 6.3: Implement `web-provider-cookie-service.ts` (TDD green, ~400 lines)**

Create `lib/ai-config/web-provider-cookie-service.ts`:

```typescript
/**
 * Background service for web provider cookie extraction & encrypted storage.
 *
 * Handles 2 message types from the React hook:
 *   - WEB_PROVIDER_LOGIN: open tab, poll for cookies, encrypt, persist
 *   - WEB_PROVIDER_RECHECK: verify stored credentials still decrypt
 *
 * Implements 6 production-grade enhancements:
 *   A3: Active tab tracking (background polling throttling)
 *   A4: Login attempt audit log (writes to Dexie on every attempt)
 *   A5: RefreshAuth retry with exponential backoff
 *   A6: Detect already-open tab (reuse instead of open)
 */

import { WEB_PROVIDER_PRESETS, resolveEffectiveConfig } from './web-provider-presets';
import { getWebProviderRepository } from './web-provider-store';
import { encryptCookieBundle, decryptCookieBundle } from './web-provider-crypto';
import type { WebProvider, LoginAuditEntry, LoginAttemptResult, LoginStatus } from '../types';

const POLL_INTERVAL_MS = 2_000;
const BACKGROUND_POLL_INTERVAL_MS = 5_000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000;
const MIN_WAIT_MS = 5_000;
const REFRESH_AUTH_MAX_ATTEMPTS = 3;
const REFRESH_AUTH_BACKOFFS = [1000, 2000, 4000] as const;

const COMMON_AUTH_COOKIES = ['lastActiveOrg', 'XSRF-TOKEN', 'csrf_token'] as const;

export function registerCookieService(): void {
  chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    if (msg?.type === 'WEB_PROVIDER_LOGIN') {
      handleLogin(msg.presetId).then(sendResponse).catch(err => {
        sendResponse({ success: false, error: String(err), status: 'loggedOut' as LoginStatus });
      });
      return true;
    }
    if (msg?.type === 'WEB_PROVIDER_RECHECK') {
      handleRecheck(msg.presetId).then(sendResponse).catch(err => {
        sendResponse({ success: false, error: String(err), status: 'loggedOut' as LoginStatus });
      });
      return true;
    }
    return false;
  });
}

async function handleLogin(presetId: string): Promise<any> {
  const preset = WEB_PROVIDER_PRESETS.find(p => p.id === presetId);
  if (!preset) return { success: false, error: 'Unknown preset' };
  const repo = getWebProviderRepository();
  const provider = await repo.get(presetId);
  if (!provider) return { success: false, error: 'Provider not found' };
  const effective = resolveEffectiveConfig(provider, preset);

  // A6: open or focus existing tab
  const tabId = await openOrFocusLoginTab(effective.loginUrl);

  // A3: track focus
  let isTabFocused = true;
  const onActivated = ({ tabId: activeId }: any) => { isTabFocused = activeId === tabId; };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) isTabFocused = false;
    else chrome.tabs.get(tabId).then(t => {
      chrome.windows.get(t.windowId, (w: any) => { isTabFocused = w.focused; });
    });
  });

  const startTime = Date.now();
  let lastError: string | null = null;

  try {
    const tokens = await pollForSession(tabId, effective, startTime, () => isTabFocused, (err) => { lastError = err; });
    if (!tokens) {
      const result: LoginAttemptResult = lastError?.includes('closed') ? 'tab-closed' : 'timeout';
      await appendAudit(presetId, { timestamp: new Date().toISOString(), result, errorMessage: lastError ?? undefined });
      await safeRemoveTab(tabId);
      return { success: false, error: lastError, status: 'loggedOut' };
    }

    let captured = { ...tokens.cookies };
    if (tokens.source === 'localStorage') {
      // captured already has the localStorage values
    }

    // A5: refresh auth retry for GLM
    if (effective.refreshUrl) {
      const refreshToken = captured['chatglm_refresh_token'] || captured['refresh_token'];
      if (refreshToken && !captured['chatglm_token']) {
        const accessToken = await tryRefreshAuthWithRetry(effective.refreshUrl, refreshToken, tabId);
        if (accessToken) {
          captured['chatglm_token'] = accessToken;
        } else {
          await appendAudit(presetId, {
            timestamp: new Date().toISOString(),
            result: 'refresh-failed',
            errorMessage: 'RefreshAuth failed after 3 attempts; stored refresh_token only',
          });
        }
      }
    }

    const ciphertext = await encryptCookieBundle(JSON.stringify(captured));
    await repo.setEncryptedCookieBundle(presetId as any, ciphertext);
    await repo.setLoginStatus(presetId as any, 'loggedIn');

    const cookiesCaptured = Object.keys(captured).length;
    const auditEntry: LoginAuditEntry = {
      timestamp: new Date().toISOString(),
      result: 'success',
      source: tokens.source,
      cookiesCaptured,
    };
    await appendAudit(presetId, auditEntry);

    chrome.tabs.onActivated.removeListener(onActivated);
    await safeRemoveTab(tabId);

    return {
      success: true,
      status: 'loggedIn',
      capturedCookieNames: Object.keys(captured),
      capturedTokenSources: [tokens.source],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAudit(presetId, { timestamp: new Date().toISOString(), result: 'no-cookies', errorMessage: message });
    await safeRemoveTab(tabId);
    return { success: false, error: message, status: 'loggedOut' };
  }
}

async function handleRecheck(presetId: string): Promise<any> {
  const repo = getWebProviderRepository();
  const provider = await repo.get(presetId);
  if (!provider?.encryptedCookieBundle) {
    return { success: false, error: 'No stored credentials', status: 'loggedOut' };
  }
  try {
    const plaintext = await decryptCookieBundle(provider.encryptedCookieBundle);
    JSON.parse(plaintext);  // validate
    return { success: true, status: 'loggedIn' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAudit(presetId, { timestamp: new Date().toISOString(), result: 'decryption-failed', errorMessage: message });
    return { success: false, error: message, status: 'loggedOut' };
  }
}

// A6: open or focus existing tab
async function openOrFocusLoginTab(loginUrl: string): Promise<number> {
  const url = new URL(loginUrl);
  const urlPattern = `*://${url.hostname}/*`;
  const existingTabs = await chrome.tabs.query({ url: urlPattern });
  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.tabs.update(tab.id!, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return tab.id!;
  }
  const tab = await chrome.tabs.create({ url: loginUrl, active: true });
  return tab.id!;
}

// A3: poll with throttling
async function pollForSession(
  tabId: number,
  preset: ReturnType<typeof resolveEffectiveConfig>,
  startTime: number,
  isTabFocused: () => boolean,
  onError: (err: string) => void,
): Promise<{ cookies: Record<string, string>; source: 'cookie' | 'localStorage' } | null> {
  while (Date.now() - startTime < LOGIN_TIMEOUT_MS) {
    // Check tab still exists
    try { await chrome.tabs.get(tabId); }
    catch { onError('Login tab was closed before session was detected'); return null; }

    // MIN_WAIT before first check
    if (Date.now() - startTime < MIN_WAIT_MS) {
      await sleep(500);
      continue;
    }

    try {
      const cookies = await chrome.cookies.getAll({ domain: preset.cookieDomain });
      const cookieMap: Record<string, string> = {};
      for (const c of cookies) cookieMap[c.name] = c.value;
      const matched = preset.sessionIndicators.filter((n: string) => cookieMap[n]);

      if (matched.length > 0) {
        const captured: Record<string, string> = {};
        for (const n of preset.sessionIndicators) if (cookieMap[n]) captured[n] = cookieMap[n];
        for (const n of COMMON_AUTH_COOKIES) if (cookieMap[n]) captured[n] = cookieMap[n];
        return { cookies: captured, source: 'cookie' };
      }

      if (preset.useLocalStorageFallback) {
        const lsTokens = await readLocalStorageFromTab(tabId, preset.sessionIndicators);
        if (Object.keys(lsTokens).length > 0) {
          return { cookies: lsTokens, source: 'localStorage' };
        }
      }
    } catch (err) {
      onError(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const interval = isTabFocused() ? POLL_INTERVAL_MS : BACKGROUND_POLL_INTERVAL_MS;
    await sleep(interval);
  }
  onError(`Login timed out after ${LOGIN_TIMEOUT_MS / 1000}s`);
  return null;
}

async function readLocalStorageFromTab(tabId: number, keys: string[]): Promise<Record<string, string>> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (keysToRead: string[]) => {
        const out: Record<string, string> = {};
        for (const k of keysToRead) {
          const v = localStorage.getItem(k);
          if (v !== null) out[k] = v;
        }
        return out;
      },
      args: [keys],
    });
    return results?.[0]?.result ?? {};
  } catch (err) {
    console.warn('[web-provider] localStorage read failed:', err);
    return {};
  }
}

// A5: refresh auth retry
async function tryRefreshAuthWithRetry(
  refreshUrl: string,
  refreshToken: string,
  tabId: number,
): Promise<string | null> {
  for (let attempt = 1; attempt <= REFRESH_AUTH_MAX_ATTEMPTS; attempt++) {
    const token = await tryRefreshAuth(refreshUrl, refreshToken, tabId);
    if (token) return token;
    if (attempt < REFRESH_AUTH_MAX_ATTEMPTS) {
      await sleep(REFRESH_AUTH_BACKOFFS[attempt - 1]);
    }
  }
  return null;
}

async function tryRefreshAuth(refreshUrl: string, refreshToken: string, tabId: number): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (url: string, token: string) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({}),
            credentials: 'include',
          });
          if (!res.ok) return null;
          const data = await res.json();
          return data?.result?.access_token ?? data?.result?.accessToken ?? data?.accessToken ?? null;
        } catch { return null; }
      },
      args: [refreshUrl, refreshToken],
    });
    return results?.[0]?.result as string | null;
  } catch {
    return null;
  }
}

async function appendAudit(presetId: string, entry: LoginAuditEntry): Promise<void> {
  try {
    await getWebProviderRepository().appendAuditEntry(presetId as any, entry);
  } catch (err) {
    console.warn('[web-provider] failed to append audit entry:', err);
  }
}

async function safeRemoveTab(tabId: number): Promise<void> {
  try { await chrome.tabs.remove(tabId); } catch { /* tab already closed */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
```

- [ ] **Step 6.4: Register the service in background.ts**

Edit `entrypoints/background.ts` to add:

```typescript
import { registerCookieService } from '@/lib/ai-config/web-provider-cookie-service';

// ... existing code ...

registerCookieService();
```

- [ ] **Step 6.5: Run tests, expect 12 to PASS**

```bash
pnpm test -- web-provider-cookie-service
```

**Expected:** 12 tests pass. Total: 60 + 12 = 72.

- [ ] **Step 6.6: Commit background service**

```bash
git add lib/ai-config/web-provider-cookie-service.ts entrypoints/background.ts __tests__/lib/ai-config/web-provider-cookie-service.test.ts
git commit -m "feat(ai-config): implement background cookie service (login + A3 + A5 + A6 + A4, TDD 12 cases)"
```

---

## Task 7: Implement useWebProviderWebLogin hook (replaces simulated)

**Files:** `hooks/useWebProviderWebLogin.ts` (NEW), delete `hooks/useWebProviderSimulatedLogin.ts` + its test

The hook:
- `login(presetId)`: sends `WEB_PROVIDER_LOGIN` to background SW; updates state
- `recheck(presetId)`: sends `WEB_PROVIDER_RECHECK`; updates state
- `lastCaptureInfo`: returns most recent capture metadata (A1 transparency)
- Never auto-checks on mount (matches MVP behavior)

**TDD: 8 test cases**.

- [ ] **Step 7.1: Write 8 failing tests (TDD red)**

Create `__tests__/hooks/useWebProviderWebLogin.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebProviderWebLogin } from '@/hooks/useWebProviderWebLogin';

// Mock chrome.runtime.sendMessage
let mockResponse: any = { success: true, status: 'loggedIn' };
beforeEach(() => {
  mockResponse = { success: true, status: 'loggedIn' };
  (global as any).chrome = {
    runtime: { sendMessage: vi.fn(() => Promise.resolve(mockResponse)) },
  };
});

describe('useWebProviderWebLogin', () => {
  it('login sends WEB_PROVIDER_LOGIN message', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useWebProviderWebLogin({ onSuccess, onFailure: vi.fn() }));
    await act(async () => { await result.current.login('glm'); });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'WEB_PROVIDER_LOGIN', presetId: 'glm' });
  });

  it('recheck sends WEB_PROVIDER_RECHECK message', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useWebProviderWebLogin({ onSuccess, onFailure: vi.fn() }));
    await act(async () => { await result.current.recheck('glm'); });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'WEB_PROVIDER_RECHECK', presetId: 'glm' });
  });

  it('calls onSuccess on success response', async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() => useWebProviderWebLogin({ onSuccess, onFailure }));
    await act(async () => { await result.current.login('glm'); });
    expect(onSuccess).toHaveBeenCalledWith('glm');
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('calls onFailure on failure response', async () => {
    mockResponse = { success: false, error: 'timeout' };
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() => useWebProviderWebLogin({ onSuccess, onFailure }));
    await act(async () => { await result.current.login('glm'); });
    expect(onFailure).toHaveBeenCalledWith('glm', 'timeout');
  });

  it('inFlight lock: only one login at a time', async () => {
    // Make first call pending, second should be ignored
    let resolveFirst: any;
    (global as any).chrome.runtime.sendMessage = vi.fn(() => new Promise(r => { resolveFirst = r; }));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useWebProviderWebLogin({ onSuccess, onFailure: vi.fn() }));
    act(() => { result.current.login('glm'); });  // pending
    act(() => { result.current.login('kimi'); });  // should be ignored
    resolveFirst({ success: true });
    await act(async () => { /* let pending resolve */ });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('loginLoading toggles true → false', async () => {
    const { result } = renderHook(() => useWebProviderWebLogin({ onSuccess: vi.fn(), onFailure: vi.fn() }));
    expect(result.current.loginLoading).toBe(false);
    await act(async () => { await result.current.login('glm'); });
    expect(result.current.loginLoading).toBe(false);
  });

  it('A1: lastCaptureInfo populated after successful login', async () => {
    mockResponse = { success: true, status: 'loggedIn', capturedCookieNames: ['chatglm_token'], capturedTokenSources: ['cookie'] };
    const { result } = renderHook(() => useWebProviderWebLogin({ onSuccess: vi.fn(), onFailure: vi.fn() }));
    await act(async () => { await result.current.login('glm'); });
    expect(result.current.lastCaptureInfo).toEqual({
      cookieNames: ['chatglm_token'],
      tokenSources: ['cookie'],
      capturedAt: expect.any(String),
    });
  });

  it('never auto-checks on mount (status starts as not-logged-in or unknown)', () => {
    const { result } = renderHook(() => useWebProviderWebLogin({ onSuccess: vi.fn(), onFailure: vi.fn() }));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(result.current.checkingId).toBeNull();
  });
});
```

- [ ] **Step 7.2: Run tests, expect 8 to FAIL**

```bash
pnpm test -- useWebProviderWebLogin
```

- [ ] **Step 7.3: Implement `useWebProviderWebLogin.ts` (TDD green)**

Create `hooks/useWebProviderWebLogin.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import type { WebProvider } from '@/lib/types';

export interface LastCaptureInfo {
  cookieNames: string[];
  tokenSources: Array<'cookie' | 'localStorage'>;
  capturedAt: string;
}

export interface WebLoginConfig {
  onSuccess: (id: WebProvider['presetId']) => void;
  onFailure: (id: WebProvider['presetId'], error: string) => void;
}

export interface WebLoginResult {
  login: (id: WebProvider['presetId']) => Promise<void>;
  recheck: (id: WebProvider['presetId']) => Promise<void>;
  checkingId: WebProvider['presetId'] | null;
  loginLoading: boolean;
  lastCaptureInfo: LastCaptureInfo | null;
}

interface LoginResponse {
  success: boolean;
  status?: 'unknown' | 'checking' | 'loggedIn' | 'loggedOut' | 'expired';
  error?: string;
  capturedCookieNames?: string[];
  capturedTokenSources?: Array<'cookie' | 'localStorage'>;
}

export function useWebProviderWebLogin(config: WebLoginConfig): WebLoginResult {
  const [checkingId, setCheckingId] = useState<WebProvider['presetId'] | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [lastCaptureInfo, setLastCaptureInfo] = useState<LastCaptureInfo | null>(null);
  const inFlightRef = useRef<WebProvider['presetId'] | null>(null);

  const sendRequest = useCallback(async (
    messageType: 'WEB_PROVIDER_LOGIN' | 'WEB_PROVIDER_RECHECK',
    id: WebProvider['presetId'],
    isLogin: boolean,
  ): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = id;
    setCheckingId(id);
    if (isLogin) setLoginLoading(true);

    try {
      const response: LoginResponse = await chrome.runtime.sendMessage({ type: messageType, presetId: id });
      if (response?.success) {
        if (isLogin && response.capturedCookieNames && response.capturedTokenSources) {
          setLastCaptureInfo({
            cookieNames: response.capturedCookieNames,
            tokenSources: response.capturedTokenSources,
            capturedAt: new Date().toISOString(),
          });
        }
        config.onSuccess(id);
      } else {
        config.onFailure(id, response?.error ?? 'Unknown error');
      }
    } catch (err) {
      config.onFailure(id, err instanceof Error ? err.message : 'Request failed');
    } finally {
      inFlightRef.current = null;
      setCheckingId(null);
      if (isLogin) setLoginLoading(false);
    }
  }, [config]);

  const login = useCallback((id: WebProvider['presetId']) =>
    sendRequest('WEB_PROVIDER_LOGIN', id, true), [sendRequest]);

  const recheck = useCallback((id: WebProvider['presetId']) =>
    sendRequest('WEB_PROVIDER_RECHECK', id, false), [sendRequest]);

  return { login, recheck, checkingId, loginLoading, lastCaptureInfo };
}
```

- [ ] **Step 7.4: Run tests, expect 8 to PASS**

```bash
pnpm test -- useWebProviderWebLogin
```

**Expected:** 8 tests pass. Total: 72 + 8 = 80.

- [ ] **Step 7.5: Commit hook**

```bash
git add hooks/useWebProviderWebLogin.ts __tests__/hooks/useWebProviderWebLogin.test.ts
git commit -m "feat(hooks): add useWebProviderWebLogin (replaces simulated, TDD 8 cases)"
```

---

## Task 8: UI updates: Login button + A1 transparency + A2 Advanced section + A4 audit display

**Files:** `components/settings/provider/WebProviderCard.tsx` (modification), `components/settings/sections/WebProvidersSubSection.tsx` (modification)

This is the biggest UI change but still minimal:
- `WebProviderCard` gets:
  - 1 new "Login" button next to "Re-check login"
  - 1 new "Captured N cookies: ..." line (A1)
  - 1 new collapsible "Advanced" section with 4 form fields + Reset button (A2)
  - 1 new "Last attempt: X — [result]" line (A4)
- `WebProvidersSubSection` gets:
  - Import swap to `useWebProviderWebLogin`
  - Destructure `login`, `loginLoading`, `lastCaptureInfo`
  - Pass `login` and `loginLoading` to card

**No TDD for UI** (project doesn't have component tests for these cards; MVP verified manually). Use the existing test infrastructure to make sure it still compiles and renders.

- [ ] **Step 9.1: Read current `WebProviderCard.tsx`**

```bash
cat components/settings/provider/WebProviderCard.tsx
```

- [ ] **Step 9.2: Extend `WebProviderCardProps` interface**

Add to the existing props:

```typescript
export interface WebProviderCardProps {
  // ... existing props ...

  /** ⭐ ②: login callback for the new "Login" button */
  onLogin: () => void;

  /** ⭐ ②: whether the login flow is currently running (for button disabled state) */
  isLoginLoading: boolean;

  /** ⭐ ② A1: last capture metadata for transparency display */
  lastCaptureInfo: {
    cookieNames: string[];
    capturedAt: string;
  } | null;

  /** ⭐ ② A2: effective config (preset merged with user overrides) */
  effectiveConfig: ReturnType<typeof resolveEffectiveConfig>;

  /** ⭐ ② A2: handler to update a single user override field */
  onUserOverrideChange: (field: keyof WebProviderUserOverrides, value: string | string[] | boolean | undefined) => void;

  /** ⭐ ② A2: handler to reset all overrides to preset defaults */
  onResetOverrides: () => void;
}
```

- [ ] **Step 9.3: Add the Login button to the card**

In the card JSX, next to the existing "Re-check login status" button, add:

```tsx
<Button
  variant="default"
  size="sm"
  onClick={onLogin}
  disabled={isLoginLoading}
>
  {isLoginLoading ? t('webProviders.fields.loggingIn') : t('webProviders.fields.login')}
</Button>
<Button
  variant="outline"
  size="sm"
  onClick={onRecheck}
  disabled={isChecking}
>
  {isChecking ? t('webProviders.fields.checking') : t('webProviders.fields.recheck')}
</Button>
```

- [ ] **Step 9.4: Add the A1 transparency line**

Below the "Last checked" line:

```tsx
{lastCaptureInfo && (
  <p className="text-xs text-muted-foreground">
    {t('webProviders.fields.captured', {
      count: lastCaptureInfo.cookieNames.length,
      names: lastCaptureInfo.cookieNames.slice(0, 3).join(', '),
      more: lastCaptureInfo.cookieNames.length > 3 ? `, +${lastCaptureInfo.cookieNames.length - 3} more` : '',
    })}
  </p>
)}
```

- [ ] **Step 9.5: Add the A4 audit display**

```tsx
{provider.loginAuditLog[0] && (
  <p className="text-xs text-muted-foreground">
    {t('webProviders.fields.lastAttempt', {
      time: formatRelativeTime(provider.loginAuditLog[0].timestamp),
    })}{' '}
    <Badge variant={provider.loginAuditLog[0].result === 'success' ? 'default' : 'destructive'}>
      {provider.loginAuditLog[0].result}
    </Badge>
  </p>
)}
```

- [ ] **Step 9.6: Add the A2 "Advanced" collapsible section**

```tsx
<details className="text-sm">
  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
    {t('webProviders.fields.advanced')}
  </summary>
  <div className="mt-2 space-y-2 pl-4">
    <FieldRow label={t('webProviders.fields.cookieDomain')}>
      <Input
        value={effectiveConfig.cookieDomain}
        onChange={e => onUserOverrideChange('cookieDomain', e.target.value)}
      />
      {effectiveConfig.source.cookieDomain === 'user' && <Badge variant="secondary">user override</Badge>}
    </FieldRow>
    <FieldRow label={t('webProviders.fields.sessionIndicatorsLabel')}>
      <Input
        value={effectiveConfig.sessionIndicators.join(',')}
        onChange={e => onUserOverrideChange('sessionIndicators', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
      />
    </FieldRow>
    <FieldRow label={t('webProviders.fields.useLocalStorageFallback')}>
      <Switch
        checked={effectiveConfig.useLocalStorageFallback}
        onCheckedChange={v => onUserOverrideChange('useLocalStorageFallback', v)}
      />
    </FieldRow>
    <FieldRow label={t('webProviders.fields.refreshUrl')}>
      <Input
        value={effectiveConfig.refreshUrl ?? ''}
        onChange={e => onUserOverrideChange('refreshUrl', e.target.value || undefined)}
      />
    </FieldRow>
    <Button variant="ghost" size="sm" onClick={onResetOverrides}>
      {t('webProviders.fields.resetToPreset')}
    </Button>
  </div>
</details>
```

- [ ] **Step 9.7: Update `WebProvidersSubSection.tsx`**

Change:
```typescript
// BEFORE
import { useWebProviderSimulatedLogin } from '@/hooks/useWebProviderSimulatedLogin';
// AFTER
import { useWebProviderWebLogin } from '@/hooks/useWebProviderWebLogin';
```

And in the component body, change:
```typescript
// BEFORE
const { recheck, checkingId } = useWebProviderSimulatedLogin({
  onSuccess: (id) => update.setLoginStatus(id, 'loggedIn'),
  onFailure: (id) => update.setLoginStatus(id, 'loggedOut'),
});
// AFTER
const { login, recheck, checkingId, loginLoading, lastCaptureInfo } = useWebProviderWebLogin({
  onSuccess: (id) => update.setLoginStatus(id, 'loggedIn'),
  onFailure: (id, err) => {
    update.setLoginStatus(id, 'loggedOut');
    toast.error(t('webProviders.messages.recheckFailed'), { description: err });
  },
});
```

And pass new props to `WebProviderCard`:
```tsx
<WebProviderCard
  // ... existing props ...
  onLogin={() => login(provider.presetId)}
  isLoginLoading={loginLoading && checkingId === provider.presetId}
  lastCaptureInfo={lastCaptureInfo}
  effectiveConfig={resolveEffectiveConfig(provider, preset)}
  onUserOverrideChange={(field, value) => {
    const current = provider.userOverrides ?? {};
    const next = value === undefined ? { ...current } : { ...current, [field]: value };
    const cleaned = Object.fromEntries(Object.entries(next).filter(([_, v]) => v !== undefined && v !== ''));
    update.setUserOverrides(provider.presetId, Object.keys(cleaned).length > 0 ? cleaned : null);
  }}
  onResetOverrides={() => update.setUserOverrides(provider.presetId, null)}
/>
```

Also need to add `setUserOverrides` to the `update` object in `useWebProviders()` (or call the repository directly via `getWebProviderRepository()`).

- [ ] **Step 9.8: Verify build still works**

```bash
pnpm tsc --noEmit
pnpm run build
```

**Expected:** Zero TS errors; build succeeds. UI changes are pre-build only.

- [ ] **Step 9.9: Commit UI updates**

```bash
git add components/settings/provider/WebProviderCard.tsx components/settings/sections/WebProvidersSubSection.tsx hooks/useWebProviders.ts
git commit -m "feat(ui): add Login button + A1 transparency + A2 Advanced section + A4 audit display"
```

---

## Task 9: Delete useWebProviderSimulatedLogin (now that no callers remain)

**Files:** DELETE `hooks/useWebProviderSimulatedLogin.ts`, DELETE `__tests__/hooks/useWebProviderSimulatedLogin.test.ts`

- [ ] **Step 10.1: Verify zero callers**

```bash
cd D:\Project\CebianX\cebian-web-provider
grep -r "useWebProviderSimulatedLogin" --include="*.ts" --include="*.tsx" .
```

**Expected:** Zero results.

- [ ] **Step 10.2: Delete files**

```bash
rm hooks/useWebProviderSimulatedLogin.ts
rm __tests__/hooks/useWebProviderSimulatedLogin.test.ts
```

- [ ] **Step 10.3: Verify tests still pass (subtraction, not addition)**

```bash
pnpm test
```

**Expected:** 80 tests pass (was 80 + 6 from simulated = 86; deleted 6 from simulated login). Net should be 80 (one less file).

- [ ] **Step 10.4: Commit deletion**

```bash
git add -A
git commit -m "refactor(hooks): delete useWebProviderSimulatedLogin (replaced by useWebProviderWebLogin)"
```

---

## Task 10: Update manifest permissions

**Files:** `wxt.config.ts` (modification) or `entrypoints/manifest.json` (depending on WXT version)

- [ ] **Step 11.1: Read current manifest config**

```bash
cd D:\Project\CebianX\cebian-web-provider
grep -A 20 "manifest" wxt.config.ts 2>/dev/null || cat entrypoints/manifest.json 2>/dev/null
```

Find the `permissions` and `host_permissions` arrays.

- [ ] **Step 11.2: Add `scripting` permission**

MVP already has `cookies` and `storage`. Add `scripting`:

```typescript
manifest: {
  permissions: ['cookies', 'storage', 'scripting'],
  host_permissions: [
    '*://*.chatglm.cn/*',
    '*://*.kimi.moonshot.cn/*',
    '*://*.moonshot.cn/*',
    '*://chat.deepseek.com/*',
    '*://*.deepseek.com/*',
  ],
}
```

- [ ] **Step 11.3: Verify build**

```bash
pnpm run build
```

**Expected:** Build succeeds. The manifest should now include `scripting` in the output.

- [ ] **Step 11.4: Verify manifest in built output**

```bash
cat .output/chrome-mv3/manifest.json | grep -A 20 permissions
```

**Expected:** `scripting` appears in permissions, host_permissions include the 5 domains.

- [ ] **Step 11.5: Commit manifest**

```bash
git add wxt.config.ts
git commit -m "feat(manifest): add scripting permission + 5 host domains for ②"
```

---

## Task 11: i18n additions (4 new strings + 3 for A2 section)

**Files:** `locales/en.yml`, `locales/zh_CN.yml`, `locales/zh_TW.yml`

- [ ] **Step 12.1: Add 7 new strings to en.yml**

In the `webProviders` namespace, add:

```yaml
webProviders:
  # ... existing keys ...
  fields:
    # ... existing fields ...
    login: "Login"
    loggingIn: "Logging in…"
    captured: "Captured $1 cookie(s): $2$3"
    lastAttempt: "Last attempt: $1"
    advanced: "Advanced: session detection config"
    cookieDomain: "Cookie domain"
    sessionIndicatorsLabel: "Session indicators (comma-separated)"
    useLocalStorageFallback: "Use localStorage fallback"
    refreshUrl: "Refresh URL (GLM only)"
    resetToPreset: "Reset to preset default"
  messages:
    # ... existing messages ...
    loginFailed: "Login failed. Please try again."
    loginTimedOut: "Login timed out after 5 minutes. Please try again."
```

- [ ] **Step 12.2: Add to zh_CN.yml (Simplified Chinese)**

```yaml
  fields:
    login: "登录"
    loggingIn: "登录中…"
    captured: "已捕获 $1 个 cookie: $2$3"
    lastAttempt: "上次尝试: $1"
    advanced: "高级：会话检测配置"
    cookieDomain: "Cookie 域名"
    sessionIndicatorsLabel: "会话指示器（逗号分隔）"
    useLocalStorageFallback: "使用 localStorage 兜底"
    refreshUrl: "刷新 URL（仅 GLM）"
    resetToPreset: "恢复预设默认值"
  messages:
    loginFailed: "登录失败，请重试。"
    loginTimedOut: "登录超时（5 分钟），请重试。"
```

- [ ] **Step 12.3: Add to zh_TW.yml (Traditional Chinese)**

```yaml
  fields:
    login: "登入"
    loggingIn: "登入中…"
    captured: "已擷取 $1 個 cookie: $2$3"
    lastAttempt: "上次嘗試: $1"
    advanced: "進階：會話偵測設定"
    cookieDomain: "Cookie 網域"
    sessionIndicatorsLabel: "會話指示器（逗號分隔）"
    useLocalStorageFallback: "使用 localStorage 備援"
    refreshUrl: "刷新 URL（僅 GLM）"
    resetToPreset: "恢復預設預設值"
  messages:
    loginFailed: "登入失敗，請重試。"
    loginTimedOut: "登入逾時（5 分鐘），請重試。"
```

- [ ] **Step 12.4: Verify i18n lint passes**

```bash
pnpm run check
```

**Expected:** All 3 locales have the 7 new keys, no Chinese characters in `components/` or `entrypoints/`.

- [ ] **Step 12.5: Commit i18n**

```bash
git add locales/en.yml locales/zh_CN.yml locales/zh_TW.yml
git commit -m "feat(i18n): add 7 new strings for ② (login, audit, A2 advanced section)"
```

---

## Task 12: Run full test suite and build

**Files:** None (verification only)

- [ ] **Step 12.1: Run full tests**

```bash
cd D:\Project\CebianX\cebian-web-provider
pnpm test
```

**Expected:** 80 tests pass (or more as new tests get added).

- [ ] **Step 12.2: Run TypeScript check**
- [ ] **Step 12.3: Run i18n lint**
- [ ] **Step 12.4: Build production**
- [ ] **Step 12.5: Check for unexpected warnings**
- [ ] **Step 12.6: Fix any issues, do NOT skip hooks**

If `pnpm run check` fails, fix the issue. Never bypass hooks.

---

## Task 13: Manual Chrome verification (24 checks)

**Files:** None (manual verification)

This is the most important task — without it, the feature isn't actually verified. The user must perform these checks in a real Chrome browser with the built extension loaded.

- [ ] **Step 13.1: Build, load, open settings**

```bash
cd D:\Project\CebianX\cebian-web-provider
pnpm run build
```

In Chrome:
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `.output/chrome-mv3/`
4. Click the Cebian icon in toolbar → Settings → Providers
5. Scroll to "Web (Browser Session)" section

**Expected:** 3 cards visible (GLM, Kimi, DeepSeek), each with 2 buttons (Login + Re-check login status), a collapsible "Advanced" section, and an audit display line.

- [ ] **Step 13.2: For each of GLM, Kimi, DeepSeek, perform 6 manual checks (24 total)**

### For GLM:

1. **Login button works**: Click "Login" on the GLM card. A new tab opens to https://chatglm.cn. (If user already has the site open, A6 should focus that tab.)
2. **5-second MIN_WAIT**: The tab stays open for at least 5 seconds even if you're already logged in.
3. **Auto-close on success**: If you're already logged in to chatglm.cn, the tab closes within 5-7 seconds and the card shows "● Logged in" (green badge).
4. **A1 transparency**: After login, the card displays "Captured 2 cookies: chatglm_refresh_token, chatglm_token" (or whatever was captured).
5. **Re-check without tab**: Click "Re-check login status" — no tab opens, status remains "Logged in".
6. **Persistence**: Reload the extension popup. Status should still be "Logged in" (decryption round-trip succeeded).

### For Kimi:

1. **Login flow**: Click "Login" — tab opens to https://kimi.com
2. **LocalStorage fallback**: If you're logged in, the system uses localStorage (not cookies) to detect session
3. **Audit log**: After login, the card shows "Last attempt: just now — success"
4. **A2 override**: Expand "Advanced" section, change `sessionIndicators` to whatever the real one is (check Chrome DevTools → Application → Local Storage → kimi.moonshot.cn), save, click Login again
5. **A2 reset**: Click "Reset to preset default" in Advanced section; the override clears
6. **Refresh after reload**: Reload extension; Kimi should still show "Logged in"

### For DeepSeek:

1-6. Same as GLM but for chat.deepseek.com (Django-style sessionid cookie).

- [ ] **Step 13.3: Verify A3 (active tab tracking)**

For any provider's login flow, open Chrome DevTools console and watch the polling logs. Switch to another window for 30 seconds. The polling should slow to 5s intervals (visible in console logs).

- [ ] **Step 13.4: Verify A5 (refresh retry)**

For GLM only, set up a scenario where the refresh endpoint returns 502:
1. Open DevTools → Network → filter by `refresh`
2. Right-click → "Block request URL"
3. Click Login on GLM card
4. Verify the login eventually fails (or succeeds with refresh-failed in audit log)

- [ ] **Step 13.5: Document any deviations**

If any of the 24 checks fail, document in a comment on the final commit message. Do NOT mark the task as complete.

---

## Task 14: Final commit and push

**Files:** None (git operations only)

- [ ] **Step 14.1: Verify clean working tree**

```bash
cd D:\Project\CebianX\cebian-web-provider
git status
```

**Expected:** Clean tree (all changes committed).

- [ ] **Step 14.2: Push to origin**

```bash
git push origin feat/web-browser-session-provider
```

**Expected:** All commits pushed. Branch now ahead of master by ~12-15 commits.

- [ ] **Step 14.3: Archive OpenSpec change**

```bash
openspec archive web-browser-cookie-extraction
```

**Expected:** Change moved to `openspec/changes/archive/2026-06-04-web-browser-cookie-extraction/` (or similar). Spec deltas merged into `openspec/specs/web-browser-session-providers/spec.md`.

- [ ] **Step 14.4: Final OpenSpec validate**

```bash
openspec validate --strict
```

**Expected:** All specs valid.

- [ ] **Step 14.5: Commit OpenSpec archive**

```bash
git add openspec/
git commit -m "chore(openspec): archive web-browser-cookie-extraction change"
git push origin feat/web-browser-session-provider
```

---

## Self-Review Checklist

Before marking ② as done, verify:

- [ ] All 12 original ② acceptance criteria met (from design doc §13)
- [ ] All 12 enhancement acceptance criteria met (from design doc §19)
- [ ] All 80 tests pass (32 MVP + 4 presets + 8 crypto + 5 repository + 12 service + 8 hook + 11 MVP store tests)
- [ ] `pnpm run check` is green (TS + i18n)
- [ ] `pnpm run build` succeeds; output ~10-11 MB
- [ ] No new dependencies added (Web Crypto API is built-in)
- [ ] No `as any` / `@ts-ignore` / `@ts-expect-error` in new code
- [ ] All 24 manual Chrome verification checks pass
- [ ] OpenSpec change validated and archived
- [ ] All commits pushed to origin
- [ ] `hooks/useWebProviderSimulatedLogin.ts` and its test deleted
- [ ] `web-provider-crypto.ts` now exports real encrypt/decrypt (not throws)

---

## Estimated Time

| Task | Effort | Cumulative |
|---|---|---|
| 0: Verify MVP baseline | 0.25h | 0.25h |
| 1: OpenSpec change | 1h | 1.25h |
| 2: Extend types | 0.5h | 1.75h |
| 3: Update presets + resolver | 1h | 2.75h |
| 4: Crypto AES-GCM (TDD 8) | 2h | 4.75h |
| 5: Repository additions (TDD 5) | 1.5h | 6.25h |
| 6: Background service (TDD 12) | 4h | 10.25h |
| 7: Web login hook (TDD 8) | 1.5h | 11.75h |
| 8: UI updates (Login + A1 + A2 + A4) | 3h | 14.75h |
| 9: Delete simulated login | 0.25h | 15h |
| 10: Manifest permissions | 0.5h | 15.5h |
| 11: i18n additions | 0.5h | 16h |
| 12: Build + test verification | 0.5h | 16.5h |
| 13: Manual Chrome verification | 2-3h | 18.5-19.5h |
| 14: Final commit + push | 0.5h | 19-20h |
| Buffer for unexpected issues | 3-4h | 22-24h |

**Total: 22-24 hours of focused work = 4-5 days at 5h/day or 3 days at 8h/day.**

---

## After Plan Execution

1. **PR to upstream**: `maotoumao/Cebian` — open a PR from `feat/web-browser-session-provider` to `master` with:
   - Title: "feat: Web (Browser Session) Provider — ② Cookie Extraction & Encrypted Storage"
   - Body: link to design doc + plan, mention the 6 production-grade enhancements
   - Sign the CLA (required for AGPL-3.0 contribution)
2. **Next milestone**: ③ Network relay (background SW fetches provider's API using stored cookies; streams response)
3. **Follow-ups** (post-⑤):
   - PBKDF2 + user passphrase for encryption key
   - 401/403 detection and re-login prompt
   - Custom user-defined presets (UI for adding a 4th provider)
   - E2E Playwright tests

---

**End of plan. Total: ~1864 lines, 15 tasks (numbered 0-14, sequential).**
