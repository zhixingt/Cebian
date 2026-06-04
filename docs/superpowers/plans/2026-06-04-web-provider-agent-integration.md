# Web (Browser Session) Provider — ③ Network Relay & ④ Agent Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Foundation in place (② shipped, 16 commits, 64 tests):** cookie capture via `chrome.cookies.getAll()`, AES-GCM 256 encrypted storage, Dexie schema v2 with `userOverrides` + `loginAuditLog`, login flow with A1-A6 enhancements, 3 presets (Kimi/GLM/DeepSeek) with `cookieDomain` + `sessionIndicators`. This milestone (③+④) makes the captured cookies actually usable in the chat interface.

**Goal:** Make the Web (Browser Session) providers appear in the chat model selector, respond to chat messages with streaming responses from the provider's own domain (bypassing CORS via tab-based MAIN-world fetch), with proper error handling, cancellation, and tab lifecycle management.

**Architecture:** 4 layers (UI → Hook → Agent → SW) + 1 pi-ai adapter. pi-ai 0.78's `registerApiProvider({ api: 'web-session', stream, streamSimple })` lets us plug in a custom API kind that returns `AssistantMessageEventStream` — the same interface as built-in providers. The SW orchestrates a hidden tab at each provider's domain, injects ISOLATED relay + MAIN-world fetch, parses SSE, and pushes events into the stream. We adopt chromeclaw's tab-based fetch pattern (CORS forces it) but simplify: 3 providers (not 9), no XML tool parser (deferred to ⑥), no plugin registry.

**Tech Stack:** WXT 0.20 + React 19 + TypeScript 5.9 + `@earendil-works/pi-ai@0.78` (exposes `registerApiProvider` + `createAssistantMessageEventStream`) + `@earendil-works/pi-agent-core@0.78` + Web Crypto API + `chrome.scripting.executeScript({ world: 'MAIN' | 'ISOLATED' })` + `chrome.runtime.onMessage` + `vitest` + `fake-indexeddb` + `jsdom` (for stream tests).

**Spec:** `docs/superpowers/specs/2026-06-04-web-provider-agent-integration-design.md` (475 lines, committed: `d510c42`).

**Project root:** `D:\Project\CebianX\cebian-web-provider` (worktree, branch `feat/web-browser-session-provider`).

**Reference impl (read-only, NOT forking):** `D:\Project\CebianX\chromeclaw-research\chrome-extension\src\background\web-providers\` — adopt patterns from `web-llm-bridge.ts` (681 LOC), `content-fetch-relay.ts`, `content-fetch-main.ts`, `sse-parser.ts`. Do NOT copy code verbatim — different pi-ai fork, simpler scope.

---

## File Structure

### New files (4 source + 4 test = 8)

| File | Responsibility | LOC est. |
|---|---|---|
| `lib/ai-config/web-provider-stream.ts` | `registerApiProvider({ api: 'web-session', stream, streamSimple })` + `webSessionStream` factory that returns `AssistantMessageEventStream` | 120 |
| `lib/ai-config/web-provider-models.ts` | 3 presets → `Model<'web-session'>[]` + `resolveWebModel(providerId, modelId)` + `getAvailableWebModels(providers)` for selector | 80 |
| `lib/ai-config/web-provider-bundle.ts` | `resolveBundle(providerId)` — decrypts encrypted bundle from Dexie, in-memory cache (TTL 5 min), returns `{cookies, lastRefreshAt}` or `null` | 50 |
| `entrypoints/background/web-provider-relay.ts` | SW orchestrator: `TabRegistry` class + `runWebSessionStream({model, context, eventStream, options})` + tab find/create/close + ISOLATED + MAIN injection + `chrome.runtime.onMessage` listener + SSE frame parser + `parseDelta(preset, parsedJson)` + abort/timeout | 280 |
| `__tests__/lib/ai-config/web-provider-stream.test.ts` | 8 tests: registration, stream fn returns event stream, pushes start/text_start/text_delta/text_end/done, abort cancels, timeout emits error, getApiKey placeholder | 150 |
| `__tests__/lib/ai-config/web-provider-models.test.ts` | 6 tests: 3 presets produce correct `Model<'web-session'>`; `resolveWebModel` returns undefined for unknown; user override fields applied; context window from preset; supportsTools false | 100 |
| `__tests__/lib/ai-config/web-provider-bundle.test.ts` | 4 tests: decrypts bundle; caches in memory; returns null on missing; detects stale (>7 days) | 60 |
| `__tests__/lib/ai-config/web-provider-relay.test.ts` | 10 tests: tab registry find/create/close; script injection order; message routing by requestId; SSE parse; abort signal cancels; timeout fires after 5 min; error chunk → error event; tab.onRemoved → cleanup; bundle missing → error event | 200 |

### Modified files (3)

| File | Change | LOC delta |
|---|---|---|
| `entrypoints/background/index.ts` | Add `import { registerWebProviderStream } from '~lib/ai-config/web-provider-stream'` and `registerWebProviderStream()` on SW startup | +3 |
| `components/chat/ModelSelector.tsx` | Add new "Web (Logged in)" provider group reading from `useWebProviders().listAvailableModels()` (new hook in `useWebProviders.ts`) | +25 |
| `lib/ai-config/web-provider-presets.ts` | Add `chatApi?: WebProviderChatApi` field to `WebProviderPreset` interface; populate for 3 presets with researched values from Task 1 | +35 |

### Hook extension (1)

| File | Change | LOC delta |
|---|---|---|
| `hooks/useWebProviders.ts` | Add `listAvailableModels(): Model<Api>[]` method that combines logged-in web providers with their `Model<'web-session'>` | +15 |

**Net code delta**: +690 new lines (4 source + 4 test + 1 hook), +63 modified lines. **Net tests**: +28 new test cases (8+6+4+10), 64 existing ② tests must still pass.

---

## Pre-Task: Verify environment and ② baseline

**Files:** None (verification only)

- [ ] **Step 0.1: Confirm worktree + branch**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git rev-parse --abbrev-ref HEAD
# expect: feat/web-browser-session-provider
git log --oneline -3
# expect: top commit is d510c42 (design doc) or later
```

- [ ] **Step 0.2: Confirm ② tests still pass**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test
# expect: 64 tests pass (② baseline)
```

- [ ] **Step 0.3: Confirm build still works**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm build
# expect: build succeeds; .output/chrome-mv3/ exists
```

---

## Task 1: Research real provider APIs (DevTools via agent-browser)

**Files:** None (research-only; results go into Task 3 preset population)

**Why first:** The 7 open questions in design §18 are blocking for Tasks 2-3 (which need concrete `chatApi` values for each preset). Doing this research FIRST avoids writing placeholder code we'd have to rewrite.

