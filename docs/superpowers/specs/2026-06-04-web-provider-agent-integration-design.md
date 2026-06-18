# Web (Browser Session) Provider — Network Relay & Agent Integration

- **Status**: Draft (pending user review)
- **Date**: 2026-06-04
- **Author**: Sisyphus (brainstorming session)
- **Project**: Cebian (fork: `zhixingt/Cebian`, upstream: `maotoumao/Cebian`)
- **Scope**: Milestone **③** (Network Relay) + **④** (Agent Integration) — combined into one milestone. Makes the captured Web (Browser Session) login cookies (from ②) actually usable in the chat interface as a model the user can select and chat with.
- **Builds on**: ② Cookie Extraction & Encrypted Storage (16 commits, 64 tests, shipped and pushed; OpenSpec archived as `2026-06-03-web-browser-cookie-extraction`)
- **Reference impl (read-only)**: `algopian/chromeclaw` (`D:\Project\CebianX\chromeclaw-research\chrome-extension\src\background\web-providers\`) — we adopt the *patterns*, not the *code* (different pi-ai fork + simpler scope)
- **Estimated effort**: **1.5-2 days** (small milestone)
- **Estimated tests**: **30-40 unit + 6-9 E2E + 3 performance**

---

## 1. Background & Motivation

② ships real cookie capture + AES-GCM encryption + login UI. Users see "● Logged in" in Settings. **But the chat interface can't select these models** because:

1. The model selector (`components/chat/ModelSelector.tsx`) only shows models from `getModels(KnownProvider)` (built-in pi-ai providers) and `customProviders` (OpenAI-compatible user-added). No code path for "web" providers.
2. Even if we added them to the selector, there's no `Model<Api>` runtime object that knows how to talk to a web provider. `pi-ai` ships 9 known `Api` types (`openai-completions`, `anthropic-messages`, etc.) — none of which match "send a fetch from the provider's own domain using captured cookies".
3. Even if we had the runtime, CORS blocks the obvious approach: a background SW `fetch('https://chatglm.cn/api/chat')` from origin `chrome-extension://...` is cross-origin and the cookies are first-party — the server rejects us.

This milestone solves all three.

## 2. The CORS Wall & Why Tab-Based Fetch

Cebian's extension origin is `chrome-extension://<id>`. The provider's API (`https://kimi.moonshot.cn/api/chat`, etc.) only attaches session cookies to requests from **the same origin** (or a same-site context). A SW `fetch()` is cross-origin and the cookies don't attach — the server returns 401/403.

**Workaround (chromeclaw's proven pattern)**: open a real tab at the provider's domain, then inject a script into the **MAIN world** of that tab. A MAIN-world `fetch()` to the provider's own API has first-party cookies attached automatically. Stream the response back to the SW via `chrome.runtime.sendMessage` through an **ISOLATED-world relay** injected first.

This is exactly what chromeclaw does in `web-llm-bridge.ts` (681 lines). We adopt the architecture, simplify it for 3 providers instead of 9, and target the modern `pi-ai` 0.78 (`@earendil-works/pi-ai`) which exposes `registerApiProvider` directly — chromeclaw had to do its own `AssistantMessageEventStream` integration because of an older pi-mono API.

## 3. Goals & Non-Goals

### Goals (in scope for this milestone)
1. Make a web provider model appear in the chat model selector, grouped as "Web (Logged in)" — gated on the user actually having a valid encrypted cookie bundle
2. Selecting a web provider model and sending a chat message streams the response back to the UI in real time
3. Errors (no login / 401 / network / timeout / user-cancel) surface as user-readable messages in the chat
4. Cancellable: clicking "stop" aborts the in-flight fetch in the tab
5. Tab lifecycle: first request opens a hidden tab at the provider domain, subsequent requests within 5 minutes reuse it, 5 minutes idle auto-closes
6. 30-40 unit tests, 6-9 E2E, ≤3s time-to-first-token

### Non-goals (explicit, deferred)
- **Tools/function calling** — `Model<'web-session'>` does NOT advertise `supportsTools`. The stream function emits `text_start`/`text_delta`/`text_end`/`done` only. Tool events (`toolcall_start` etc.) are reserved by the event contract but never emitted in this milestone. (Decision: see §16, Option C — design for tools, don't implement.)
- **Image/attachment inputs** — web providers don't natively support image inputs in our 3 presets
- **Multi-turn conversation caching** — every request sends the full message history. Provider-side session IDs are not captured.
- **Re-login prompt on 401** (⑤ milestone) — 401 today just shows "session expired" with a "Re-login" button (manual click, no auto-detection logic)
- **Logout button** (⑤ milestone)
- **PBKDF2 key derivation** (⑤ milestone) — still uses ②'s auto-generated AES-GCM 256 key in `chrome.storage.local`
- **Per-provider custom chat config UI** — preset's `chatApi` config is not user-editable (would explode complexity)
- **User-defined custom web providers** beyond the 3 built-in (Kimi/GLM/DeepSeek)

## 4. Architecture (4 layers + 1 pi-ai adapter)

```
┌─────────────────────────────────────────────────────────────┐
│ UI Layer (sidepanel)                                        │
│   ModelSelector.tsx   ← adds "Web (Logged in)" group        │
│   ChatInput.tsx       ← unchanged (reads activeModel)       │
└────────────┬────────────────────────────────────────────────┘
             │ activeModel = { provider: 'web:kimi', modelId: 'kimi-k2' }
┌────────────▼────────────────────────────────────────────────┐
│ Hook Layer                                                  │
│   useWebProviders (②已有) ← exposes listAvailableModels()   │
│   useActiveWebModel (新)   ← web:* → Model<'web-session'>   │
└────────────┬────────────────────────────────────────────────┘
             │ Model<'web-session'>
┌────────────▼────────────────────────────────────────────────┐
│ Agent Layer (lib/agent.ts, existing)                        │
│   createCebianAgent({ model, getApiKey, ... })              │
│   getApiKey for web → returns 'web:<id>' placeholder        │
│   Real cookie bundle resolved by stream function itself    │
└────────────┬────────────────────────────────────────────────┘
             │ Agent.prompt() → pi-agent-core
┌────────────▼────────────────────────────────────────────────┐
│ pi-ai Adapter (NEW: web-provider-stream.ts)                 │
│   registerApiProvider({ api: 'web-session', stream,        │
│                          streamSimple }, 'cebian-web')      │
│   Called once on SW startup, registered globally           │
└────────────┬────────────────────────────────────────────────┘
             │ streamSimple(model, context) → AssistantMessageEventStream
┌────────────▼────────────────────────────────────────────────┐
│ SW Network Relay (NEW: entrypoints/background/             │
│                    web-provider-relay.ts)                   │
│   - Find/create tab at provider domain (tab registry)       │
│   - Inject ISOLATED relay.ts (chrome.runtime bridge)       │
│   - Inject MAIN-world fetch.ts (same-origin fetch)         │
│   - Listen for WEB_LLM_CHUNK / DONE / ERROR                │
│   - Parse SSE → push AssistantMessageEvent into stream     │
│   - Handle abort signal + 5min timeout                      │
└────────────┬────────────────────────────────────────────────┘
             │ chrome.runtime.sendMessage
┌────────────▼────────────────────────────────────────────────┐
│ Tab Layer (provider domain, hidden)                         │
│   - chromeclaw-style hidden tab at chatglm.cn / kimi.com    │
│   - ISOLATED world: relay.ts (forwards chunks to SW)        │
│   - MAIN world: fetch.ts (fetch with first-party cookies)   │
└─────────────────────────────────────────────────────────────┘
```

## 5. Component Inventory (11 files: 8 new + 3 modified)

| # | File | Type | Lines | Responsibility |
|---|------|------|------:|----------------|
| 1 | `lib/ai-config/web-provider-stream.ts` | NEW | ~120 | `registerApiProvider` registration + `webSessionStream` function + `webSessionStreamSimple` |
| 2 | `lib/ai-config/web-provider-stream.test.ts` | NEW | ~150 | 8-10 unit tests (stream fn behavior, abort, timeout, error mapping) |
| 3 | `lib/ai-config/web-provider-models.ts` | NEW | ~80 | 3 presets → `Model<'web-session'>[]` + `resolveWebModel(provider, modelId)` |
| 4 | `lib/ai-config/web-provider-models.test.ts` | NEW | ~100 | 5-7 unit tests (preset mapping, user override application, context window) |
| 5 | `lib/ai-config/web-provider-bundle.ts` | NEW | ~50 | `resolveBundle(providerId)` — decrypts encrypted bundle, in-memory cache, returns `{cookies, userOverrides}` |
| 6 | `lib/ai-config/web-provider-bundle.test.ts` | NEW | ~60 | 3-4 unit tests (decrypt, cache hit, stale detection) |
| 7 | `entrypoints/background/web-provider-relay.ts` | NEW | ~280 | SW-side: tab registry, find/create tab, inject scripts, message bus, SSE parse, error mapping, abort/timeout |
| 8 | `entrypoints/background/web-provider-relay.test.ts` | NEW | ~200 | 8-10 unit tests (with fake SW: tab lifecycle, injection, message routing, abort, timeout) |
| 9 | `entrypoints/background/index.ts` | MOD | +3 | Add `registerWebProviderStream()` + `setupWebProviderRelay()` calls on startup |
| 10 | `components/chat/ModelSelector.tsx` | MOD | +25 | Add "Web (Logged in)" group reading from `useWebProviders().listAvailableModels()` |
| 11 | `lib/ai-config/web-provider-presets.ts` | MOD | +30 | Each preset gains a `chatApi: WebProviderChatApi` field (see §6) |

**Totals**: ~1040 new lines, ~60 modified lines. **+ ~30-40 unit tests** + **6-9 E2E tests** + **3 perf assertions**.

## 6. Provider Preset Extension (`web-provider-presets.ts`)

Each of the 3 presets (Kimi/GLM/DeepSeek) gets a `chatApi: WebProviderChatApi` field describing how to talk to the provider's API:

```ts
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
  /** 请求 body 模板（{{messages}} {{system}} 占位；多轮 conversationId 缓存是 ⑦ 范围，本里程碑固定传全量历史） */
  bodyTemplate: string;
  /** 额外请求头（cookie 由 MAIN-world fetch 自动带，这里只填 x-*） */
  extraHeaders?: Record<string, string>;
  /** 流结束信号（'data: [DONE]' 或自定义） */
  endSignal: string;
  /** 是否支持 images（决定 Model.image: false 标记） */
  supportsImages: false;
}
```

**YAGNI**: no per-provider customization UI in this milestone. Presets are baked into the code. If a provider changes their API, we ship a code update.

**Kimi/GLM/DeepSeek 真实 endpoint 需要 TDD Task 1 实测** — we reverse-engineer the network calls from each provider's chat UI in DevTools and bake the findings into the preset. This work is bounded (3 providers × ~30 min each) and is the only TDD Task that requires external research.

## 7. pi-ai Integration (the magic)

`@earendil-works/pi-ai` 0.78 exposes a registry that lets us plug in a custom API kind:

```ts
// pi-ai/dist/api-registry.d.ts
export interface ApiProvider<TApi extends Api, TOptions extends StreamOptions> {
    api: TApi;
    stream: StreamFunction<TApi, TOptions>;
    streamSimple: StreamFunction<TApi, SimpleStreamOptions>;
}
export declare function registerApiProvider<TApi, TOptions>(
    provider: ApiProvider<TApi, TOptions>, sourceId?: string
): void;
```

And `AssistantMessageEventStream` is the integration point with `pi-agent-core`:

```ts
// pi-ai/dist/utils/event-stream.d.ts
export declare class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {}
export declare function createAssistantMessageEventStream(): AssistantMessageEventStream;
```

So our registration is one call:

```ts
// web-provider-stream.ts (sketch)
import { registerApiProvider, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { runWebSessionStream } from '~background/web-provider-relay';

export function registerWebProviderStream() {
  registerApiProvider({
    api: 'web-session',
    stream: webSessionStream,
    streamSimple: webSessionStream,
  }, 'cebian-web-provider');
}

function webSessionStream(model, context, options) {
  const eventStream = createAssistantMessageEventStream();
  runWebSessionStream({ model, context, options, eventStream });
  return eventStream;
}
```

`runWebSessionStream` (in SW) is the long-running orchestrator that:
1. Resolves the cookie bundle for `model.id.split(':')[1]` (e.g. `kimi` from `kimi-k2`)
2. Finds or creates a tab at the provider's domain
3. Injects the ISOLATED relay + MAIN fetch
4. Sits in a `chrome.runtime.onMessage` loop, parsing chunks
5. Pushes `AssistantMessageEvent` into `eventStream` until `WEB_LLM_DONE` or `WEB_LLM_ERROR`
6. Resolves the `eventStream.result()` with the final `AssistantMessage`

`pi-agent-core`'s agent loop is unaware that the model is a "web provider" — it just sees a normal `Model<'web-session'>` and consumes the event stream like any other provider's.

## 8. Data Flow (end-to-end)

### 8.1 User flow
```
1. User opens chat → sees dropdown
2. ModelSelector renders 3 groups:
   - OpenAI / Anthropic / etc. (existing)
   - Custom providers (existing)
   - Web (Logged in)   ← NEW: only shows providers where bundle exists & isFresh
3. User picks "Kimi / kimi-k2"
   → activeModel = { provider: 'web:kimi', modelId: 'kimi-k2' }
4. User types message + hits send
   → useBackgroundAgent.send(message)
   → background agent-manager.createAgent() loads activeModel
   → resolveWebModel('web:kimi', 'kimi-k2') → Model<'web-session'>
   → createCebianAgent({ model, ... })
   → agent.prompt(messages)
5. pi-agent-core calls streamSimple(model, context)
   → our webSessionStream() registered handler runs
6. runWebSessionStream():
   a. resolveBundle('kimi') → { cookies, lastRefreshAt }
   b. tabRegistry.findOrCreate('kimi') → tabId
   c. injectScript(ISOLATED, relay.ts, [requestId, origin, timeout])
   d. injectScript(MAIN, fetch.ts, [{ url, init, requestId }])
   e. listen for chrome.runtime.onMessage({ requestId })
7. MAIN-world fetch.ts runs in provider's tab:
   fetch(endpoint, { method, headers, body, credentials: 'include' })
   → reads response.body as ReadableStream
   → reads chunks, sends chrome.runtime.sendMessage({ type: 'WEB_LLM_CHUNK', requestId, chunk })
8. SW receives chunks → parseSse() → parseDelta(parsed, preset) → push text_delta event
9. text_delta → AssistantMessageEventStream → agent loop → AgentEvent 'message_update'
10. handleAgentEvent broadcasts to sidepanel via chrome.runtime.Port
11. ChatPage receives message_update → updates assistant message UI
12. fetch done → WEB_LLM_DONE → push 'done' event → eventStream.result() resolves
13. agent sees done → emits 'message_end' → 'agent_end' → handleAgentEvent finalizes
14. tabRegistry.markActive('kimi', Date.now()) — refreshes 5min timer
```

### 8.2 Tab lifecycle (auto-close after 5 min idle)
```ts
class TabRegistry {
  private tabs: Map<string, { tabId: number; lastUsed: number; timer: NodeJS.Timeout }> = new Map();

  findOrCreate(providerId: string): Promise<number> {
    const entry = this.tabs.get(providerId);
    if (entry) {
      entry.lastUsed = Date.now();
      this.resetTimer(providerId, entry);
      return entry.tabId;
    }
    return this.create(providerId);
  }

  private async create(providerId: string): Promise<number> {
    const preset = getPreset(providerId);
    const tab = await chrome.tabs.create({ url: preset.loginUrl, active: false });
    await this.waitForTabLoad(tab.id);
    this.tabs.set(providerId, { tabId: tab.id, lastUsed: Date.now(), timer: null });
    this.resetTimer(providerId, this.tabs.get(providerId)!);
    return tab.id;
  }

  private resetTimer(providerId: string, entry: TabEntry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.close(providerId), TAB_IDLE_CLOSE_MS); // 5 min
  }

  async close(providerId: string) {
    const entry = this.tabs.get(providerId);
    if (!entry) return;
    try { await chrome.tabs.remove(entry.tabId); } catch { /* tab already closed */ }
    this.tabs.delete(providerId);
  }
}
```

## 9. Error Handling

| Failure | Detection | User-facing message | Recovery |
|---------|-----------|--------------------|----------|
| **No bundle** (user never logged in) | `resolveBundle` returns null | "Not logged in to {provider}. Open Settings → Providers to log in." | None — user must go to Settings |
| **Bundle exists but stale** (`lastRefreshAt > 7 days`) | `resolveBundle` checks `Date.now() - lastRefreshAt` | "Session expired for {provider}. Please re-login in Settings." | None (⑤ will auto-prompt) |
| **401/403 in fetch response** | `fetch.ts` reads `response.status` | "Provider rejected session. Please re-login in Settings." | None (⑤ will auto-prompt) |
| **Network error** (`fetch` throws) | `fetch.ts` catches | "Network error talking to {provider}: {err.message}" | Retry button in UI (manual) |
| **Timeout** (5 min no chunk) | SW setTimeout | "Request timed out after 5 minutes." | Cancel + retry |
| **User cancel** (clicks "stop") | `AbortController.abort()` → fetch.ts sees `signal.aborted` | (silent) | n/a |
| **Tab closed by user** | `chrome.tabs.onRemoved` event | "Provider tab was closed. Reopening for next request." | Auto-recreate on next request |
| **Tab didn't load in 30s** | `waitForTabLoad` timeout | "Provider page didn't load. Check your internet." | Retry |
| **MAIN-world script error** | SW catches script injection error | "Internal error in provider tab. See console." | Auto-recreate on next request |
| **Provider returns HTML 200** (login redirect) | SSE parse fails / `[DONE]` missing | "Provider returned unexpected response. Session may be expired." | None — re-login |

All errors are translated to `AssistantMessageEventStream.push({ type: 'error', error: AssistantMessage })` with `stopReason: 'error'`. The agent loop in `pi-agent-core` will then broadcast `agent_end` with the error, and the chat UI shows the error in the assistant message bubble (existing error path in `handleAgentEvent`).

## 10. Security Considerations

| Risk | Mitigation |
|------|-----------|
| **MAIN world script injection is dangerous** (XSS in any open tab) | ISOLATED world relay validates `requestId` matches SW-generated UUID, validates `origin` matches provider's expected domain, validates `chunk` is a string ≤ 1MB per message |
| **Cookie bundle in memory** | Resolved bundle lives in a module-level variable in the SW; not exposed via chrome.runtime.sendMessage. Cleared on `resolveBundle` cache miss after 5 min idle. |
| **Log injection** | No logging of cookie values or response bodies in production. Bridge logs are chunk metadata only (length, first 100 bytes hex). |
| **MAIN world fetch can leak session to 3rd party scripts** | Provider tab is opened hidden & not in any window group. User can't navigate it. `chrome.tabs.update(active: false)` on creation. |
| **DNS rebinding / origin spoofing** | Relay.ts checks `event.origin === providerOrigin` before forwarding chunks. |
| **Re-entrancy** | If user spams "send" while previous request is streaming, inFlight lock in `useWebProviderWebLogin` (existing) prevents double-requests. |

## 11. Testing Strategy

### 11.1 Unit Tests (target: 30-40, 1.5 days effort)

| File | Tests | What |
|------|------:|------|
| `web-provider-stream.test.ts` | 8-10 | Stream fn returns AssistantMessageEventStream; pushes start/text_start/text_delta/text_end/done; abort cancels; timeout emits error |
| `web-provider-models.test.ts` | 5-7 | 3 presets → correct Model objects; user overrides apply; context window from preset; missing modelId returns undefined |
| `web-provider-bundle.test.ts` | 3-4 | Decrypts bundle; caches in memory; returns null on missing; detects stale |
| `web-provider-relay.test.ts` | 8-10 | Tab find/create/close; inject scripts in order; message routing by requestId; abort signal cancels; timeout fires after 5 min; error chunk → error event |
| `web-provider-cookie-service.test.ts` (② 已有扩展) | 3-5 | reLogin flow preserves bundle; clearEncryptedCookieBundle purges from memory |
| **Total** | **~30-35** | |

### 11.2 E2E Tests (target: 6-9, 0.5 day effort)

| # | Provider | Scenario | Pass criteria |
|---|----------|----------|---------------|
| 1 | Kimi | First login → chat | Login tab opens, login completes, chat returns ≥ 1 chunk, UI displays text |
| 2 | Kimi | Reuse tab | Second chat uses existing tab (verify no new tab opened) |
| 3 | Kimi | Auto-close | After 5 min idle, tab closes (verify with chrome.tabs.query) |
| 4 | GLM | Login → chat | Same as #1 for GLM |
| 5 | GLM | Stop button | Click "stop" mid-stream → fetch aborts → agent_end fires |
| 6 | GLM | Refresh token (A5) | Manually expire refresh_token → next chat triggers refresh → succeeds |
| 7 | DeepSeek | Login → chat | Same as #1 for DeepSeek |
| 8 | DeepSeek | 401 simulation | Programmatically delete `smidV2` cookie → chat shows re-login prompt |
| 9 | All | 5min timeout | Inject slow fetch → 5 min later → error "Request timed out" |
| **Total** | | | **9 tests** |

E2E uses `agent-browser` against the real Chrome (user's existing verification infra) + manual checklist for the 5min timeout / auto-close (because agent-browser's tab focus model is hard to verify with fake tabs).

### 11.3 Performance Assertions (target: 3, 0.25 day effort)

| # | Metric | Target | How |
|---|--------|-------:|------|
| 1 | Time-to-first-token (TTFT) | ≤ 3s | E2E test: send message → measure time until first text_delta arrives in sidepanel |
| 2 | Memory footprint | ≤ 50MB added per active tab | Chrome `performance.memory` in MAIN world + `chrome.system.memory` in SW |
| 3 | Tab close latency | ≤ 500ms | E2E: trigger 5min idle → measure time until tab disappears from chrome.tabs.query |

## 12. Acceptance Criteria (for "可用" status)

This milestone is **"usable"** when ALL of the following pass:

1. [ ] All 30-40 unit tests pass
2. [ ] All 6-9 E2E tests pass
3. [ ] All 3 perf assertions within target
4. [ ] Manual end-to-end: user logs into Kimi in Settings, opens chat, sees "Kimi / kimi-k2" in selector, picks it, sends "hello", receives streaming response within 3s
5. [ ] Manual: same for GLM and DeepSeek
6. [ ] Manual: clicking "stop" mid-stream cancels the request within 1s
7. [ ] Manual: closing the tab in Chrome's tab strip → next chat request re-opens it automatically
8. [ ] Manual: 5 min idle → tab auto-closes
9. [ ] Build size increase ≤ 200KB gzipped (3 new files in lib/ai-config/ + 1 in entrypoints/background/)
10. [ ] `pnpm check` clean (no new TS errors, no new i18n lint failures, no new pre-commit hook failures)
11. [ ] `pnpm test` still passes all 64 pre-existing tests + 30-40 new ones
12. [ ] No new console errors during 5-min idle / normal use

## 13. File Inventory (precise)

```
NEW (8 files — 4 prod + 4 test):
  lib/ai-config/web-provider-stream.ts                  ~120 LOC
  lib/ai-config/web-provider-stream.test.ts             ~150 LOC
  lib/ai-config/web-provider-models.ts                  ~ 80 LOC
  lib/ai-config/web-provider-models.test.ts             ~100 LOC
  lib/ai-config/web-provider-bundle.ts                  ~ 50 LOC
  lib/ai-config/web-provider-bundle.test.ts             ~ 60 LOC
  entrypoints/background/web-provider-relay.ts          ~280 LOC
  entrypoints/background/web-provider-relay.test.ts     ~200 LOC
                                                        --------
  Total new (prod):                                     ~530 LOC
  Total new (test):                                     ~510 LOC

MODIFIED (3 files):
  entrypoints/background/index.ts                       +3 LOC (1 import + 2 calls)
  components/chat/ModelSelector.tsx                     +25 LOC (web group render)
  lib/ai-config/web-provider-presets.ts                 +30 LOC (chatApi field on 3 presets)
                                                        --------
  Total modified:                                       +58 LOC

GRAND TOTAL: ~1098 LOC (vs ② milestone's ~2300 LOC; ~48% size)
```

## 14. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|:-----------:|:------:|-----------|
| **Provider API change** breaks chat mid-development | Medium | High (blocks E2E) | Pin to snapshot in fixtures; write E2E fast (within 1 day of research); have rollback to ② as fallback |
| **MAIN world fetch is slow** (TTFT > 3s) | Low | Medium | Per-provider perf test during Task 1; if TTFT > 3s, switch to SW-direct fetch with `credentials: 'include'` and `mode: 'no-cors'` (degraded but functional) |
| **Provider detects bot** (Cloudflare Turnstile / 403) | Medium | High | Hide tab from window group; `active: false` on create; reuse existing tab so cookies stay "warm" |
| **pi-ai 0.78 changes `registerApiProvider` signature in 0.79** | Low | Medium | Pin pi-ai to 0.78 in package.json; add a 1-line `// TODO: re-test on upgrade` comment in `web-provider-stream.ts` |
| **User has 3 web providers all open** (memory pressure) | Low | Low | 5-min auto-close + tab count check in `chrome.system.memory` (warn if > 100MB) |
| **SSE chunk format varies by provider** | Medium | Medium | Per-provider `parseDelta` function in `web-provider-presets.ts`; covered by 3 E2E tests |

## 15. Out of Scope (deferred to ⑤⑥⑦)

| Milestone | Scope | Est. |
|-----------|-------|------|
| **⑤ Maintenance** | 401/403 auto re-login prompt; Logout button; PBKDF2 user passphrase; re-login CTA in UI | 1.5 days |
| **⑥ Agent Tools** | XML tool prompt injection (chromeclaw pattern); xml-tag-parser; tool strategy per provider; tool registry | 2-3 days |
| **⑦ Scale & Polish** | Multi-turn conversation caching (provider conversation IDs); streaming resumption; provider rate limit handling; image attachments | 2-3 days |

## 16. Decision Log

### Decision 1: Tab-based fetch (vs SW-direct)
**Chosen**: tab-based (chromeclaw pattern)
**Why**: CORS forces it; same-origin fetch is the only way cookies attach
**Rejected**: SW-direct fetch (`credentials: 'include'`, `mode: 'no-cors'`) — opaque response, can't read body, defeats the purpose

### Decision 2: Tool support level
**Chosen**: C — design for tools, don't implement (leave event hooks in stream fn)
**Why**: Tools add 1.5-2 days for 10% of use cases; xml-tag-parser is brittle; can be added in ⑥ as additive change
**Rejected**: A (no tools, no hooks) — would need to re-architect stream fn when adding tools
**Rejected**: B (full chromeclaw pattern) — 1.5-2 days extra; brittle XML; native tool detection adds complexity

### Decision 3: Tab reuse + auto-close
**Chosen**: reuse + 5-min auto-close (chromeclaw pattern)
**Why**: Balance of speed (no re-open) and resource use (don't keep 3 hidden tabs forever); 5 min matches user session expectation
**Rejected**: open/close per request (1-2s overhead per chat, anti-bot detection risk)
**Rejected**: never close (memory waste, user confusion)

### Decision 4: Benchmark scope
**Chosen**: pragmatic — 30-40 unit + 6-9 E2E + 3 perf (vs chromeclaw's ~300 unit + ~80 E2E)
**Why**: chromeclaw is 9 providers × 5 pages; we are 3 providers × 1 page; direct comparison is unfair
**Rejected**: full chromeclaw benchmark — 5+ days, unrealistic for one milestone

### Decision 5: pi-ai integration via registerApiProvider (vs fork)
**Chosen**: use built-in `registerApiProvider` with `api: 'web-session'`
**Why**: pi-ai 0.78 exposes it; no fork needed; auto-cleanup via `unregisterApiProviders(sourceId)`
**Rejected**: fork pi-ai (maintenance burden, breaks on upgrade)

### Decision 6: Chat API config baked into preset (vs user-editable)
**Chosen**: baked into preset
**Why**: per-provider UI would explode complexity; users already see A2 advanced section for session indicators; chat API is provider-protocol, not user-tunable
**Rejected**: user-editable in Settings — complexity + risk of breakage

### Decision 7: Tool events reserved but not emitted
**Chosen**: stream fn pushes only `start`/`text_start`/`text_delta`/`text_end`/`done`/`error` in this milestone; `toolcall_*` events are *allowed* in the event contract but not emitted
**Why**: Future ⑥ can add XML parser without changing the stream fn signature; tests already verify the event types
**Rejected**: emit toolcall_*(undefined) to "reserve" — clutters tests; cleaner to just not emit

## 17. References

- `D:\Project\CebianX\chromeclaw-research\chrome-extension\src\background\web-providers\web-llm-bridge.ts` (681 LOC) — the bridge architecture we adapt
- `D:\Project\CebianX\chromeclaw-research\chrome-extension\src\background\web-providers\content-fetch-relay.ts` — ISOLATED-world relay pattern
- `D:\Project\CebianX\chromeclaw-research\chrome-extension\src\background\web-providers\content-fetch-main.ts` — MAIN-world fetch pattern
- `D:\Project\CebianX\chromeclaw-research\chrome-extension\src\background\web-providers\sse-parser.ts` — SSE frame parser (we re-implement, simpler)
- `D:\Project\CebianX\chromeclaw-research\chrome-extension\src\background\web-providers\registry.ts` — provider registry pattern
- `@earendil-works/pi-ai@0.78\dist\api-registry.d.ts` — `registerApiProvider` API
- `@earendil-works/pi-ai@0.78\dist\utils\event-stream.d.ts` — `AssistantMessageEventStream` factory
- `@earendil-works/pi-ai@0.78\dist\providers\faux.d.ts` — example of registering a custom provider
- `D:\Project\CebianX\cebian-web-provider\docs\superpowers\specs\2026-06-03-web-browser-cookie-extraction-design.md` — ② design (predecessor)
- `D:\Project\CebianX\cebian-web-provider\lib\agent.ts` — `createCebianAgent` (we hook into this)
- `D:\Project\CebianX\cebian-web-provider\entrypoints\background\agent-manager.ts` — `createAgent` (we hook into this)

## 18. Open Questions (to resolve during TDD Task 1: research)

1. **Kimi chat endpoint** — what URL does `kimi.com` POST to? Is it `https://kimi.moonshot.cn/api/chat/completions` (OpenAI-compat) or custom?
2. **GLM chat endpoint** — `https://chatglm.cn/chatglm/assistant/api/chat` or similar? What auth header does the request carry?
3. **DeepSeek chat endpoint** — `https://chat.deepseek.com/api/v0/chat/completions`?
4. **SSE format** — does each provider use standard `data: {...}\n\n` or custom event names?
5. **Stop signal** — `[DONE]` (OpenAI standard) or custom?
6. **Delta field** — `choices[0].delta.content` (OpenAI standard) or custom?
7. **Refresh token flow (GLM)** — how does the browser's frontend refresh `chatglm_refresh_token`? Can we hook into it from our background fetch?

These 7 questions are **blocking for Task 1 only**. Once we have answers, the rest of the implementation is straightforward.
