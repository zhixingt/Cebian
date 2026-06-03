# Web (Browser Session) Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Web (Browser Session)" provider category to Cebian's settings page that lets users reuse their logged-in browser session (chatglm.cn, kimi.com, chat.deepseek.com) as LLM auth — MVP scope is **Settings UI only with mocked login state**, persisted to Dexie with an encryption field reserved for future milestones.

**Architecture:** 4 layers (UI / hooks / Dexie repository / config presets). 10 new files + 4 modifications. All persistence via Dexie; all UI state lifted to a single `useWebProviders` hook; a separate `useWebProviderSimulatedLogin` hook drives the 1-2 second mocked login flow.

**Tech Stack:** WXT 0.20 + React 19 + TypeScript 5.9 + Tailwind 4 + Dexie 4 + shadcn/ui + `@wxt-dev/i18n` + vitest + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-06-03-web-browser-session-provider-design.md` (already approved and committed: 2f6aa63, 384351d).

**Project root:** `D:\Project\CebianX\Cebian`

---

## File Structure

### New files (10 source + 5 test)

| File | Responsibility | LOC est. |
|---|---|---|
| `lib/types.ts` (modification) | Add `WebProvider`, `LoginStatus` types | +30 |
| `lib/ai-config/web-provider-presets.ts` | 3 built-in presets (GLM, Kimi, DeepSeek) | 80 |
| `lib/ai-config/web-provider-store.ts` | `WebProviderRepository` class + singleton | 120 |
| `lib/ai-config/web-provider-crypto.ts` | Encryption placeholder (throws in MVP) | 40 |
| `hooks/useWebProviders.ts` | CRUD + Dexie persistence hook | 150 |
| `hooks/useWebProviderSimulatedLogin.ts` | 1-2s mock flow with 70% success | 60 |
| `components/settings/provider/WebProviderCard.tsx` | One card per provider | 180 |
| `components/settings/sections/WebProvidersSubSection.tsx` | Container mapping providers to cards | 80 |
| `components/settings/provider/EmptyWebProvidersState.tsx` | Dexie-error fallback UI | 30 |
| `__tests__/lib/ai-config/web-provider-store.test.ts` | 10 Repository test cases | 150 |
| `__tests__/hooks/useWebProviders.test.ts` | 8 hook test cases | 120 |
| `__tests__/hooks/useWebProviderSimulatedLogin.test.ts` | 6 hook test cases | 100 |
| `__tests__/lib/ai-config/web-provider-crypto.test.ts` | 3 crypto placeholder tests | 30 |
| `__tests__/components/settings/provider/WebProviderCard.test.tsx` | 4 component test cases | 100 |

### Modified files (4)

| File | Change |
|---|---|
| `lib/db.ts` | Add `webProviders` table to `version(2)` |
| `components/settings/sections/ProvidersSection.tsx` | Append `<WebProvidersSubSection />` at the end |
| `scripts/lint-i18n.mjs` | Add `'webProviders'` to `ALLOWED_TOP_KEYS` |
| `locales/en.yml`, `locales/zh_CN.yml`, `locales/zh_TW.yml` | New `webProviders` namespace (parity required) |

---

## Pre-Task: Optional worktree

```bash
# Optional: isolate this work from current master
cd D:\Project\CebianX
git -C Cebian worktree add ../cebian-web-provider -b feat/web-browser-session-provider
cd ../cebian-web-provider
# All subsequent commands run in this directory
```

If you skip worktree, just work on `master` directly. Either is fine for an MVP that hasn't been pushed yet.

---

## Task 0: Verify environment and test infrastructure

**Files:** None (verification only)

- [ ] **Step 0.1: Verify tools**

```bash
cd D:\Project\CebianX\Cebian
node --version      # expect v20+ (project requires)
pnpm --version      # expect 10+
git --version       # expect 2.x
openspec --version  # expect 1.3+
```

- [ ] **Step 0.2: Check if vitest is already installed**

```bash
grep -E '"vitest"|"@vitest' package.json
```

**Expected behavior:**
- If `vitest` appears in `devDependencies`: skip to Step 0.4
- If absent: continue to Step 0.3

- [ ] **Step 0.3: Install test stack (only if vitest missing)**

```bash
pnpm add -D vitest @vitest/ui @testing-library/react @testing-library/dom @testing-library/jest-dom jsdom fake-indexeddb
```

**Expected:** dependencies added to `package.json`, `node_modules/` populated, exit code 0.

- [ ] **Step 0.4: Check if a test script exists**

```bash
grep -E '"test":' package.json
```

If `"test"` is missing, add it. Open `package.json` and locate the `"scripts"` block. Add this entry (alphabetical position is fine; do not duplicate if present):

```json
"test": "vitest run",
"test:watch": "vitest",
```

- [ ] **Step 0.5: Run a smoke test to verify infrastructure**

Create `__tests__/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('smoke test', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:

```bash
pnpm test
```

**Expected:** `1 passed`. If FAIL, the most common causes are:
- `vitest.config.ts` missing — create one:

```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
});
```

- Also create `__tests__/setup.ts`:

```typescript
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
```

Re-run `pnpm test` until it passes.

- [ ] **Step 0.6: Delete smoke test (it served its purpose)**

```bash
rm __tests__/smoke.test.ts
```

- [ ] **Step 0.7: Commit test infrastructure**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts __tests__/setup.ts
git commit -m "chore(test): add vitest + fake-indexeddb + jsdom test infrastructure"
```

**If vitest was already installed:** only stage and commit files that actually changed (likely none). Skip this commit.

---

## Task 1: Add core types

**Files:**
- Modify: `lib/types.ts` (add exports)

- [ ] **Step 1.1: Inspect existing `lib/types.ts`**

```bash
cat lib/types.ts | head -20
```

This is to learn the existing import / export style.

- [ ] **Step 1.2: Append WebProvider and LoginStatus types**

Open `lib/types.ts` in your editor. At the **end of the file**, append:

```typescript
// ──────────────────────────────────────────────────────────────
// Web (Browser Session) providers
// ──────────────────────────────────────────────────────────────

/**
 * Login state for a web provider.
 * - 'unknown'   : user has never checked
 * - 'checking'  : transient — NEVER persisted to Dexie
 * - 'loggedIn'  : confirmed (mocked in MVP, real in ②)
 * - 'loggedOut' : unconfirmed (mocked in MVP, real in ②)
 */
export type LoginStatus =
  | 'unknown'
  | 'checking'
  | 'loggedIn'
  | 'loggedOut';

/**
 * Persisted configuration for one web provider.
 * `encryptedCookieBundle` is RESERVED for ② (real cookie storage);
 * MVP always writes `null`.
 */
export interface WebProvider {
  presetId: 'glm' | 'kimi' | 'deepseek';
  enabled: boolean;
  loginStatus: Exclude<LoginStatus, 'checking'>;
  modelId: string;
  supportsToolCalls: boolean;
  supportsReasoning: boolean;
  lastCheckedAt: string | null;
  encryptedCookieBundle: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 1.3: Verify TypeScript compiles**

```bash
pnpm run check
```

**Expected:** `Done in Xs` with no red errors. (The i18n lint will also run; that's fine.)

- [ ] **Step 1.4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add WebProvider and LoginStatus interfaces"
```

---

## Task 2: Create preset definitions

**Files:**
- Create: `lib/ai-config/web-provider-presets.ts`

- [ ] **Step 2.1: Create the file**

Create `lib/ai-config/web-provider-presets.ts` with the following content:

```typescript
import type { WebProvider } from '../types';

/**
 * Built-in web AI provider presets.
 * Adding a new preset = append an entry here + add 3 i18n keys.
 * User-defined presets are a future feature; not supported in MVP.
 */
export interface WebProviderPreset {
  /** Unique id, matches WebProvider['presetId'] */
  id: WebProvider['presetId'];

  /** Display name (i18n key, resolved at render time) */
  displayNameKey: string;

  /** Short description (i18n key) */
  descriptionKey: string;

  /** Official website URL (target of the "Open" button) */
  loginUrl: string;

  /** Default Model ID */
  defaultModelId: string;

  /** Recommended capability flags; user can override */
  defaultSupportsToolCalls: boolean;
  defaultSupportsReasoning: boolean;
}

export const WEB_PROVIDER_PRESETS: readonly WebProviderPreset[] = [
  {
    id: 'glm',
    displayNameKey: 'webProviders.presets.glm.name',
    descriptionKey: 'webProviders.presets.glm.description',
    loginUrl: 'https://chatglm.cn',
    defaultModelId: 'GLM-4.6',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
  },
  {
    id: 'kimi',
    displayNameKey: 'webProviders.presets.kimi.name',
    descriptionKey: 'webProviders.presets.kimi.description',
    loginUrl: 'https://kimi.com',
    defaultModelId: 'kimi-k2-0905-preview',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
  },
  {
    id: 'deepseek',
    displayNameKey: 'webProviders.presets.deepseek.name',
    descriptionKey: 'webProviders.presets.deepseek.description',
    loginUrl: 'https://chat.deepseek.com',
    defaultModelId: 'deepseek-chat',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: true,
  },
] as const;
```

- [ ] **Step 2.2: Verify it compiles**

```bash
pnpm run check
```

**Expected:** no errors.

- [ ] **Step 2.3: Commit**

```bash
git add lib/ai-config/web-provider-presets.ts
git commit -m "feat(ai-config): add 3 built-in web provider presets (GLM, Kimi, DeepSeek)"
```

---

## Task 3: Extend Dexie schema

**Files:**
- Modify: `lib/db.ts` (add `webProviders` table to `version(2)`)

- [ ] **Step 3.1: Inspect existing `lib/db.ts`**

```bash
cat lib/db.ts
```

Look for:
1. Where tables are declared (e.g. `chats!: Table<...>`)
2. Where `this.version(N).stores({...})` is called
3. The current highest version number (likely `1`)

- [ ] **Step 3.2: Add the WebProvider import**

At the top of `lib/db.ts`, add the import next to other type imports:

```typescript
import type { WebProvider } from './types';
```

- [ ] **Step 3.3: Add the `webProviders` table declaration**

In the `CebianDB` class body, alongside other table declarations, add:

```typescript
  webProviders!: Table<WebProvider, string>;
```

(`Table<WebProvider, string>` — first generic = row type, second = primary key type)

- [ ] **Step 3.4: Add a new `version(2)` block**

Find the end of the `constructor()` method. After the last `this.version(N).stores({...})` block, add:

```typescript
    this.version(2).stores({
      // ... existing stores (copy them from version(1) here too) ...
      webProviders: 'presetId, enabled, updatedAt',
    });
```

**CRITICAL:** You must copy ALL existing table definitions from `version(1)` into `version(2)`. Dexie compares versions; missing tables in the new version will cause data loss.

Example: if `version(1)` has `this.version(1).stores({ chats: 'id, ...', messages: '...' })`, then `version(2)` should be:

```typescript
    this.version(2).stores({
      chats: 'id, ...',          // copied from version(1)
      messages: '...',           // copied from version(1)
      webProviders: 'presetId, enabled, updatedAt',  // new
    });
```

- [ ] **Step 3.5: Verify**

```bash
pnpm run check
```

**Expected:** compiles, no errors.

- [ ] **Step 3.6: Commit**

```bash
git add lib/db.ts
git commit -m "feat(db): add webProviders table in Dexie version(2)"
```

---

## Task 4: Crypto placeholder (TDD)

**Files:**
- Create: `__tests__/lib/ai-config/web-provider-crypto.test.ts`
- Create: `lib/ai-config/web-provider-crypto.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `__tests__/lib/ai-config/web-provider-crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  encryptCookieBundle,
  decryptCookieBundle,
  isEncryptionEnabled,
} from '@/lib/ai-config/web-provider-crypto';

describe('web-provider-crypto (MVP placeholder)', () => {
  it('isEncryptionEnabled returns false', () => {
    expect(isEncryptionEnabled()).toBe(false);
  });

  it('encryptCookieBundle throws not implemented', async () => {
    await expect(encryptCookieBundle('any-string')).rejects.toThrow(
      /not implemented in MVP/i,
    );
  });

  it('decryptCookieBundle throws not implemented', async () => {
    await expect(decryptCookieBundle('any-string')).rejects.toThrow(
      /not implemented in MVP/i,
    );
  });
});
```

- [ ] **Step 4.2: Run the test, verify it fails**

```bash
pnpm test __tests__/lib/ai-config/web-provider-crypto.test.ts
```

**Expected:** FAIL with `Failed to resolve import` (module does not exist yet).

- [ ] **Step 4.3: Write the minimal implementation**

Create `lib/ai-config/web-provider-crypto.ts`:

```typescript
/**
 * Encryption placeholder for web provider cookie bundles.
 * MVP: all methods throw or return false. Real AES-GCM via Web Crypto
 *       is reserved for ② (real cookie extraction).
 *
 * The public surface is defined here so call sites compile today;
 * ② will fill in real implementations without changing any caller.
 */

const NOT_IMPLEMENTED = 'web-provider-crypto: not implemented in MVP';

export async function encryptCookieBundle(_bundle: string): Promise<string> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function decryptCookieBundle(_ciphertext: string): Promise<string> {
  throw new Error(NOT_IMPLEMENTED);
}

export function isEncryptionEnabled(): boolean {
  return false;
}
```

- [ ] **Step 4.4: Run the test, verify it passes**

```bash
pnpm test __tests__/lib/ai-config/web-provider-crypto.test.ts
```

**Expected:** 3 passed.

- [ ] **Step 4.5: Commit**

```bash
git add lib/ai-config/web-provider-crypto.ts __tests__/lib/ai-config/web-provider-crypto.test.ts
git commit -m "feat(ai-config): add crypto placeholder with MVP not-implemented semantics"
```

---

## Task 5: Repository (TDD, 10 cases)

**Files:**
- Create: `__tests__/lib/ai-config/web-provider-store.test.ts`
- Create: `lib/ai-config/web-provider-store.ts`

This is the largest TDD task. We work in 3 cycles:

### Cycle 1: list() + auto-seed

- [ ] **Step 5.1: Write failing tests for `list()` and `get()`**

Create `__tests__/lib/ai-config/web-provider-store.test.ts`:

```typescript
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import { getDb } from '@/lib/db';

describe('WebProviderRepository', () => {
  beforeEach(async () => {
    // Reset DB to clean state for each test
    const db = getDb();
    await db.webProviders.clear();
  });

  describe('list()', () => {
    it('seeds 3 presets on empty DB', async () => {
      const providers = await getWebProviderRepository().list();
      expect(providers).toHaveLength(3);
      expect(providers.map((p) => p.presetId).sort()).toEqual([
        'deepseek',
        'glm',
        'kimi',
      ]);
    });

    it('all seeded providers have encryptedCookieBundle === null', async () => {
      const providers = await getWebProviderRepository().list();
      expect(providers.every((p) => p.encryptedCookieBundle === null)).toBe(
        true,
      );
    });

    it('does not re-seed if presets already exist', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      // Manually update one provider
      await repo.setEnabled('glm', false);
      const second = await repo.list();
      const glm = second.find((p) => p.presetId === 'glm');
      expect(glm?.enabled).toBe(false); // update preserved, not overwritten
    });
  });

  describe('get()', () => {
    it('returns the provider for a known presetId', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      const glm = await repo.get('glm');
      expect(glm?.presetId).toBe('glm');
      expect(glm?.loginUrl).toBeUndefined(); // loginUrl is on Preset, not Provider
    });

    it('returns undefined for unknown presetId', async () => {
      const repo = getWebProviderRepository();
      const result = await repo.get('nonexistent');
      expect(result).toBeUndefined();
    });
  });
});
```

- [ ] **Step 5.2: Run, verify failure**

```bash
pnpm test __tests__/lib/ai-config/web-provider-store.test.ts
```

**Expected:** FAIL (module doesn't exist).

- [ ] **Step 5.3: Write minimal `list()` and `get()` implementation**

Create `lib/ai-config/web-provider-store.ts`:

```typescript
import type { CebianDB } from '../db';
import type { WebProvider, LoginStatus } from '../types';
import { getDb } from '../db';
import { WEB_PROVIDER_PRESETS } from './web-provider-presets';

export class WebProviderRepository {
  constructor(private db: CebianDB) {}

  async list(): Promise<WebProvider[]> {
    const existing = await this.db.webProviders.toArray();
    const existingIds = new Set(existing.map((p) => p.presetId));
    const missing = WEB_PROVIDER_PRESETS
      .filter((p) => !existingIds.has(p.id))
      .map((p) => this.createFromPreset(p));
    if (missing.length > 0) {
      await this.db.webProviders.bulkAdd(missing);
    }
    return this.db.webProviders.orderBy('updatedAt').reverse().toArray();
  }

  async get(presetId: string): Promise<WebProvider | undefined> {
    return this.db.webProviders.get(presetId);
  }

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
      createdAt: now,
      updatedAt: now,
    };
  }
}

let _instance: WebProviderRepository | null = null;
export function getWebProviderRepository(): WebProviderRepository {
  if (!_instance) {
    _instance = new WebProviderRepository(getDb());
  }
  return _instance;
}
```

- [ ] **Step 5.4: Run, verify pass for first 5 tests**

```bash
pnpm test __tests__/lib/ai-config/web-provider-store.test.ts
```

**Expected:** 5 passed.

### Cycle 2: setters (setEnabled, setLoginStatus)

- [ ] **Step 5.5: Append failing tests for setters**

Open `__tests__/lib/ai-config/web-provider-store.test.ts` and add this new `describe` block before the closing `});` of the outer describe:

```typescript
  describe('setEnabled', () => {
    it('persists enabled state and updates updatedAt', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      const before = await repo.get('glm');
      // Sleep 5ms so updatedAt changes observably
      await new Promise((r) => setTimeout(r, 5));
      await repo.setEnabled('glm', false);
      const after = await repo.get('glm');
      expect(after?.enabled).toBe(false);
      expect(after?.updatedAt).not.toBe(before?.updatedAt);
    });
  });

  describe('setLoginStatus', () => {
    it('persists loggedIn and updates lastCheckedAt', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setLoginStatus('kimi', 'loggedIn');
      const result = await repo.get('kimi');
      expect(result?.loginStatus).toBe('loggedIn');
      expect(result?.lastCheckedAt).not.toBeNull();
    });

    it('persists loggedOut', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setLoginStatus('deepseek', 'loggedOut');
      const result = await repo.get('deepseek');
      expect(result?.loginStatus).toBe('loggedOut');
    });
  });
```

- [ ] **Step 5.6: Run, verify the new tests fail**

```bash
pnpm test __tests__/lib/ai-config/web-provider-store.test.ts
```

**Expected:** the 5 original tests pass; the 3 new ones fail with "is not a function".

- [ ] **Step 5.7: Implement the two setters**

In `lib/ai-config/web-provider-store.ts`, add the methods inside the class (right after `get`):

```typescript
  async setEnabled(presetId: string, enabled: boolean): Promise<void> {
    await this.db.webProviders.update(presetId, {
      enabled,
      updatedAt: new Date().toISOString(),
    });
  }

  async setLoginStatus(
    presetId: string,
    status: Exclude<LoginStatus, 'checking'>,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      loginStatus: status,
      lastCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
```

- [ ] **Step 5.8: Run, verify all 8 tests pass**

```bash
pnpm test __tests__/lib/ai-config/web-provider-store.test.ts
```

**Expected:** 8 passed.

### Cycle 3: setModelId, setCapability

- [ ] **Step 5.9: Append failing tests for the remaining setters**

Add to the test file (before the final `});`):

```typescript
  describe('setModelId', () => {
    it('updates modelId and updatedAt', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setModelId('glm', 'GLM-4.6-custom');
      const result = await repo.get('glm');
      expect(result?.modelId).toBe('GLM-4.6-custom');
    });
  });

  describe('setCapability', () => {
    it('updates supportsToolCalls', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setCapability('kimi', 'supportsToolCalls', false);
      const result = await repo.get('kimi');
      expect(result?.supportsToolCalls).toBe(false);
    });

    it('updates supportsReasoning', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setCapability('deepseek', 'supportsReasoning', false);
      const result = await repo.get('deepseek');
      expect(result?.supportsReasoning).toBe(false);
    });
  });
```

- [ ] **Step 5.10: Run, verify 2 new tests fail**

```bash
pnpm test __tests__/lib/ai-config/web-provider-store.test.ts
```

**Expected:** 8 passed, 2 new fail.

- [ ] **Step 5.11: Implement setModelId and setCapability**

In `lib/ai-config/web-provider-store.ts`, add inside the class (after `setLoginStatus`):

```typescript
  async setModelId(presetId: string, modelId: string): Promise<void> {
    await this.db.webProviders.update(presetId, {
      modelId,
      updatedAt: new Date().toISOString(),
    });
  }

  async setCapability(
    presetId: string,
    capability: 'supportsToolCalls' | 'supportsReasoning',
    value: boolean,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      [capability]: value,
      updatedAt: new Date().toISOString(),
    });
  }
```

- [ ] **Step 5.12: Run, verify all 10 tests pass**

```bash
pnpm test __tests__/lib/ai-config/web-provider-store.test.ts
```

**Expected:** 10 passed.

- [ ] **Step 5.13: Commit**

```bash
git add lib/ai-config/web-provider-store.ts __tests__/lib/ai-config/web-provider-store.test.ts
git commit -m "feat(ai-config): add WebProviderRepository with TDD coverage (10 cases)"
```

---

## Task 6: i18n additions

**Files:**
- Modify: `scripts/lint-i18n.mjs` (add 'webProviders' to allow-list)
- Modify: `locales/en.yml`
- Modify: `locales/zh_CN.yml`
- Modify: `locales/zh_TW.yml`

- [ ] **Step 6.1: Find the allow-list line**

```bash
grep -n "ALLOWED_TOP_KEYS" scripts/lint-i18n.mjs
```

- [ ] **Step 6.2: Add 'webProviders' to the allow-list**

Open `scripts/lint-i18n.mjs`. In the `ALLOWED_TOP_KEYS` Set, append `'webProviders'` after `'agent'`:

```javascript
const ALLOWED_TOP_KEYS = new Set([
  'extName', 'extDescription', 'actionTitle',
  'common', 'chat', 'settings', 'provider', 'tools', 'vfs', 'dialogs', 'errors', 'agent',
  'webProviders',
]);
```

- [ ] **Step 6.3: Add English namespace**

Open `locales/en.yml`. Scroll to the **end** and append:

```yaml

# ───── Web (Browser Session) providers ─────
webProviders:
  sectionTitle: "Web (Browser Session)"
  sectionDescription: "Reuse your browser's login state. No API key required."
  presets:
    glm:
      name: "GLM (Zhipu)"
      description: "ChatGLM web version"
    kimi:
      name: "Kimi (Moonshot)"
      description: "Moonshot AI web version"
    deepseek:
      name: "DeepSeek"
      description: "DeepSeek web version"
  fields:
    enabled: "Enabled"
    modelIdLabel: "Model ID"
    modelIdHelp: "Default is the recommended model. Edit only if you know what you're doing."
    capabilities: "Capabilities"
    toolCalls: "Tool calls"
    reasoning: "Reasoning"
    recheck: "Re-check login status"
    checking: "Checking…"
    openWebsite: "Open website"
  status:
    loggedIn: "Logged in"
    loggedOut: "Not logged in"
    neverChecked: "Never checked"
  messages:
    loadFailed: "Failed to load web providers. Please reopen the settings page."
    recheckFailed: "Login check failed. Please make sure you're signed in to the website."
```

- [ ] **Step 6.4: Add zh_CN namespace**

Open `locales/zh_CN.yml`. Append at the **end**:

```yaml

# ───── Web (Browser Session) providers ─────
webProviders:
  sectionTitle: "网页版（浏览器会话）"
  sectionDescription: "复用浏览器已登录状态，无需 API Key。"
  presets:
    glm:
      name: "GLM（智谱）"
      description: "智谱 ChatGLM 网页版"
    kimi:
      name: "Kimi（月之暗面）"
      description: "月之暗面 Moonshot 网页版"
    deepseek:
      name: "DeepSeek（深度求索）"
      description: "深度求索网页版"
  fields:
    enabled: "已启用"
    modelIdLabel: "模型 ID"
    modelIdHelp: "默认填入推荐模型。了解后再修改。"
    capabilities: "能力"
    toolCalls: "工具调用"
    reasoning: "推理"
    recheck: "重新检查登录状态"
    checking: "检查中…"
    openWebsite: "打开官网"
  status:
    loggedIn: "已登录"
    loggedOut: "未登录"
    neverChecked: "从未检查"
  messages:
    loadFailed: "加载网页版提供商失败，请重新打开设置页。"
    recheckFailed: "登录检查失败，请确认你已在该网站登录。"
```

- [ ] **Step 6.5: Add zh_TW namespace**

Open `locales/zh_TW.yml`. Append at the **end**:

```yaml

# ───── Web (Browser Session) providers ─────
webProviders:
  sectionTitle: "網頁版（瀏覽器會話）"
  sectionDescription: "複用瀏覽器已登入狀態，無需 API Key。"
  presets:
    glm:
      name: "GLM（智譜）"
      description: "智譜 ChatGLM 網頁版"
    kimi:
      name: "Kimi（月之暗面）"
      description: "月之暗面 Moonshot 網頁版"
    deepseek:
      name: "DeepSeek（深度求索）"
      description: "深度求索網頁版"
  fields:
    enabled: "已啟用"
    modelIdLabel: "模型 ID"
    modelIdHelp: "預設填入推薦模型。了解後再修改。"
    capabilities: "能力"
    toolCalls: "工具呼叫"
    reasoning: "推理"
    recheck: "重新檢查登入狀態"
    checking: "檢查中…"
    openWebsite: "開啟官網"
  status:
    loggedIn: "已登入"
    loggedOut: "未登入"
    neverChecked: "從未檢查"
  messages:
    loadFailed: "載入網頁版供應商失敗，請重新開啟設定頁。"
    recheckFailed: "登入檢查失敗，請確認你已在該網站登入。"
```

- [ ] **Step 6.6: Verify parity**

```bash
pnpm run check
```

**Expected:** no errors, all 3 i18n lint checks pass:
- `locale top-level keys conform to allow-list`
- `all keys are in parity across en/zh_CN/zh_TW`
- `no Chinese characters found in scanned source`

If any of these fail, the most common cause is a typo in one of the YAML files. Re-check indentation (2 spaces, no tabs).

- [ ] **Step 6.7: Commit**

```bash
git add scripts/lint-i18n.mjs locales/en.yml locales/zh_CN.yml locales/zh_TW.yml
git commit -m "feat(i18n): add webProviders namespace in en/zh_CN/zh_TW"
```

---

## Task 7: useWebProviderSimulatedLogin hook (TDD)

**Files:**
- Create: `__tests__/hooks/useWebProviderSimulatedLogin.test.ts`
- Create: `hooks/useWebProviderSimulatedLogin.ts`

- [ ] **Step 7.1: Write failing tests**

Create `__tests__/hooks/useWebProviderSimulatedLogin.test.ts`:

```typescript
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebProviderSimulatedLogin } from '@/hooks/useWebProviderSimulatedLogin';

describe('useWebProviderSimulatedLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with checkingId === null', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      }),
    );
    expect(result.current.checkingId).toBeNull();
  });

  it('recheck() sets checkingId', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      }),
    );
    act(() => result.current.recheck('glm'));
    expect(result.current.checkingId).toBe('glm');
  });

  it('only one recheck at a time is allowed', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      }),
    );
    act(() => result.current.recheck('glm'));
    act(() => result.current.recheck('kimi')); // ignored
    expect(result.current.checkingId).toBe('glm');
  });

  it('calls onSuccess after 1-2s when Math.random < 0.7', () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({ onSuccess, onFailure }),
    );
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5) // delay 1.5s
      .mockReturnValueOnce(0.3); // success (< 0.7)
    act(() => result.current.recheck('glm'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onSuccess).toHaveBeenCalledWith('glm');
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('calls onFailure after 1-2s when Math.random >= 0.7', () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({ onSuccess, onFailure }),
    );
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.9); // failure
    act(() => result.current.recheck('kimi'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onFailure).toHaveBeenCalledWith('kimi');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('resets checkingId to null after completion', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      }),
    );
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    act(() => result.current.recheck('deepseek'));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.checkingId).toBeNull();
  });
});
```

- [ ] **Step 7.2: Run, verify failure**

```bash
pnpm test __tests__/hooks/useWebProviderSimulatedLogin.test.ts
```

**Expected:** FAIL (module does not exist).

- [ ] **Step 7.3: Implement the hook**

Create `hooks/useWebProviderSimulatedLogin.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import type { WebProvider } from '@/lib/types';

export interface SimulatedLoginConfig {
  onSuccess: (id: WebProvider['presetId']) => void;
  onFailure: (id: WebProvider['presetId']) => void;
}

export interface SimulatedLoginResult {
  recheck: (id: WebProvider['presetId']) => void;
  checkingId: WebProvider['presetId'] | null;
}

/**
 * MVP mock for the "re-check login" flow.
 *   - 1-2 second random delay (looks like a real network call)
 *   - 70% probability of success → calls onSuccess
 *   - 30% probability of failure → calls onFailure
 *   - Only one provider can be "checking" at a time
 *
 * ② will replace this hook's internals with real chrome.cookies.getAll.
 * Callers are unaffected.
 */
export function useWebProviderSimulatedLogin(
  config: SimulatedLoginConfig,
): SimulatedLoginResult {
  const [checkingId, setCheckingId] = useState<WebProvider['presetId'] | null>(
    null,
  );
  const inFlightRef = useRef<WebProvider['presetId'] | null>(null);

  const recheck = useCallback(
    (id: WebProvider['presetId']) => {
      if (inFlightRef.current !== null) return;
      inFlightRef.current = id;
      setCheckingId(id);

      const delay = 1000 + Math.random() * 1000;
      setTimeout(() => {
        const success = Math.random() < 0.7;
        try {
          if (success) config.onSuccess(id);
          else config.onFailure(id);
        } finally {
          inFlightRef.current = null;
          setCheckingId(null);
        }
      }, delay);
    },
    [config],
  );

  return { recheck, checkingId };
}
```

- [ ] **Step 7.4: Run, verify all 6 tests pass**

```bash
pnpm test __tests__/hooks/useWebProviderSimulatedLogin.test.ts
```

**Expected:** 6 passed.

- [ ] **Step 7.5: Commit**

```bash
git add hooks/useWebProviderSimulatedLogin.ts __tests__/hooks/useWebProviderSimulatedLogin.test.ts
git commit -m "feat(hooks): add useWebProviderSimulatedLogin with TDD coverage (6 cases)"
```

---

## Task 8: useWebProviders hook (TDD)

**Files:**
- Create: `__tests__/hooks/useWebProviders.test.ts`
- Create: `hooks/useWebProviders.ts`

- [ ] **Step 8.1: Write failing tests**

Create `__tests__/hooks/useWebProviders.test.ts`:

```typescript
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebProviders } from '@/hooks/useWebProviders';
import { getDb } from '@/lib/db';

describe('useWebProviders', () => {
  beforeEach(async () => {
    await getDb().webProviders.clear();
  });

  it('starts with isLoading=true, then resolves to 3 seeded providers', async () => {
    const { result } = renderHook(() => useWebProviders());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.providers).toHaveLength(3);
    expect(result.current.error).toBeNull();
  });

  it('setEnabled updates Dexie and refreshes state', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setEnabled('glm', false);
    });
    const glm = result.current.providers.find((p) => p.presetId === 'glm');
    expect(glm?.enabled).toBe(false);
  });

  it('setLoginStatus updates state', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setLoginStatus('kimi', 'loggedIn');
    });
    const kimi = result.current.providers.find((p) => p.presetId === 'kimi');
    expect(kimi?.loginStatus).toBe('loggedIn');
  });

  it('setModelId updates state', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setModelId('deepseek', 'deepseek-coder');
    });
    const deepseek = result.current.providers.find(
      (p) => p.presetId === 'deepseek',
    );
    expect(deepseek?.modelId).toBe('deepseek-coder');
  });

  it('setCapability updates the correct capability', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setCapability(
        'glm',
        'supportsToolCalls',
        false,
      );
    });
    const glm = result.current.providers.find((p) => p.presetId === 'glm');
    expect(glm?.supportsToolCalls).toBe(false);
    expect(glm?.supportsReasoning).toBe(true); // unchanged
  });

  it('handles error from repository', async () => {
    // Force an error by clearing the DB then trying to setEnabled
    // on a non-existent preset. Dexie.update throws.
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // setEnabled on unknown id will throw
    await act(async () => {
      // The implementation should not crash the hook; the error should be captured
      try {
        await result.current.update.setEnabled('nonexistent', false);
      } catch {
        // expected
      }
    });
    // hook itself remains stable
    expect(result.current.providers).toHaveLength(3);
  });

  it('cancelled unmount does not set state after unmount', async () => {
    const { result, unmount } = renderHook(() => useWebProviders());
    unmount();
    // Give the initial load time to complete
    await new Promise((r) => setTimeout(r, 50));
    // result.current is frozen post-unmount; just verify no errors
    expect(result.current.providers).toBeDefined();
  });

  it('multiple updates preserve order', async () => {
    const { result } = renderHook(() => useWebProviders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update.setEnabled('glm', false);
      await result.current.update.setModelId('glm', 'GLM-5');
    });
    const glm = result.current.providers.find((p) => p.presetId === 'glm');
    expect(glm?.enabled).toBe(false);
    expect(glm?.modelId).toBe('GLM-5');
  });
});
```

- [ ] **Step 8.2: Run, verify failure**

```bash
pnpm test __tests__/hooks/useWebProviders.test.ts
```

**Expected:** FAIL (module does not exist).

- [ ] **Step 8.3: Implement the hook**

Create `hooks/useWebProviders.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import type { LoginStatus, WebProvider } from '@/lib/types';

export interface UseWebProvidersResult {
  providers: WebProvider[];
  isLoading: boolean;
  error: Error | null;
  update: {
    setEnabled: (
      id: WebProvider['presetId'],
      enabled: boolean,
    ) => Promise<void>;
    setLoginStatus: (
      id: WebProvider['presetId'],
      status: Exclude<LoginStatus, 'checking'>,
    ) => Promise<void>;
    setModelId: (
      id: WebProvider['presetId'],
      modelId: string,
    ) => Promise<void>;
    setCapability: (
      id: WebProvider['presetId'],
      cap: 'supportsToolCalls' | 'supportsReasoning',
      value: boolean,
    ) => Promise<void>;
  };
}

export function useWebProviders(): UseWebProvidersResult {
  const [providers, setProviders] = useState<WebProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const repo = getWebProviderRepository();

  const refresh = useCallback(async () => {
    try {
      const list = await repo.list();
      setProviders(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [repo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      await refresh();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const setEnabled = useCallback(
    async (id: WebProvider['presetId'], enabled: boolean) => {
      try {
        await repo.setEnabled(id, enabled);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [repo, refresh],
  );

  const setLoginStatus = useCallback(
    async (id: WebProvider['presetId'], status: Exclude<LoginStatus, 'checking'>) => {
      try {
        await repo.setLoginStatus(id, status);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [repo, refresh],
  );

  const setModelId = useCallback(
    async (id: WebProvider['presetId'], modelId: string) => {
      try {
        await repo.setModelId(id, modelId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [repo, refresh],
  );

  const setCapability = useCallback(
    async (
      id: WebProvider['presetId'],
      cap: 'supportsToolCalls' | 'supportsReasoning',
      value: boolean,
    ) => {
      try {
        await repo.setCapability(id, cap, value);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [repo, refresh],
  );

  return {
    providers,
    isLoading,
    error,
    update: { setEnabled, setLoginStatus, setModelId, setCapability },
  };
}
```

- [ ] **Step 8.4: Run, verify all 8 tests pass**

```bash
pnpm test __tests__/hooks/useWebProviders.test.ts
```

**Expected:** 8 passed.

If 1-2 tests fail with timing issues, that's OK — adjust by adding `waitFor(...)` in the test or increasing fake timer duration. Do not weaken the assertion.

- [ ] **Step 8.5: Commit**

```bash
git add hooks/useWebProviders.ts __tests__/hooks/useWebProviders.test.ts
git commit -m "feat(hooks): add useWebProviders with TDD coverage (8 cases)"
```

---

## Task 9: WebProviderCard component (TDD)

**Files:**
- Create: `__tests__/components/settings/provider/WebProviderCard.test.tsx`
- Create: `components/settings/provider/WebProviderCard.tsx`

- [ ] **Step 9.1: Write failing tests**

Create `__tests__/components/settings/provider/WebProviderCard.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebProviderCard } from '@/components/settings/provider/WebProviderCard';
import type { WebProvider } from '@/lib/types';
import type { WebProviderPreset } from '@/lib/ai-config/web-provider-presets';

const fakeProvider: WebProvider = {
  presetId: 'glm',
  enabled: true,
  loginStatus: 'unknown',
  modelId: 'GLM-4.6',
  supportsToolCalls: true,
  supportsReasoning: false,
  lastCheckedAt: null,
  encryptedCookieBundle: null,
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
};

const fakePreset: WebProviderPreset = {
  id: 'glm',
  displayNameKey: 'webProviders.presets.glm.name',
  descriptionKey: 'webProviders.presets.glm.description',
  loginUrl: 'https://chatglm.cn',
  defaultModelId: 'GLM-4.6',
  defaultSupportsToolCalls: true,
  defaultSupportsReasoning: false,
};

describe('WebProviderCard', () => {
  it('renders without crashing', () => {
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );
    // Should display GLM somewhere
    expect(screen.getByText(/GLM/i)).toBeInTheDocument();
  });

  it('toggling enable calls onEnabledChange', () => {
    const onEnabledChange = vi.fn();
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={onEnabledChange}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );
    // The enable switch should be the first switch on the page
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]); // toggle enabled
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it('editing modelId calls onModelIdChange', () => {
    const onModelIdChange = vi.fn();
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={onModelIdChange}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );
    const input = screen.getByDisplayValue('GLM-4.6');
    fireEvent.change(input, { target: { value: 'GLM-5' } });
    expect(onModelIdChange).toHaveBeenCalledWith('GLM-5');
  });

  it('clicking recheck calls onRecheck', () => {
    const onRecheck = vi.fn();
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={onRecheck}
      />,
    );
    const button = screen.getByRole('button', { name: /re-check/i });
    fireEvent.click(button);
    expect(onRecheck).toHaveBeenCalled();
  });
});
```

- [ ] **Step 9.2: Run, verify failure**

```bash
pnpm test __tests__/components/settings/provider/WebProviderCard.test.tsx
```

**Expected:** FAIL (component does not exist).

- [ ] **Step 9.3: Implement the component**

Create `components/settings/provider/WebProviderCard.tsx`:

```typescript
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { WebProviderPreset } from '@/lib/ai-config/web-provider-presets';
import type { WebProvider } from '@/lib/types';

export interface WebProviderCardProps {
  provider: WebProvider;
  preset: WebProviderPreset;
  isChecking: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onModelIdChange: (modelId: string) => void;
  onCapabilityChange: (
    capability: 'supportsToolCalls' | 'supportsReasoning',
    value: boolean,
  ) => void;
  onRecheck: () => void;
}

export function WebProviderCard({
  provider,
  preset,
  isChecking,
  onEnabledChange,
  onModelIdChange,
  onCapabilityChange,
  onRecheck,
}: WebProviderCardProps) {
  // Note: i18n labels here are placeholders for the test.
  // The full i18n wiring happens in WebProvidersSubSection.
  return (
    <Card data-testid={`web-provider-card-${provider.presetId}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {provider.loginStatus === 'loggedIn' && (
              <Badge variant="default" data-testid="status-logged-in">
                Logged in
              </Badge>
            )}
            {provider.loginStatus === 'loggedOut' && (
              <Badge variant="destructive" data-testid="status-logged-out">
                Not logged in
              </Badge>
            )}
            {provider.loginStatus === 'unknown' && (
              <Badge variant="secondary" data-testid="status-unknown">
                Never checked
              </Badge>
            )}
            <span className="font-semibold">
              {preset.id.toUpperCase()} — {preset.loginUrl}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Enabled</span>
            <Switch
              checked={provider.enabled}
              onCheckedChange={onEnabledChange}
              aria-label={`Enable ${preset.id}`}
            />
            <Button variant="link" asChild>
              <a href={preset.loginUrl} target="_blank" rel="noreferrer">
                Open
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label htmlFor={`model-${provider.presetId}`} className="text-sm">
            Model ID
          </label>
          <Input
            id={`model-${provider.presetId}`}
            value={provider.modelId}
            onChange={(e) => onModelIdChange(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-6">
          <span className="text-sm">Capabilities:</span>
          <label className="flex items-center gap-2">
            <Switch
              checked={provider.supportsToolCalls}
              onCheckedChange={(v) => onCapabilityChange('supportsToolCalls', v)}
              aria-label="Tool calls"
            />
            <span>Tool calls</span>
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={provider.supportsReasoning}
              onCheckedChange={(v) => onCapabilityChange('supportsReasoning', v)}
              aria-label="Reasoning"
            />
            <span>Reasoning</span>
          </label>
        </div>

        <Button
          variant="outline"
          onClick={onRecheck}
          disabled={isChecking}
        >
          {isChecking ? 'Checking…' : 'Re-check login status'}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 9.4: Run, verify all 4 tests pass**

```bash
pnpm test __tests__/components/settings/provider/WebProviderCard.test.tsx
```

**Expected:** 4 passed.

If "renders without crashing" fails with "GLM not found" — the regex is case-insensitive (`/GLM/i`), should match. If it fails on "no elements found", check your shadcn components render properly (they sometimes depend on specific Tailwind classes or providers).

- [ ] **Step 9.5: Commit**

```bash
git add components/settings/provider/WebProviderCard.tsx __tests__/components/settings/provider/WebProviderCard.test.tsx
git commit -m "feat(ui): add WebProviderCard with TDD coverage (4 cases)"
```

---

## Task 10: Empty state component

**Files:**
- Create: `components/settings/provider/EmptyWebProvidersState.tsx`

(No tests for this — pure presentational fallback, called only on Dexie error path)

- [ ] **Step 10.1: Create the file**

Create `components/settings/provider/EmptyWebProvidersState.tsx`:

```typescript
import { AlertCircle } from 'lucide-react';

export function EmptyWebProvidersState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-destructive/50 p-4 text-sm text-destructive"
    >
      <AlertCircle className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}
```

- [ ] **Step 10.2: Verify it compiles**

```bash
pnpm run check
```

**Expected:** no errors.

- [ ] **Step 10.3: Commit**

```bash
git add components/settings/provider/EmptyWebProvidersState.tsx
git commit -m "feat(ui): add EmptyWebProvidersState for Dexie error path"
```

---

## Task 11: WebProvidersSubSection container

**Files:**
- Create: `components/settings/sections/WebProvidersSubSection.tsx`

(No standalone tests — integration is covered by manual verification in Task 13.)

- [ ] **Step 11.1: Create the file**

Create `components/settings/sections/WebProvidersSubSection.tsx`:

```typescript
import { useWebProviders } from '@/hooks/useWebProviders';
import { useWebProviderSimulatedLogin } from '@/hooks/useWebProviderSimulatedLogin';
import { WEB_PROVIDER_PRESETS } from '@/lib/ai-config/web-provider-presets';
import { useI18n } from '@/lib/i18n'; // adjust import path if different in this project
import { WebProviderCard } from '../provider/WebProviderCard';
import { EmptyWebProvidersState } from '../provider/EmptyWebProvidersState';

export function WebProvidersSubSection() {
  const { providers, update, isLoading, error } = useWebProviders();
  const { recheck, checkingId } = useWebProviderSimulatedLogin({
    onSuccess: (id) => update.setLoginStatus(id, 'loggedIn'),
    onFailure: (id) => update.setLoginStatus(id, 'loggedOut'),
  });
  const t = useI18n(); // adjust based on project convention

  if (error) {
    return <EmptyWebProvidersState message={t('webProviders.messages.loadFailed')} />;
  }

  if (isLoading) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        {t('common.loading') ?? 'Loading…'}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-lg font-semibold">
          {t('webProviders.sectionTitle')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('webProviders.sectionDescription')}
        </p>
      </header>

      <div className="space-y-3">
        {providers.map((provider) => {
          const preset = WEB_PROVIDER_PRESETS.find(
            (p) => p.id === provider.presetId,
          );
          if (!preset) return null;

          return (
            <WebProviderCard
              key={provider.presetId}
              provider={provider}
              preset={preset}
              isChecking={checkingId === provider.presetId}
              onEnabledChange={(v) => update.setEnabled(provider.presetId, v)}
              onModelIdChange={(v) => update.setModelId(provider.presetId, v)}
              onCapabilityChange={(cap, v) =>
                update.setCapability(provider.presetId, cap, v)
              }
              onRecheck={() => recheck(provider.presetId)}
            />
          );
        })}
      </div>
    </section>
  );
}
```

> **Note on `useI18n`:** the project uses `@wxt-dev/i18n` (per `package.json`). The exact import path and hook name depend on the project — check `lib/i18n.ts` for the actual export. If the project exposes `i18n.t(...)` directly, replace `useI18n()` with that call.

- [ ] **Step 11.2: Verify it compiles**

```bash
pnpm run check
```

**Expected:** no errors. If the i18n import is wrong, fix it to match the project's convention.

- [ ] **Step 11.3: Commit**

```bash
git add components/settings/sections/WebProvidersSubSection.tsx
git commit -m "feat(ui): add WebProvidersSubSection container"
```

---

## Task 12: Mount in ProvidersSection

**Files:**
- Modify: `components/settings/sections/ProvidersSection.tsx`

- [ ] **Step 12.1: Inspect existing structure**

```bash
cat components/settings/sections/ProvidersSection.tsx
```

Find:
- The import block at the top
- The main return JSX
- The closing `</section>` or `</div>` of the component

- [ ] **Step 12.2: Add the import**

At the top of the file, add (with the other relative imports):

```typescript
import { WebProvidersSubSection } from './WebProvidersSubSection';
```

- [ ] **Step 12.3: Append the sub-section**

In the JSX, find the last `</div>` or `</section>` of the return statement, and **just before it**, add:

```tsx
<WebProvidersSubSection />
```

- [ ] **Step 12.4: Verify**

```bash
pnpm run check
```

**Expected:** compiles cleanly.

- [ ] **Step 12.5: Commit**

```bash
git add components/settings/sections/ProvidersSection.tsx
git commit -m "feat(settings): mount WebProvidersSubSection in Providers"
```

---

## Task 13: Run full test suite and build

- [ ] **Step 13.1: Run all tests**

```bash
pnpm test
```

**Expected:** all 31 new tests pass (10 + 3 + 6 + 8 + 4). If any fail, **stop and fix before proceeding**.

- [ ] **Step 13.2: Run pnpm check**

```bash
pnpm run check
```

**Expected:** TypeScript 0 errors, i18n lint 0 warnings.

- [ ] **Step 13.3: Run production build**

```bash
pnpm run build
```

**Expected:** build completes successfully, output written to `.output/chrome-mv3/`.

- [ ] **Step 13.4: Commit any build-related changes (e.g., generated types)**

```bash
git status --short
# If .wxt/ or other generated files changed:
git add .
git commit -m "chore(build): regenerate types after MVP additions"
```

---

## Task 14: Manual acceptance verification

(No code changes; just verification)

Open Chrome and load the extension from `.output/chrome-mv3/`:

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select `.output/chrome-mv3/`
4. Click the Cebian icon to open the side panel
5. Open Settings (gear icon in side panel)
6. Click the "Providers" section

- [ ] **Step 14.1: Verify the 3 preset cards appear**

**Expected:** "Web (Browser Session)" sub-section is visible with 3 cards: GLM, Kimi, DeepSeek.

- [ ] **Step 14.2: Verify the 7 fields/interactions per card**

For any card, verify all of:
- Display name (GLM/Kimi/DeepSeek)
- Enable switch (top-right)
- Login status badge (colored: green/red/gray)
- Re-check button (bottom)
- Model ID input (with default value populated)
- Tool calls switch
- Reasoning switch

- [ ] **Step 14.3: Verify the re-check flow**

Click "Re-check login status" on the GLM card. **Expected:**
- Button text changes to "Checking…" and is disabled
- After 1-2 seconds, either "Logged in" (green) or "Not logged in" (red) appears
- No errors in browser console

- [ ] **Step 14.4: Verify persistence**

- Toggle the Enable switch off, then refresh the page
- Re-open settings → toggle should still be off
- Click re-check on any card, wait for completion, refresh the page
- The login status should persist

- [ ] **Step 14.5: Verify locale switching**

If the project has a locale switcher in settings, switch between en, zh_CN, zh_TW and verify all card text updates correctly.

- [ ] **Step 14.6: Verify no regression**

Confirm existing functionality still works:
- API Key provider cards still editable
- OAuth provider cards still work
- Skills, Chat, MCP sections all functional

- [ ] **Step 14.7: Mark all 12 acceptance criteria**

Open `docs/superpowers/specs/2026-06-03-web-browser-session-provider-design.md` Section 8, and verify each of the 12 criteria. Tick them off in your head (or on paper) — if any fails, file a follow-up task.

---

## Task 15: Final commit and push

- [ ] **Step 15.1: View commit history since spec**

```bash
git log --oneline 2f6aa63..HEAD
```

**Expected:** 11-12 commits (one per major task, possibly more if any task was split).

- [ ] **Step 15.2: Push to your fork**

```bash
git push origin master
```

(or `git push origin feat/web-browser-session-provider` if you used a worktree branch)

- [ ] **Step 15.3: Open PR to upstream (optional)**

If you want to contribute back to the original `maotoumao/Cebian`:

1. Visit `https://github.com/zhixingt/Cebian/compare/master...master`
2. Click "Create pull request"
3. Tick the CLA checkbox
4. Title: `feat: add Web (Browser Session) provider MVP — settings UI only`
5. Body should mention:
   - "Generated with OpenSpec + superpowers brainstorming"
   - "MVP scope: settings UI only, mocked login"
   - "Future milestones ②-⑤ reserved (no UI changes required)"

---

## Self-Review Checklist

Before declaring the plan complete, verify:

- [ ] Every step has actual code (no "implement later" placeholders)
- [ ] Every file path is exact
- [ ] Every command is exact with expected output
- [ ] Every TDD test is shown in full
- [ ] Type names match across tasks (`WebProvider`, `LoginStatus`, etc.)
- [ ] Spec section 8 (12 acceptance criteria) is covered by Task 14
- [ ] All 31 test cases mentioned in spec are present in plan (10 + 3 + 6 + 8 + 4)
- [ ] `pnpm check` runs after every task that touches TS / i18n
- [ ] `git commit` runs after every completed task

---

## Estimated Time

| Phase | Time |
|---|---|
| Task 0 (env setup) | 15-30 min |
| Tasks 1-3 (types/presets/db) | 30 min |
| Task 4 (crypto placeholder) | 15 min |
| Task 5 (Repository TDD) | 1-1.5 hours |
| Task 6 (i18n) | 30 min |
| Tasks 7-8 (hook TDD) | 1.5-2 hours |
| Tasks 9-12 (UI) | 1.5-2 hours |
| Task 13 (build verify) | 15 min |
| Task 14 (manual verify) | 30 min |
| Task 15 (push) | 10 min |
| **Total** | **6-8 hours** for a zero-base developer |

---

## After Plan Execution

When all tasks are complete:

1. Run `/opsx:propose web-browser-session-provider` to create the OpenSpec change
   (this is a record-keeping step; the plan already documents the work)
2. `/opsx:apply` to walk through tasks (or use subagent-driven-development)
3. `/opsx:verify` after each PR-worthy commit
4. `/opsx:archive` once the PR is merged or work is shelved

For ②-⑤ (future milestones), repeat this entire flow: brainstorm → spec → plan → apply.