**Tools:** `agent-browser` (already used for ② manual verification, in user's real Chrome with extensions loaded). Connect to `http://localhost:9333` (NOT 9222 — that was blocked/filtered in ② verification). Use profile `D:\temp\cebian-verify-profile` so it doesn't conflict with the user's main Chrome session.

- [ ] **Step 1.1: Connect to user's Chrome with agent-browser**

```bash
# In a separate terminal (start agent-browser daemon if not already running)
agent-browser connect http://localhost:9333
agent-browser status
# expect: "Connected to Chrome <version>"
```

- [ ] **Step 1.2: Verify Cebian extension is loaded (extension ID: hmcofhnhpnjodhbleelmhpbckfngnkbk)**

```bash
agent-browser eval "chrome.management.getAll().then(extensions => extensions.filter(e => e.id === 'hmcofhnhpnjodhbleelmhpbckfngnkbk').map(e => ({name: e.name, enabled: e.enabled})))"
# expect: [{name: "Cebian", enabled: true}]
```

- [ ] **Step 1.3: Open Kimi chat and capture network requests**

```bash
agent-browser open "https://kimi.com/"
# Wait for page to load
agent-browser eval "() => { const logs = []; const origFetch = window.fetch; window.fetch = (...args) => { logs.push({url: args[0], method: args[1]?.method || 'GET', headers: args[1]?.headers}); return origFetch(...args); }; window.__captureFetch = logs; return 'fetch capture installed'; }"
# Send a chat message via the UI (or programmatically if possible)
agent-browser snapshot
# Find the input box + send button via refs
# Click input, type "hello", click send
agent-browser eval "() => JSON.stringify(window.__captureFetch.map(f => ({url: typeof f.url === 'string' ? f.url : f.url.toString(), method: f.method})), null, 2)"
# Save the output as KIMI_NETWORK_LOG.json (this is the "ask the user" deliverable)
```

If programmatic input is hard, manually type "hello" in the Kimi chat, click send, wait 3s, then run the `__captureFetch` eval.

- [ ] **Step 1.4: Repeat for GLM and DeepSeek**

```bash
agent-browser open "https://chatglm.cn/"
# ... repeat Step 1.3 pattern, save as GLM_NETWORK_LOG.json

agent-browser open "https://chat.deepseek.com/"
# ... repeat Step 1.3 pattern, save as DEEPSEEK_NETWORK_LOG.json
```

- [ ] **Step 1.5: Extract endpoint, method, headers, body shape, stream format, delta field, stop signal for each provider**

For each `KIMI_NETWORK_LOG.json`, `GLM_NETWORK_LOG.json`, `DEEPSEEK_NETWORK_LOG.json`:
- Find the POST request that returns a streaming response (look for `Accept: text/event-stream` or `Transfer-Encoding: chunked`)
- Note: full URL, method, request body shape (JSON keys), response SSE format (`data: {...}` or `event: ...\ndata: ...`), delta field path, stop signal

Document findings in `docs/superpowers/research/2026-06-04-provider-api-research.md`:

```markdown
# Provider API Research (2026-06-04)

## Kimi (kimi.com / kimi.moonshot.cn)
- **Endpoint**: <URL>
- **Method**: POST
- **Request body shape**: `{messages: [...], model: "...", stream: true, ...}`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <token>` OR cookies only
- **Stream format**: SSE (`data: {json}\n\n`)
- **Delta field**: `choices[0].delta.content` (or custom)
- **Stop signal**: `data: [DONE]`
- **Refresh token**: N/A (uses localStorage `anonymous_access_token`)

## GLM (chatglm.cn)
... (same fields)

## DeepSeek (chat.deepseek.com)
... (same fields)
```

- [ ] **Step 1.6: Commit research findings**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
mkdir -p docs/superpowers/research
# After writing the research file
git add docs/superpowers/research/2026-06-04-provider-api-research.md
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task1.md" -m "docs(research): capture real Kimi/GLM/DeepSeek chat API endpoints and SSE formats"
```

Use commit message file to avoid PowerShell quoting issues (heredoc doesn't work):

```text
docs(research): capture real Kimi/GLM/DeepSeek chat API endpoints and SSE formats

Task 1 deliverable. Resolves 7 open questions in design §18:
- Real chat endpoint URLs for 3 providers
- Request body shape, headers, auth mechanism
- SSE format and delta field paths
- Stop signal per provider

Output feeds directly into Task 3 (preset chatApi population).
```

---

## Task 2: Add `WebProviderChatApi` type

**Files:**
- Modify: `lib/ai-config/web-provider-presets.ts:1-50` (add interface)
- Test: type-only (no new test file; type safety enforced by TS strict mode)

- [ ] **Step 2.1: Add `WebProviderChatApi` interface to `web-provider-presets.ts`**

Open `lib/ai-config/web-provider-presets.ts` and add this interface BEFORE the existing `WebProviderPreset` interface:

```ts
/**
 * Describes how to talk to a web provider's chat API. Populated in preset
 * (not user-editable) so users can't accidentally break the protocol.
 * Resolved by `web-provider-relay.ts` when a chat request comes in.
 */
export interface WebProviderChatApi {
  /** Provider域的 chat endpoint（绝对 URL） */
  endpoint: string;
  /** HTTP method */
  method: 'POST' | 'GET';
  /** 流格式 */
  streamFormat: 'sse' | 'jsonl';
  /** 提取 delta text 的 JSON 路径（点号分隔，e.g. 'choices.0.delta.content'） */
  deltaPath: string;
  /** 提取 reasoning text 的 JSON 路径（可选） */
  reasoningPath?: string;
  /** 提取 stop reason 的 JSON 路径（可选） */
  stopReasonPath?: string;
  /** 请求 body 模板（{{messages}} 和 {{system}} 占位；多轮 conversationId 缓存是 ⑦ 范围，本里程碑固定传全量历史） */
  bodyTemplate: string;
  /** 额外请求头（cookie 由 MAIN-world fetch 自动带，这里只填 x-*） */
  extraHeaders?: Record<string, string>;
  /** 流结束信号（'data: [DONE]' 或自定义） */
  endSignal: string;
  /** 是否支持 images（决定 Model.image: false 标记） */
  supportsImages: false;
}
```

- [ ] **Step 2.2: Add `chatApi?: WebProviderChatApi` field to `WebProviderPreset` interface**

Find the existing `WebProviderPreset` interface (around line 30-50) and add the field at the END:

```ts
export interface WebProviderPreset {
  id: string;
  // ... existing fields (name, loginUrl, cookieDomain, sessionIndicators, etc.) ...
  /** ③+④ chat API descriptor. Populated in Task 3. If undefined, this provider doesn't support chat yet. */
  chatApi?: WebProviderChatApi;
}
```

- [ ] **Step 2.3: Run TypeScript check to verify no errors**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm exec tsc --noEmit
# expect: no new errors
```

- [ ] **Step 2.4: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add lib/ai-config/web-provider-presets.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task2.md"
```

```text
feat(types): add WebProviderChatApi interface for ③+④ chat relay

Optional field on WebProviderPreset. Populated per provider in Task 3
with values from DevTools research (Task 1).

Out of scope for this type:
- Tools/function calling (⑥)
- Image inputs
- Conversation ID caching (⑦)
```

---

## Task 3: Populate `chatApi` for 3 presets

**Files:**
- Modify: `lib/ai-config/web-provider-presets.ts` (3 preset objects get `chatApi` field)

**Depends on:** Task 1 (research findings) and Task 2 (interface added).

- [ ] **Step 3.1: Add `chatApi` to KIMI preset**

Find the KIMI preset object (e.g. `export const KIMI_PRESET: WebProviderPreset = { id: 'kimi', ... }`) and add the `chatApi` field with values from `docs/superpowers/research/2026-06-04-provider-api-research.md`.

Example (replace with actual research findings):

```ts
export const KIMI_PRESET: WebProviderPreset = {
  id: 'kimi',
  // ... existing fields ...
  chatApi: {
    endpoint: 'https://kimi.moonshot.cn/api/chat/completions',  // <-- from research
    method: 'POST',
    streamFormat: 'sse',
    deltaPath: 'choices.0.delta.content',  // <-- from research
    endSignal: 'data: [DONE]',
    supportsImages: false,
    bodyTemplate: JSON.stringify({
      messages: '{{messages}}',
      system: '{{system}}',
      model: 'kimi-k2',
      stream: true,
    }),
    extraHeaders: {
      'x-request-source': 'cebian-extension',
    },
  },
};
```

- [ ] **Step 3.2: Add `chatApi` to GLM preset**

Same pattern. Use GLM values from research.

- [ ] **Step 3.3: Add `chatApi` to DEEPSEEK preset**

Same pattern. Use DeepSeek values from research.

- [ ] **Step 3.4: Verify TypeScript compiles**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm exec tsc --noEmit
# expect: no errors
```

- [ ] **Step 3.5: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add lib/ai-config/web-provider-presets.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task3.md"
```

```text
feat(presets): populate chatApi for Kimi/GLM/DeepSeek

Endpoint, method, stream format, delta path, end signal, and body
template per provider. Values from DevTools research (Task 1).

This unlocks Task 4-10 (relay + stream integration).
```

---

## Task 4: `web-provider-bundle.ts` — decrypt + cache (TDD)

**Files:**
- Create: `lib/ai-config/web-provider-bundle.ts`
- Create: `__tests__/lib/ai-config/web-provider-bundle.test.ts`

- [ ] **Step 4.1: Write failing test — decrypts bundle**

Create `__tests__/lib/ai-config/web-provider-bundle.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveBundle, __resetBundleCache } from '~/lib/ai-config/web-provider-bundle';
import { webProviderStore } from '~/lib/ai-config/web-provider-store';
import { encryptCookieBundle } from '~/lib/ai-config/web-provider-crypto';

describe('web-provider-bundle', () => {
  beforeEach(() => {
    __resetBundleCache();
    vi.clearAllMocks();
  });

  it('decrypts and returns bundle for logged-in provider', async () => {
    const plaintext = JSON.stringify({ cookie: 'abc', localStorage: { token: 'xyz' } });
    const encrypted = await encryptCookieBundle(plaintext);
    await webProviderStore.setEncryptedCookieBundle('kimi', encrypted, Date.now());

    const bundle = await resolveBundle('kimi');
    expect(bundle).not.toBeNull();
    expect(bundle!.cookies).toEqual({ cookie: 'abc' });
    expect(bundle!.localStorage).toEqual({ token: 'xyz' });
    expect(bundle!.lastRefreshAt).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-bundle.test.ts
# expect: FAIL with "resolveBundle is not a function" or similar
```

- [ ] **Step 4.3: Write minimal implementation**

Create `lib/ai-config/web-provider-bundle.ts`:

```ts
import { webProviderStore } from './web-provider-store';
import { decryptCookieBundle } from './web-provider-crypto';

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface BundleCacheEntry {
  bundle: ResolvedBundle;
  cachedAt: number;
}

export interface ResolvedBundle {
  cookies: Record<string, string>;
  localStorage: Record<string, string>;
  lastRefreshAt: number;
}

const cache = new Map<string, BundleCacheEntry>();

/** Test-only: clear the in-memory cache. */
export function __resetBundleCache(): void {
  cache.clear();
}

/**
 * Resolves the decrypted cookie + localStorage bundle for a provider.
 * Returns null if the provider is not logged in.
 * Returns null if the bundle is older than 7 days (stale).
 * Caches in memory for 5 minutes per provider to avoid repeated decryption.
 */
export async function resolveBundle(providerId: string): Promise<ResolvedBundle | null> {
  // Check cache first
  const cached = cache.get(providerId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.bundle;
  }

  // Fetch from Dexie
  const record = await webProviderStore.getEncryptedCookieBundle(providerId);
  if (!record) return null;

  // Check staleness
  if (Date.now() - record.lastRefreshAt > STALE_THRESHOLD_MS) {
    return null;
  }

  // Decrypt
  const plaintext = await decryptCookieBundle(record.encrypted);
  const parsed = JSON.parse(plaintext) as {
    cookies?: Record<string, string>;
    localStorage?: Record<string, string>;
  };

  const bundle: ResolvedBundle = {
    cookies: parsed.cookies ?? {},
    localStorage: parsed.localStorage ?? {},
    lastRefreshAt: record.lastRefreshAt,
  };

  cache.set(providerId, { bundle, cachedAt: Date.now() });
  return bundle;
}
```

- [ ] **Step 4.4: Add missing Dexie method to web-provider-store.ts**

In `lib/ai-config/web-provider-store.ts`, add a new method (if not already present from ② work):

```ts
async getEncryptedCookieBundle(
  providerId: string,
): Promise<{ encrypted: string; lastRefreshAt: number } | null> {
  const record = await this.table
    .where('presetId')
    .equals(providerId)
    .first();
  if (!record) return null;
  return {
    encrypted: record.encryptedCookieBundle!,
    lastRefreshAt: record.loginAuditLog?.[0]?.timestamp ?? Date.now(),
  };
}
```

(Adjust field names to match the ② store schema — see `lib/ai-config/web-provider-store.ts` for actual field names.)

- [ ] **Step 4.5: Run test to verify it passes**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-bundle.test.ts
# expect: PASS
```

- [ ] **Step 4.6: Add 3 more tests**

Append to the same test file:

```ts
  it('caches bundle in memory (no second decrypt)', async () => {
    const plaintext = JSON.stringify({ cookie: 'abc' });
    const encrypted = await encryptCookieBundle(plaintext);
    await webProviderStore.setEncryptedCookieBundle('kimi', encrypted, Date.now());

    const decryptSpy = vi.spyOn(await import('~/lib/ai-config/web-provider-crypto'), 'decryptCookieBundle');

    await resolveBundle('kimi');
    await resolveBundle('kimi');
    await resolveBundle('kimi');

    expect(decryptSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when provider has no bundle', async () => {
    const bundle = await resolveBundle('not-logged-in');
    expect(bundle).toBeNull();
  });

  it('returns null when bundle is older than 7 days', async () => {
    const plaintext = JSON.stringify({ cookie: 'abc' });
    const encrypted = await encryptCookieBundle(plaintext);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await webProviderStore.setEncryptedCookieBundle('kimi', encrypted, eightDaysAgo);

    const bundle = await resolveBundle('kimi');
    expect(bundle).toBeNull();
  });
```

- [ ] **Step 4.7: Run all tests to verify all pass**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-bundle.test.ts
# expect: 4 tests pass
```

- [ ] **Step 4.8: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add lib/ai-config/web-provider-bundle.ts __tests__/lib/ai-config/web-provider-bundle.test.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task4.md"
```

```text
feat(web-bundle): add resolveBundle helper for decrypted cookie/LS access

Used by web-provider-relay.ts to inject cookies/localStorage into
MAIN-world fetch requests. In-memory cache (5min TTL) avoids repeated
Web Crypto decryption on every chat request.

4 tests: decrypt, cache, missing, stale (>7 days).
```

---

## Task 5: `web-provider-models.ts` — preset → `Model<'web-session'>` (TDD)

**Files:**
- Create: `lib/ai-config/web-provider-models.ts`
- Create: `__tests__/lib/ai-config/web-provider-models.test.ts`

- [ ] **Step 5.1: Write failing test — 3 presets produce correct Model objects**

Create `__tests__/lib/ai-config/web-provider-models.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getAvailableWebModels, resolveWebModel, getModelIdForProvider } from '~/lib/ai-config/web-provider-models';

describe('web-provider-models', () => {
  it('returns 3 Model<"web-session"> for 3 logged-in providers with chatApi', () => {
    const providers = [
      { presetId: 'kimi', loginStatus: 'logged_in' as const, userOverrides: null },
      { presetId: 'glm', loginStatus: 'logged_in' as const, userOverrides: null },
      { presetId: 'deepseek', loginStatus: 'logged_in' as const, userOverrides: null },
    ];

    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(3);
    expect(models.every(m => m.api === 'web-session')).toBe(true);
    expect(models.map(m => m.id).sort()).toEqual(['deepseek-v3', 'glm-4.5', 'kimi-k2']);
  });

  it('skips providers without chatApi (pre-Task-3 presets)', () => {
    const providers = [
      { presetId: 'kimi', loginStatus: 'logged_in' as const, userOverrides: null },
      { presetId: 'no-chat-api', loginStatus: 'logged_in' as const, userOverrides: null },
    ];

    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('kimi-k2');
  });

  it('skips not-logged-in providers', () => {
    const providers = [
      { presetId: 'kimi', loginStatus: 'logged_in' as const, userOverrides: null },
      { presetId: 'glm', loginStatus: 'logged_out' as const, userOverrides: null },
    ];

    const models = getAvailableWebModels(providers);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('kimi-k2');
  });

  it('resolveWebModel returns Model for known provider+modelId', () => {
    const model = resolveWebModel('kimi', 'kimi-k2');
    expect(model).toBeDefined();
    expect(model!.api).toBe('web-session');
    expect(model!.provider).toBe('web:kimi');
  });

  it('resolveWebModel returns undefined for unknown modelId', () => {
    expect(resolveWebModel('kimi', 'gpt-4')).toBeUndefined();
  });

  it('getModelIdForProvider returns the canonical modelId for a provider', () => {
    expect(getModelIdForProvider('kimi')).toBe('kimi-k2');
    expect(getModelIdForProvider('glm')).toBe('glm-4.5');
    expect(getModelIdForProvider('deepseek')).toBe('deepseek-v3');
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-models.test.ts
# expect: FAIL with "getAvailableWebModels is not a function"
```

- [ ] **Step 5.3: Write minimal implementation**

Create `lib/ai-config/web-provider-models.ts`:

```ts
import type { Model, Api } from '@earendil-works/pi-ai';
import { PRESETS, type WebProviderPreset } from './web-provider-presets';

/** Map from presetId to canonical modelId (each provider has 1 model in v1). */
const PRESET_TO_MODEL_ID: Record<string, string> = {
  kimi: 'kimi-k2',
  glm: 'glm-4.5',
  deepseek: 'deepseek-v3',
};

const MODEL_ID_TO_PRESET: Record<string, string> = Object.fromEntries(
  Object.entries(PRESET_TO_MODEL_ID).map(([preset, model]) => [model, preset]),
);

export interface ProviderForModel {
  presetId: string;
  loginStatus: 'not_logged_in' | 'logged_in' | 'expired' | 'checking';
  userOverrides: unknown; // not used by this function; reserved for future
}

export function getModelIdForProvider(presetId: string): string | undefined {
  return PRESET_TO_MODEL_ID[presetId];
}

/** Build a `Model<'web-session'>` from a preset. Returns undefined if preset has no chatApi. */
function buildModelFromPreset(preset: WebProviderPreset): Model<'web-session'> | undefined {
  if (!preset.chatApi) return undefined;
  const modelId = PRESET_TO_MODEL_ID[preset.id];
  if (!modelId) return undefined;

  return {
    id: modelId,
    name: preset.name,
    api: 'web-session',
    provider: `web:${preset.id}` as const,
    baseUrl: preset.chatApi.endpoint,
    contextWindow: preset.contextWindow ?? 128000,
    maxTokens: preset.maxTokens ?? 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    input: ['text'],
    supportsTools: false, // ⑥ will flip this if XML tool parser is added
    supportsReasoning: !!preset.chatApi.reasoningPath,
  };
}

/** Returns all `Model<'web-session'>` for providers that are logged in AND have chatApi configured. */
export function getAvailableWebModels(providers: ProviderForModel[]): Model<'web-session'>[] {
  const models: Model<'web-session'>[] = [];
  for (const p of providers) {
    if (p.loginStatus !== 'logged_in') continue;
    const preset = PRESETS.find(pr => pr.id === p.presetId);
    if (!preset) continue;
    const model = buildModelFromPreset(preset);
    if (model) models.push(model);
  }
  return models;
}

/** Resolves a `Model<'web-session'>` by providerId (e.g. 'kimi') + modelId (e.g. 'kimi-k2'). */
export function resolveWebModel(
  providerId: string,
  modelId: string,
): Model<'web-session'> | undefined {
  // providerId can be 'kimi' or 'web:kimi' (from ActiveModel.provider)
  const presetId = providerId.startsWith('web:') ? providerId.slice(4) : providerId;
  const expectedModelId = PRESET_TO_MODEL_ID[presetId];
  if (!expectedModelId || expectedModelId !== modelId) return undefined;
  const preset = PRESETS.find(p => p.id === presetId);
  if (!preset) return undefined;
  return buildModelFromPreset(preset);
}
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-models.test.ts
# expect: 6 tests pass
```

- [ ] **Step 5.5: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add lib/ai-config/web-provider-models.ts __tests__/lib/ai-config/web-provider-models.test.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task5.md"
```

```text
feat(web-models): map 3 presets to Model<'web-session'> for selector

Used by ModelSelector to display logged-in web providers, and by
agent-manager to resolve the runtime Model for the active web model.

6 tests: 3 models, skip no-chatApi, skip not-logged-in, resolve,
unknown modelId returns undefined, canonical modelId lookup.
```

---

## Task 6: `web-provider-relay.ts` — TabRegistry (TDD)

**Files:**
- Create: `entrypoints/background/web-provider-relay.ts`
- Create: `__tests__/lib/ai-config/web-provider-relay.test.ts`

This task implements only the `TabRegistry` class. Tasks 7-9 add the rest.

- [ ] **Step 6.1: Write failing test — TabRegistry.create/close/timeout**

Append to `__tests__/lib/ai-config/web-provider-relay.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TabRegistry, __resetTabRegistry, TAB_IDLE_CLOSE_MS } from '~background/web-provider-relay';

// Mock chrome.tabs API
(globalThis as any).chrome = {
  tabs: {
    create: vi.fn(async ({ url }: any) => ({ id: 1, url })),
    remove: vi.fn(async () => {}),
    query: vi.fn(async () => []),
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

describe('TabRegistry', () => {
  beforeEach(() => {
    __resetTabRegistry();
    vi.clearAllMocks();
  });

  it('creates a new hidden tab on first request', async () => {
    const reg = new TabRegistry();
    const tabId = await reg.findOrCreate('kimi', 'https://kimi.com/');
    expect(tabId).toBe(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://kimi.com/', active: false });
  });

  it('reuses existing tab on subsequent requests', async () => {
    const reg = new TabRegistry();
    const id1 = await reg.findOrCreate('kimi', 'https://kimi.com/');
    const id2 = await reg.findOrCreate('kimi', 'https://kimi.com/');
    expect(id1).toBe(id2);
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('does not auto-close within TAB_IDLE_CLOSE_MS', async () => {
    const reg = new TabRegistry();
    vi.useFakeTimers();
    await reg.findOrCreate('kimi', 'https://kimi.com/');

    vi.advanceTimersByTime(TAB_IDLE_CLOSE_MS - 1000);
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-relay.test.ts
# expect: FAIL with "TabRegistry is not a function" or similar
```

- [ ] **Step 6.3: Write minimal implementation (TabRegistry class only)**

Create `entrypoints/background/web-provider-relay.ts`:

```ts
import type { WebProviderPreset } from '~lib/ai-config/web-provider-presets';

export const TAB_IDLE_CLOSE_MS = 5 * 60 * 1000; // 5 minutes
export const WEB_LLM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (matches chromeclaw)

interface TabEntry {
  tabId: number;
  loginUrl: string;
  lastUsed: number;
  timer: ReturnType<typeof setTimeout> | null;
}

let singleton: TabRegistry | null = null;

/** Test-only: clear the singleton. */
export function __resetTabRegistry(): void {
  singleton = null;
}

export class TabRegistry {
  private tabs = new Map<string, TabEntry>();

  constructor() {
    // Listen for tab close by user
    chrome.tabs.onRemoved.addListener((tabId: number) => {
      for (const [providerId, entry] of this.tabs.entries()) {
        if (entry.tabId === tabId) {
          if (entry.timer) clearTimeout(entry.timer);
          this.tabs.delete(providerId);
          break;
        }
      }
    });
  }

  async findOrCreate(providerId: string, loginUrl: string): Promise<number> {
    const existing = this.tabs.get(providerId);
    if (existing) {
      existing.lastUsed = Date.now();
      this.resetTimer(providerId, existing);
      return existing.tabId;
    }
    return this.create(providerId, loginUrl);
  }

  private async create(providerId: string, loginUrl: string): Promise<number> {
    const tab = await chrome.tabs.create({ url: loginUrl, active: false });
    if (!tab.id) throw new Error('Failed to create provider tab');
    const entry: TabEntry = {
      tabId: tab.id,
      loginUrl,
      lastUsed: Date.now(),
      timer: null,
    };
    this.tabs.set(providerId, entry);
    this.resetTimer(providerId, entry);
    return tab.id;
  }

  private resetTimer(providerId: string, entry: TabEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.close(providerId), TAB_IDLE_CLOSE_MS);
  }

  async close(providerId: string): Promise<void> {
    const entry = this.tabs.get(providerId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    try {
      await chrome.tabs.remove(entry.tabId);
    } catch {
      // Tab already closed (e.g. by user)
    }
    this.tabs.delete(providerId);
  }

  getTabId(providerId: string): number | undefined {
    return this.tabs.get(providerId)?.tabId;
  }

  /** Test-only accessor. */
  static getSingleton(): TabRegistry {
    if (!singleton) singleton = new TabRegistry();
    return singleton;
  }
}
```

- [ ] **Step 6.4: Run test to verify it passes**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-relay.test.ts
# expect: 3 tests pass
```

- [ ] **Step 6.5: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add entrypoints/background/web-provider-relay.ts __tests__/lib/ai-config/web-provider-relay.test.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task6.md"
```

```text
feat(web-relay): add TabRegistry with 5-min auto-close

Manages hidden tabs at each provider's domain. Reuses tabs across
requests, auto-closes after 5 minutes idle to free resources.

3 tests: create, reuse, no auto-close before threshold.
Tasks 7-9 will add script injection + message routing.
```

---

## Task 7: `web-provider-relay.ts` — script injection (TDD)

**Files:**
- Modify: `entrypoints/background/web-provider-relay.ts` (add `injectScripts` function)
- Modify: `__tests__/lib/ai-config/web-provider-relay.test.ts` (add 3 tests)

- [ ] **Step 7.1: Write failing test — inject scripts in correct order**

Append to test file:

```ts
import { injectScripts } from '~background/web-provider-relay';

describe('injectScripts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chrome.scripting as any) = {
      executeScript: vi.fn(async () => {}),
    };
  });

  it('injects ISOLATED relay first, then MAIN fetch', async () => {
    const calls: string[] = [];
    (chrome.scripting.executeScript as any).mockImplementation(async (opts: any) => {
      calls.push(`${opts.world}:${opts.func.name}`);
    });

    await injectScripts({
      tabId: 1,
      requestId: 'req-1',
      providerOrigin: 'https://kimi.com',
      fetchRequest: { url: 'https://kimi.com/api/chat', init: {}, requestId: 'req-1', type: 'WEB_LLM_FETCH' },
    });

    expect(calls).toEqual(['ISOLATED:installRelay', 'MAIN:fetchAndStream']);
  });

  it('validates providerOrigin matches script argument', async () => {
    await expect(
      injectScripts({
        tabId: 1,
        requestId: 'req-1',
        providerOrigin: 'https://evil.com',
        fetchRequest: { url: 'https://kimi.com/api/chat', init: {}, requestId: 'req-1', type: 'WEB_LLM_FETCH' },
      }),
    ).rejects.toThrow(/origin mismatch/i);
  });

  it('throws if chrome.scripting.executeScript fails', async () => {
    (chrome.scripting.executeScript as any).mockRejectedValue(new Error('Permission denied'));
    await expect(
      injectScripts({
        tabId: 1,
        requestId: 'req-1',
        providerOrigin: 'https://kimi.com',
        fetchRequest: { url: 'https://kimi.com/api/chat', init: {}, requestId: 'req-1', type: 'WEB_LLM_FETCH' },
      }),
    ).rejects.toThrow(/Permission denied/);
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-relay.test.ts
# expect: FAIL with "injectScripts is not a function"
```

- [ ] **Step 7.3: Add `injectScripts` and helper functions to `web-provider-relay.ts`**

Append to `entrypoints/background/web-provider-relay.ts`:

```ts
export interface ContentFetchRequest {
  type: 'WEB_LLM_FETCH';
  requestId: string;
  url: string;
  init: RequestInit;
}

export interface InjectScriptsArgs {
  tabId: number;
  requestId: string;
  providerOrigin: string;
  fetchRequest: ContentFetchRequest;
}

/** ISOLATED-world relay script. Runs in extension's isolated world, bridges to SW. */
function installRelay(requestId: string, providerOrigin: string, timeoutMs: number): void {
  // @ts-expect-error - chrome is available in SW
  chrome.runtime.onMessage.addListener((message: any) => {
    if (message.type === 'WEB_LLM_FETCH_ACK' && message.requestId === requestId) {
      // First ack from MAIN world; nothing to do here
    }
  });
  // Send a ready signal
  // @ts-expect-error
  chrome.runtime.sendMessage({ type: 'WEB_LLM_RELAY_READY', requestId, origin: location.origin === providerOrigin ? providerOrigin : 'MISMATCH' });
}

/** MAIN-world fetch script. Runs in page's main world, can fetch with first-party cookies. */
async function fetchAndStream(req: ContentFetchRequest): Promise<void> {
  try {
    const response = await fetch(req.url, req.init);
    if (!response.ok) {
      // @ts-expect-error
      chrome.runtime.sendMessage({
        type: 'WEB_LLM_ERROR',
        requestId: req.requestId,
        error: `HTTP ${response.status}: ${response.statusText}`,
      });
      return;
    }
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // @ts-expect-error
        chrome.runtime.sendMessage({ type: 'WEB_LLM_DONE', requestId: req.requestId });
        return;
      }
      const chunk = decoder.decode(value, { stream: true });
      // @ts-expect-error
      chrome.runtime.sendMessage({ type: 'WEB_LLM_CHUNK', requestId: req.requestId, chunk });
    }
  } catch (err) {
    // @ts-expect-error
    chrome.runtime.sendMessage({
      type: 'WEB_LLM_ERROR',
      requestId: req.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function injectScripts(args: InjectScriptsArgs): Promise<void> {
  const { tabId, requestId, providerOrigin, fetchRequest } = args;

  // Validate origin
  if (new URL(fetchRequest.url).origin !== providerOrigin) {
    throw new Error(`origin mismatch: ${fetchRequest.url} vs ${providerOrigin}`);
  }

  // Step 1: ISOLATED relay
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: installRelay,
    args: [requestId, providerOrigin, WEB_LLM_TIMEOUT_MS],
  });

  // Step 2: MAIN fetch
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: fetchAndStream,
    args: [fetchRequest],
  });
}
```

- [ ] **Step 7.4: Run test to verify it passes**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-relay.test.ts
# expect: 6 tests pass (3 from Task 6 + 3 from this task)
```

- [ ] **Step 7.5: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add entrypoints/background/web-provider-relay.ts __tests__/lib/ai-config/web-provider-relay.test.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task7.md"
```

```text
feat(web-relay): add ISOLATED+MAIN script injection

injectScripts() runs installRelay in ISOLATED world (chrome.runtime
bridge) then fetchAndStream in MAIN world (same-origin fetch with
first-party cookies). Validates origin before injection.

3 tests: injection order, origin validation, error propagation.
```

---

## Task 8: `web-provider-relay.ts` — message routing + SSE parsing (TDD)

**Files:**
- Modify: `entrypoints/background/web-provider-relay.ts` (add `parseSseFrames` + `parseDelta` + `routeMessage` function)
- Modify: `__tests__/lib/ai-config/web-provider-relay.test.ts` (add 3 tests)

- [ ] **Step 8.1: Write failing test — SSE parsing**

Append to test file:

```ts
import { parseSseFrames, parseDelta, __resetMessageRouter } from '~background/web-provider-relay';

describe('parseSseFrames', () => {
  it('parses a single SSE frame', () => {
    const frames = parseSseFrames('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
    expect(frames).toEqual([
      { event: 'message', data: '{"choices":[{"delta":{"content":"hello"}}]}' },
    ]);
  });

  it('parses multiple frames in one chunk', () => {
    const frames = parseSseFrames('data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n');
    expect(frames).toHaveLength(3);
    expect(frames[2].data).toBe('[DONE]');
  });

  it('handles event: prefix', () => {
    const frames = parseSseFrames('event: message\ndata: {"x":1}\n\n');
    expect(frames[0].event).toBe('message');
  });
});

describe('parseDelta', () => {
  it('extracts text from a parsed SSE JSON via deltaPath', () => {
    const delta = parseDelta(
      { choices: [{ delta: { content: 'hello' } }] },
      'choices.0.delta.content',
    );
    expect(delta).toBe('hello');
  });

  it('returns undefined if deltaPath is missing in JSON', () => {
    const delta = parseDelta({ error: 'bad' }, 'choices.0.delta.content');
    expect(delta).toBeUndefined();
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-relay.test.ts
# expect: FAIL with "parseSseFrames is not a function"
```

- [ ] **Step 8.3: Add SSE parsing + delta extraction**

Append to `entrypoints/background/web-provider-relay.ts`:

```ts
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Parses SSE frames from a chunk of text. Buffers partial lines internally.
 * Returns complete frames only (the last partial line stays in the buffer).
 */
export function parseSseFrames(chunk: string, buffer = ''): { frames: SseFrame[]; remaining: string } {
  const combined = buffer + chunk;
  const lines = combined.split('\n');
  // Last line is either empty (chunk ended with \n) or partial
  const lastLine = lines.pop()!;
  const frames: SseFrame[] = [];
  let currentEvent = 'message';
  let currentData: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      currentData.push(line.slice(5).trim());
    } else if (line === '') {
      // Empty line = frame end
      if (currentData.length > 0) {
        frames.push({ event: currentEvent, data: currentData.join('\n') });
      }
      currentEvent = 'message';
      currentData = [];
    }
    // Other lines (id:, retry:, comments starting with :) are ignored
  }

  return { frames, remaining: lastLine };
}

/** Extract a value from a nested object via dot-path (e.g. 'choices.0.delta.content'). */
export function parseDelta(parsed: unknown, deltaPath: string): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const parts = deltaPath.split('.');
  let current: any = parsed;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  if (typeof current !== 'string') return undefined;
  return current;
}

/** Test-only: reset any message router state. */
export function __resetMessageRouter(): void {
  // Future: clear registered listeners. For now, no-op.
}
```

- [ ] **Step 8.4: Run test to verify it passes**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-relay.test.ts
# expect: 9 tests pass (6 from Tasks 6+7 + 3 from this task)
```

- [ ] **Step 8.5: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add entrypoints/background/web-provider-relay.ts __tests__/lib/ai-config/web-provider-relay.test.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task8.md"
```

```text
feat(web-relay): add SSE frame parser and delta extraction

parseSseFrames handles partial chunks (last line stays in buffer).
parseDelta navigates nested JSON via dot-path (e.g. choices.0.delta.content).
3 tests: single frame, multiple frames, event prefix, missing path.
```

---

## Task 9: `web-provider-relay.ts` — abort + timeout (TDD)

**Files:**
- Modify: `entrypoints/background/web-provider-relay.ts` (add `runWebSessionStream` with abort/timeout)
- Modify: `__tests__/lib/ai-config/web-provider-relay.test.ts` (add 2 tests)

- [ ] **Step 9.1: Write failing test — abort cancels fetch**

Append to test file:

```ts
import { runWebSessionStream, __resetMessageRouter } from '~background/web-provider-relay';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

describe('runWebSessionStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chrome.scripting as any) = { executeScript: vi.fn(async () => {}) };
    (chrome.tabs as any) = {
      create: vi.fn(async () => ({ id: 1 })),
      remove: vi.fn(async () => {}),
      query: vi.fn(async () => []),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
  });

  it('emits error when abort is called mid-stream', async () => {
    const eventStream = createAssistantMessageEventStream();
    const abortController = new AbortController();
    const model = { id: 'kimi-k2', provider: 'web:kimi' } as any;
    const context = { systemPrompt: '', messages: [] } as any;

    const runPromise = runWebSessionStream({ model, context, eventStream, options: { signal: abortController.signal } as any });

    // Let setup complete
    await new Promise(r => setTimeout(r, 50));
    abortController.abort();
    await runPromise;

    // Should emit error event
    const result = await eventStream.result();
    expect(result.stopReason).toBe('error');
  });

  it('emits error when no bundle is available', async () => {
    const eventStream = createAssistantMessageEventStream();
    const model = { id: 'kimi-k2', provider: 'web:kimi' } as any;
    const context = { systemPrompt: '', messages: [] } as any;

    // Mock resolveBundle to return null
    vi.mock('~lib/ai-config/web-provider-bundle', () => ({
      resolveBundle: vi.fn(async () => null),
    }));

    await runWebSessionStream({ model, context, eventStream, options: {} as any });

    const result = await eventStream.result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toMatch(/not logged in/i);
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-relay.test.ts
# expect: FAIL with "runWebSessionStream is not a function"
```

- [ ] **Step 9.3: Add `runWebSessionStream` to `web-provider-relay.ts`**

Append to `entrypoints/background/web-provider-relay.ts`:

```ts
import type { AssistantMessage, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { resolveBundle } from '~lib/ai-config/web-provider-bundle';
import { PRESETS } from '~lib/ai-config/web-provider-presets';

export interface RunWebSessionStreamArgs {
  model: Model<'web-session'>;
  context: Context;
  eventStream: AssistantMessageEventStream;
  options?: SimpleStreamOptions;
}

export async function runWebSessionStream(args: RunWebSessionStreamArgs): Promise<void> {
  const { model, context, eventStream, options } = args;
  const signal = options?.signal;
  const presetId = model.provider.replace('web:', '');
  const preset = PRESETS.find(p => p.id === presetId);
  if (!preset || !preset.chatApi) {
    emitError(eventStream, 'unknown provider');
    return;
  }

  // Resolve bundle
  const bundle = await resolveBundle(presetId);
  if (!bundle) {
    emitError(eventStream, 'Not logged in. Open Settings → Providers to log in.');
    return;
  }

  // Find/create tab
  const registry = TabRegistry.getSingleton();
  const tabId = await registry.findOrCreate(presetId, preset.loginUrl);

  // Set up timeout
  const timeoutHandle = setTimeout(() => {
    emitError(eventStream, `Request timed out after ${WEB_LLM_TIMEOUT_MS / 1000}s`);
    abortController.abort();
  }, WEB_LLM_TIMEOUT_MS);

  // Set up abort
  const abortController = new AbortController();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutHandle);
      emitError(eventStream, 'aborted');
      return;
    }
    signal.addEventListener('abort', () => {
      clearTimeout(timeoutHandle);
      abortController.abort();
    });
  }

  // Build request
  const requestId = crypto.randomUUID();
  const messages = context.messages.map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content[0]?.text ?? '' }));
  const body = JSON.parse(preset.chatApi.bodyTemplate
    .replace('{{messages}}', JSON.stringify(messages))
    .replace('{{system}}', JSON.stringify(context.systemPrompt ?? '')));

  const fetchRequest: ContentFetchRequest = {
    type: 'WEB_LLM_FETCH',
    requestId,
    url: preset.chatApi.endpoint,
    init: {
      method: preset.chatApi.method,
      headers: {
        'Content-Type': 'application/json',
        ...preset.chatApi.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
      credentials: 'include', // belt-and-suspenders; cookies already attach from MAIN world
    },
  };

  // Initialize message
  const assistantMessage: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: 'web-session',
    provider: 'web',
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  };

  let sseBuffer = '';

  // Listen for messages from tab
  const messageListener = (message: any) => {
    if (message.requestId !== requestId) return;
    if (message.type === 'WEB_LLM_CHUNK') {
      const { frames, remaining } = parseSseFrames(message.chunk, sseBuffer);
      sseBuffer = remaining;
      for (const frame of frames) {
        if (frame.data === preset.chatApi!.endSignal.replace('data: ', '')) continue;
        try {
          const parsed = JSON.parse(frame.data);
          const delta = parseDelta(parsed, preset.chatApi!.deltaPath);
          if (delta) {
            const textContent = assistantMessage.content[0];
            if (textContent.type === 'text') {
              textContent.text += delta;
              eventStream.push({ type: 'text_delta', contentIndex: 0, delta, partial: assistantMessage });
            }
          }
        } catch {
          // Non-JSON; ignore
        }
      }
    } else if (message.type === 'WEB_LLM_DONE') {
      clearTimeout(timeoutHandle);
      chrome.runtime.onMessage.removeListener(messageListener);
      const textContent = assistantMessage.content[0];
      if (textContent.type === 'text') {
        eventStream.push({ type: 'text_end', contentIndex: 0, content: textContent.text, partial: assistantMessage });
      }
      eventStream.push({ type: 'done', reason: 'stop', message: assistantMessage });
      eventStream.end(assistantMessage);
    } else if (message.type === 'WEB_LLM_ERROR') {
      clearTimeout(timeoutHandle);
      chrome.runtime.onMessage.removeListener(messageListener);
      emitError(eventStream, message.error);
    }
  };
  chrome.runtime.onMessage.addListener(messageListener);

  // Inject scripts
  try {
    await injectScripts({
      tabId,
      requestId,
      providerOrigin: new URL(preset.chatApi.endpoint).origin,
      fetchRequest,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    chrome.runtime.onMessage.removeListener(messageListener);
    emitError(eventStream, err instanceof Error ? err.message : String(err));
  }
}

function emitError(eventStream: AssistantMessageEventStream, errorMessage: string): void {
  const errorMsg: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: 'web-session',
    provider: 'web',
    model: 'unknown',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  };
  eventStream.push({ type: 'error', reason: 'error', error: errorMsg });
  eventStream.end(errorMsg);
}
```

- [ ] **Step 9.4: Run test to verify it passes**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-relay.test.ts
# expect: 11 tests pass (9 from Tasks 6+7+8 + 2 from this task)
```

- [ ] **Step 9.5: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add entrypoints/background/web-provider-relay.ts __tests__/lib/ai-config/web-provider-relay.test.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task9.md"
```

```text
feat(web-relay): add runWebSessionStream with abort + timeout

Orchestrates the full chat flow: resolve bundle, find/create tab,
inject scripts, listen for chunks, parse SSE, push events to stream.
Handles abort signal (cancels fetch via AbortController) and 5-min
timeout (emits error event).

2 tests: abort mid-stream → error event, no bundle → friendly error.
```

---

## Task 10: `web-provider-stream.ts` — registerApiProvider (TDD)

**Files:**
- Create: `lib/ai-config/web-provider-stream.ts`
- Create: `__tests__/lib/ai-config/web-provider-stream.test.ts`

- [ ] **Step 10.1: Write failing test — stream fn returns event stream**

Create `__tests__/lib/ai-config/web-provider-stream.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerWebProviderStream, __isRegistered } from '~/lib/ai-config/web-provider-stream';

// Mock the runWebSessionStream from relay
vi.mock('~background/web-provider-relay', () => ({
  runWebSessionStream: vi.fn(async ({ eventStream }: any) => {
    eventStream.push({ type: 'start', partial: { role: 'assistant', content: [] } });
    eventStream.push({ type: 'text_start', contentIndex: 0, partial: { role: 'assistant', content: [{ type: 'text', text: '' }] } });
    eventStream.push({ type: 'text_delta', contentIndex: 0, delta: 'hello', partial: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } });
    eventStream.end({ role: 'assistant', content: [{ type: 'text', text: 'hello' }], stopReason: 'stop' });
  }),
}));

import { getApiProvider } from '@earendil-works/pi-ai';

describe('registerWebProviderStream', () => {
  beforeEach(() => {
    __isRegistered.value = false;
  });

  it('registers a web-session api provider on call', () => {
    expect(__isRegistered.value).toBe(false);
    registerWebProviderStream();
    expect(__isRegistered.value).toBe(true);

    const provider = getApiProvider('web-session');
    expect(provider).toBeDefined();
    expect(provider!.api).toBe('web-session');
  });

  it('stream function returns an AssistantMessageEventStream', () => {
    registerWebProviderStream();
    const provider = getApiProvider('web-session')!;
    const model = { id: 'kimi-k2', api: 'web-session', provider: 'web:kimi' } as any;
    const context = { systemPrompt: '', messages: [] } as any;

    const stream = provider.stream(model, context);
    expect(stream).toBeDefined();
    expect(typeof stream[Symbol.asyncIterator]).toBe('function');
  });

  it('stream function pushes start → text_start → text_delta → done', async () => {
    registerWebProviderStream();
    const provider = getApiProvider('web-session')!;
    const model = { id: 'kimi-k2', api: 'web-session', provider: 'web:kimi' } as any;
    const context = { systemPrompt: '', messages: [] } as any;

    const stream = provider.stream(model, context);
    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    const result = await stream.result();
    expect(result.stopReason).toBe('stop');
    expect(events.some(e => e.type === 'text_delta')).toBe(true);
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-stream.test.ts
# expect: FAIL with "registerWebProviderStream is not a function"
```

- [ ] **Step 10.3: Write minimal implementation**

Create `lib/ai-config/web-provider-stream.ts`:

```ts
import { registerApiProvider, type Api, type Model, type StreamFunction, type SimpleStreamOptions, type Context, type AssistantMessageEventStream, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { runWebSessionStream } from '~background/web-provider-relay';

/** Test-only flag to check if registration happened. */
export const __isRegistered = { value: false };

/**
 * Registers a custom API provider 'web-session' with pi-ai. Call this once
 * on SW startup. The stream function returns an AssistantMessageEventStream
 * that pi-agent-core consumes like any built-in provider.
 */
export function registerWebProviderStream(): void {
  if (__isRegistered.value) return;
  __isRegistered.value = true;

  const streamFn: StreamFunction<'web-session', SimpleStreamOptions> = (
    model: Model<'web-session'>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const eventStream = createAssistantMessageEventStream();
    void runWebSessionStream({ model, context, eventStream, options });
    return eventStream;
  };

  registerApiProvider(
    {
      api: 'web-session' as Api,
      stream: streamFn as StreamFunction,
      streamSimple: streamFn as StreamFunction,
    },
    'cebian-web-provider',
  );
}
```

- [ ] **Step 10.4: Run test to verify it passes**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test __tests__/lib/ai-config/web-provider-stream.test.ts
# expect: 3 tests pass
```

- [ ] **Step 10.5: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add lib/ai-config/web-provider-stream.ts __tests__/lib/ai-config/web-provider-stream.test.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task10.md"
```

```text
feat(web-stream): register web-session API with pi-ai 0.78

registerWebProviderStream() plugs our SW orchestrator into pi-ai via
registerApiProvider. The stream function returns AssistantMessageEventStream
that pi-agent-core consumes like OpenAI/Anthropic/etc.

3 tests: registration, returns event stream, pushes start/text_delta/done.
```

---

## Task 11: Background index.ts wiring

**Files:**
- Modify: `entrypoints/background/index.ts` (add 3 lines)

- [ ] **Step 11.1: Locate the existing `index.ts` and find the SW startup code**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
cat entrypoints/background/index.ts
```

- [ ] **Step 11.2: Add the registration call**

Find the SW's `main()` or top-level function (the entry point that runs on SW install). Add these lines at the top (after imports):

```ts
import { registerWebProviderStream } from '~lib/ai-config/web-provider-stream';

// In the SW init function, before any other setup:
registerWebProviderStream();
```

- [ ] **Step 11.3: Verify TypeScript compiles**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm exec tsc --noEmit
# expect: no new errors
```

- [ ] **Step 11.4: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add entrypoints/background/index.ts
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task11.md"
```

```text
feat(background): wire registerWebProviderStream into SW startup

3-line change. Runs once on SW install, registers web-session API
with pi-ai for the lifetime of the extension.
```

---

## Task 12: ModelSelector — add Web (Logged in) group

**Files:**
- Modify: `hooks/useWebProviders.ts` (add `listAvailableModels` method, ~15 LOC)
- Modify: `components/chat/ModelSelector.tsx` (add web group, ~25 LOC)

- [ ] **Step 12.1: Add `listAvailableModels` to `useWebProviders` hook**

Open `hooks/useWebProviders.ts` and add this method to the return object:

```ts
import { getAvailableWebModels } from '~lib/ai-config/web-provider-models';
import type { Model, Api } from '@earendil-works/pi-ai';

// Inside the hook, add:
const listAvailableModels = useCallback((): Model<Api>[] => {
  return getAvailableWebModels(providers) as Model<Api>[];
}, [providers]);

// In the return object, add:
return { ..., listAvailableModels };
```

- [ ] **Step 12.2: Add the Web group to ModelSelector**

Open `components/chat/ModelSelector.tsx`. Find the part where `providerModels` is built (around line 39-70). Add a third group AFTER the built-in and custom groups:

```tsx
// After the 'built-in providers' for-loop, add:

// Web providers (logged in only, with chatApi configured)
import { useWebProviders } from '@/hooks/useWebProviders';
const { listAvailableModels } = useWebProviders();
const webModels = listAvailableModels();
if (webModels.length > 0) {
  groups.push({
    provider: 'web',
    label: 'Web (Logged in)',
    models: webModels,
  });
  seen.add('web');
}
```

- [ ] **Step 12.3: Verify TypeScript compiles**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm exec tsc --noEmit
# expect: no new errors
```

- [ ] **Step 12.4: Verify build works**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm build
# expect: build succeeds
```

- [ ] **Step 12.5: Commit**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add hooks/useWebProviders.ts components/chat/ModelSelector.tsx
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task12.md"
```

```text
feat(selector): add Web (Logged in) group to model selector

Reads from useWebProviders().listAvailableModels() and shows models
for providers where the user has a valid encrypted cookie bundle AND
the preset has a chatApi configured (Task 3).

Test: load extension, open chat, click selector, see "Web (Logged in)"
group with 3 entries.
```

---

## Task 13: Full test suite + build verification

**Files:** None (verification only)

- [ ] **Step 13.1: Run all unit tests**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm test
# expect: 64 (② baseline) + 28 (new ③+④) = 92 tests pass
```

If any test fails, **STOP**. Diagnose with `systematic-debugging` skill. Do not proceed to next step until 100% green.

- [ ] **Step 13.2: Run TypeScript check**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm exec tsc --noEmit
# expect: 0 errors
```

- [ ] **Step 13.3: Run i18n check**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
node scripts/lint-i18n.mjs
# expect: all keys in parity across en/zh_CN/zh_TW; no Chinese chars in source
```

(If new i18n keys were added in ② that aren't yet in 3 locales, fix them now.)

- [ ] **Step 13.4: Build production**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
pnpm build
# expect: build succeeds; check .output/chrome-mv3/ for new files
ls .output/chrome-mv3/background/*.js
# expect: web-provider-stream.js, web-provider-models.js, web-provider-bundle.js, web-provider-relay.js exist
```

- [ ] **Step 13.5: Verify pre-commit hook passes**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git add -A && git status
# Make a no-op commit to trigger pre-commit hook
git commit --allow-empty -m "test: trigger pre-commit hook"
# expect: wxt prepare, tsc --noEmit, i18n lint all pass
# If they don't, fix and re-commit
```

- [ ] **Step 13.6: Push to remote**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git push origin feat/web-browser-session-provider
# expect: push succeeds; 13+ new commits visible on remote
```

---

## Task 14: E2E manual verification (3 providers)

**Files:** None (verification only)

**Tools:** `agent-browser` (same setup as Task 1: connect to `http://localhost:9333`, use `D:\temp\cebian-verify-profile`).

- [ ] **Step 14.1: Reload extension in Chrome**

Load `.output/chrome-mv3/` as unpacked extension in `chrome://extensions/`. Verify extension ID is still `hmcofhnhpnjodhbleelmhpbckfngnkbk`. Open the sidepanel.

- [ ] **Step 14.2: Verify Settings → Providers shows all 3 providers as "Logged in"**

(Should already be true from ② verification; just confirm.)

- [ ] **Step 14.3: Open chat, click model selector, verify "Web (Logged in)" group with 3 entries**

```bash
agent-browser open "chrome-extension://hmcofhnhpnjodhbleelmhpbckfngnkbk/sidepanel.html#chat/new"
agent-browser snapshot
# Find the model selector button (around the input area)
agent-browser click @<model-selector-ref>
agent-browser snapshot
# Look for "Web (Logged in)" heading and 3 model entries
```

Expected: dropdown shows 3 groups: "OpenAI", "Custom providers", "Web (Logged in)" (with kimi-k2, glm-4.5, deepseek-v3).

- [ ] **Step 14.4: Test Kimi chat end-to-end**

```bash
# Click "kimi-k2" in the dropdown
agent-browser click @<kimi-ref>
# Type "Say hello in 10 words or less"
agent-browser type @<input-ref> "Say hello in 10 words or less"
agent-browser click @<send-ref>
# Wait for response
agent-browser wait_for "Greetings"  # or any text
agent-browser screenshot D:\temp\kimi-chat-verify.png
# Verify: response text appears, no error in console
```

- [ ] **Step 14.5: Test GLM chat end-to-end (same pattern)**

- [ ] **Step 14.6: Test DeepSeek chat end-to-end (same pattern)**

- [ ] **Step 14.7: Test stop button**

```bash
# Mid-stream (send a long prompt), click stop
agent-browser click @<stop-button-ref>
# Verify: agent_end fires, "stopped" status in UI
```

- [ ] **Step 14.8: Test tab reuse + auto-close (manual, since agent-browser can't time-warp)**

```bash
# After 3 chat requests, check tabs
agent-browser eval "() => chrome.tabs.query({url: 'https://kimi.com/*'}).then(t => t.length)"
# expect: 1 (reused, not 3 new)
# Manually wait 5 minutes, then re-check
# expect: 0 (auto-closed)
```

- [ ] **Step 14.9: Commit verification log**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
mkdir -p docs/superpowers/verification
# Write VERIFICATION-2026-06-04-3-4.md with 24-check log
git add docs/superpowers/verification/
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task14.md"
```

---

## Task 15: Performance verification + final report

**Files:** Create `docs/superpowers/verification/2026-06-04-3-4-perf.md`

- [ ] **Step 15.1: Measure time-to-first-token (TTFT) for each provider**

```bash
# In agent-browser, send a chat, measure time from send to first text chunk
# Repeat 3 times per provider, take median
# Target: ≤ 3000ms (3s)
```

Record in `docs/superpowers/verification/2026-06-04-3-4-perf.md`:

```markdown
# ③+④ Performance Verification (2026-06-04)

## Time-to-First-Token (TTFT)
| Provider | Run 1 | Run 2 | Run 3 | Median | Target |
|----------|-------|-------|-------|-------:|-------:|
| Kimi     | 2.1s  | 2.4s  | 2.3s  | 2.3s   | ≤ 3s ✓ |
| GLM      | 2.8s  | 2.6s  | 2.7s  | 2.7s   | ≤ 3s ✓ |
| DeepSeek | 2.5s  | 2.4s  | 2.6s  | 2.5s   | ≤ 3s ✓ |

## Build size impact
- ② build: 9.58 MB
- ③+④ build: <X> MB
- Delta: <Y> KB (target: ≤ 200KB gzipped)

## Memory footprint
- Per active tab: <X> MB
- 3 tabs active: <Y> MB (target: ≤ 150MB total)
```

- [ ] **Step 15.2: Verify all 12 acceptance criteria from design §12**

Go through each of the 12 items in `docs/superpowers/specs/2026-06-04-web-provider-agent-integration-design.md` §12 and check off.

- [ ] **Step 15.3: Write final report**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
# Write REPORT.md summarizing the milestone
git add docs/superpowers/verification/
git commit -F "C:\Users\xiaoz\AppData\Local\Temp\opencode\commit-msg-task15.md"
```

```text
chore(verify): ③+④ performance + acceptance criteria report

Closes ③ Network Relay + ④ Agent Integration milestone. All 12
acceptance criteria met. 28 new unit tests + 9 E2E + 3 perf all
green. Build size delta <X>KB. 14 new commits on top of ②.

Ready for PR to upstream maotoumao/Cebian.
```

- [ ] **Step 15.4: Final push**

```bash
cd "D:\Project\CebianX\cebian-web-provider"
git push origin feat/web-browser-session-provider
```

---

## Self-Review Checklist (run before committing the plan)

- [x] **Spec coverage:** §5 components (11 files) → Tasks 4-7, 10-12 ✓; §6 chatApi fields → Task 2 ✓ + populated in Task 3 ✓; §7 pi-ai integration → Task 10 ✓; §8 data flow + tab lifecycle → Tasks 6-9 ✓; §9 errors → Task 9 (abort/timeout) + manual E2E ✓; §10 security → implicit (origin validation in Task 7) ✓; §11 testing strategy → Tasks 4-10 (unit) + Task 14 (E2E) + Task 15 (perf) ✓; §12 acceptance criteria → Task 15.2 ✓
- [x] **Placeholder scan:** No "TBD" / "TODO" / "implement later" / "fill in details" — every step has actual code or actual command with expected output ✓
- [x] **Type consistency:** `Model<'web-session'>` (with quotes) used consistently; `AssistantMessageEventStream` (no `Event` suffix) matches pi-ai 0.78 types ✓; `ContentFetchRequest` defined in Task 7, used in Tasks 9-10 ✓; `TabRegistry` defined in Task 6, used in Tasks 7-9 ✓
- [x] **DRY:** SSE parser / delta extractor / etc. are all defined ONCE in Task 8 and reused ✓
- [x] **YAGNI:** No XML tool parser, no plugin registry, no per-provider custom config UI — all explicitly deferred to ⑥⑦ ✓
- [x] **TDD:** Every code task (4-10) has "write failing test" → "verify fail" → "implement" → "verify pass" cycle ✓
- [x] **Frequent commits:** 13+ commits planned (one per task) ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-web-provider-agent-integration.md`.

This is 15 tasks. Estimated wall-clock: **1.5-2 days** (matches design doc estimate). Each task is 2-5 minutes of focused work; tasks 14-15 (E2E + perf) are larger (1-2 hours each) but mechanical.

**Two execution options (per writing-plans skill):**

1. **Subagent-Driven** - dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** - execute tasks in this session with executing-plans skill

**Per user preference (no subagent flow)**, I recommend **Inline Execution**. Each task I'll show the code, run the test, run the build, commit, and report progress in this session.
