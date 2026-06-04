# ③+④ Network Relay & Agent Integration — Verification Report

**Milestone**: ③ (Network Relay) + ④ (Agent Integration) — combined per user decision
**Branch**: `feat/web-browser-session-provider`
**Commits**: 12 new (T2..T12), plus design (d510c42) + plan (cd86ba1)
**Tests**: 142/142 passing (was 64 before; +78 new)
**Build**: 9.59 MB clean
**i18n**: en/zh_CN/zh_TW parity ✓

## TL;DR

The Web (Browser Session) provider feature is **structurally complete** but
**not yet functional end-to-end** — T1 (DevTools research to capture real
Kimi/GLM/DeepSeek chat endpoints) was deferred because the user has not run
agent-browser against their real Chrome. T3 contains OpenAI-compatible
PLACEHOLDER endpoints that will work for the code structure but fail at
runtime with 401/403 or unexpected response shapes.

**One file edit (`web-provider-presets.ts` `chatApi?` field for kimi/glm/deepseek)**
will activate the feature once the user provides real endpoint data via T1.

## What was delivered (T2..T12)

| Task | Commit | Description | New tests |
|------|--------|-------------|-----------|
| T2 | 48244a9 | `WebProviderChatApi` interface + optional `chatApi?` field on preset | +2 |
| T3 | 7ed0d3b | Populate `chatApi?` for kimi/glm/deepseek with OpenAI-compat **placeholders** | +3 |
| T4 | 3b6b350 | `web-provider-bundle.ts` with 5min cache + 7d stale soft-warn | +8 |
| T5 | d92822d | `web-provider-models.ts` with `pi-ai Model<web-session>` lookup | +11 |
| T6 | afb5943 | `web-provider-relay.ts` TabRegistry (reuse + 5min auto-close) | +12 |
| T7 | 1bd7e46 | `injectRelayScripts` (ISOLATED then MAIN) + 4 message types | +6 |
| T8 | 894f0a1 | `parseSseFrames` + `parseDelta` + real MAIN-world fetcher | +13 |
| T9 | 3d0fd89 | AbortSignal + 60s timeout to `processChatStream` | +5 |
| T10 | 10089a3 | `web-provider-stream.ts` with `pi-ai StreamFunction` | +10 |
| T11 | a42447b | Wire `registerWebProviderStream()` in background startup | +0 (wiring only) |
| T12 | (this branch tip) | "Web (Logged in)" group at top of ModelSelector | +8 |

**New files (8)**: `web-provider-bundle.ts`, `web-provider-models.ts`,
`web-provider-relay.ts`, `web-provider-stream.ts`, `provider-groups.ts`,
`vitest-stubs/i18n.ts`, `vitest-stubs/imports.ts`, `__tests__/.../ModelSelector.test.ts`

**Modified files (3)**: `web-provider-presets.ts` (T2+T3), `entrypoints/background/index.ts`
(T11), `components/chat/ModelSelector.tsx` (T12), `vitest.config.ts` (T12 alias)

## Architecture (5 layers + 1 pi-ai adapter)

```
                ┌─────────────────────────────────────────────────────┐
                │              pi-ai ApiProvider registry              │
                │   api: 'web-session'  →  stream: webSessionStream   │
                └───────────────────────────┬─────────────────────────┘
                                            │ (T10)
                ┌───────────────────────────▼─────────────────────────┐
                │   web-provider-stream.ts (StreamFunction)            │
                │   • parseWebModelId → { providerId, modelId }        │
                │   • buildChatRequest (substitute {{messages}})        │
                │   • deps.onMessage  →  pi-ai events                  │
                └───────────────────────────┬─────────────────────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────┐
              │                             │                         │
   ┌──────────▼─────────┐    ┌───────────────▼──────────┐    ┌─────────▼────────┐
   │  TabRegistry (T6) │    │ processChatStream (T8+T9)│    │ injectRelayScripts│
   │  openOrReuseTab   │    │  parseSseFrames          │    │  (T7)             │
   │  5min auto-close  │    │  parseDelta              │    │ ISOLATED bridge   │
   │                   │    │  AbortSignal + 60s       │    │ MAIN fetcher      │
   └───────────────────┘    └──────────────────────────┘    └────────────────────┘
              │                             │                         │
              └─────────────────────────────┼─────────────────────────┘
                                            │
                ┌───────────────────────────▼─────────────────────────┐
                │   web-provider-bundle.ts (T4)                        │
                │   resolveBundle(providerId) — 5min cache + 7d warn    │
                └───────────────────────────┬─────────────────────────┘
                                            │
                ┌───────────────────────────▼─────────────────────────┐
                │   Dexie (webProviders table, from ②)                  │
                │   encryptedCookieBundle → decrypt → cookies           │
                └─────────────────────────────────────────────────────┘
```

## What was deferred (BLOCKING T14 E2E)

### T1 — DevTools research (user task, ~30 min)

For each of kimi / glm / deepseek, capture via Chrome DevTools:
1. Chat completion endpoint URL (POST target)
2. Request body shape (model field, messages field, extras like `stream_options`)
3. SSE format (standard `data: {json}\n\n` or chunked?)
4. Delta JSON path (e.g. `choices.0.delta.content` or custom)
5. Stop reason JSON path (e.g. `choices.0.finish_reason` or custom)
6. End signal (`data: [DONE]` or other)
7. Any provider-specific required headers (Authorization, x-api-key, etc.)

**How to run** (you):
```bash
# Open Chrome with your existing profile (logged into Kimi/GLM/DeepSeek)
chrome.exe --remote-debugging-port=9333 \
  --user-data-dir="D:\temp\cebian-verify-profile"

# In another terminal, connect agent-browser
agent-browser connect http://localhost:9333
agent-browser open https://kimi.com
# → Send a test message
# → DevTools Network tab: find the POST to the chat endpoint
# → Right-click → Copy → Copy as cURL
# → Repeat for glm / deepseek
```

**Then paste the cURLs back to me**, and I'll update T3 with the real
endpoints (single-file edit to `web-provider-presets.ts` `chatApi?` field).

### T14 — E2E manual verification (6-9 checks)

After T1 lands, verify:
- [ ] Chat with Kimi — first token in ≤3s, stream is smooth
- [ ] Chat with GLM — same
- [ ] Chat with DeepSeek — same
- [ ] Stop button aborts the stream immediately
- [ ] Tab is reused across 3 consecutive requests (only 1 chrome.tabs.create call)
- [ ] Tab auto-closes after 5min idle (visible in chrome://discards or via Webhook hook)
- [ ] Network: 401/403 → user-friendly error in chat
- [ ] Logout: bundle invalidates, next chat shows "please log in" error
- [ ] Re-login: chat works again without page reload

## Known issues / follow-ups (post-③+④)

1. **Tools/function calling** (Option C from brainstorming): Stream function
   reserves `toolcall_start/end` event hooks in the signature but never
   emits them. ⑥ milestone will add XML parser to emit these when providers
   support them. Single-file change to `web-provider-stream.ts`.

2. **401 re-login** (⑤): Not in this milestone. If a provider's cookie
   expires (e.g., 7d+ since login), the user must re-login via Settings
   (the "Logged in" badge will still show — stale detection is a soft
   warn, not a force-logout). Follow-up: detect 401 in MAIN fetcher,
   post `WEB_LLM_NEEDS_RELOGIN` message, SW triggers re-login flow.

3. **Image inputs**: All `Model<web-session>` has `input: ['text']` only
   (per `chatApi.supportsImages: false`). Adding image support requires
   provider research + bodyTemplate changes (T1+).

4. **Conversation caching**: Each request sends full message history.
   For long conversations, this is wasteful. ⑦ will add conversation-ID
   caching per provider (some providers like Kimi support server-side
   session memory).

5. **ChatInput wiring**: T12 added `webProviders?: WebProvider[]` prop
   to ModelSelector with a `= []` default. ChatInput.tsx does NOT yet
   pass this prop (requires useWebProviders hook + i18n key addition
   for `webProviders.selector.groupLabel` in en/zh_CN/zh_TW). Without
   this, the UI shows no Web group in the dropdown even when T1+T14
   pass. Wire-up is a follow-up edit to ChatInput.tsx + 3 i18n keys.

## Performance budget (from design §11)

- TTFT (time to first token) ≤ 3s for each provider — not measurable
  until T1+T14 pass
- Cache hit rate ≥ 80% (5min TTL on bundle decrypt) — measurable in
  production via Dexie read counters (not in this milestone)
- Stream abort latency ≤ 100ms — verified by T9 unit tests (Promise.race
  against abort signal)

## Files at a glance

```
D:\Project\CebianX\cebian-web-provider\
├── lib\ai-config\
│   ├── web-provider-presets.ts          [T2+T3] chatApi interface + placeholders
│   ├── web-provider-bundle.ts           [T4]   5min cache + 7d warn
│   ├── web-provider-models.ts           [T5]   pi-ai Model<web-session>
│   ├── web-provider-relay.ts            [T6+T7+T8+T9] tab + inject + SSE + abort
│   ├── web-provider-stream.ts           [T10]  StreamFunction for pi-ai
│   ├── web-provider-cookie-service.ts   [unchanged from ②]
│   └── web-provider-store.ts            [unchanged from ②]
├── components\chat\
│   ├── provider-groups.ts               [T12]  pure function (testable)
│   └── ModelSelector.tsx                [T12]  uses buildProviderGroups
├── entrypoints\background\
│   └── index.ts                         [T11]  +2 lines: register stream
├── __tests__\lib\ai-config\              (T2..T10 test files)
├── __tests__\components\chat\
│   └── ModelSelector.test.ts            [T12]
├── docs\superpowers\
│   ├── specs\2026-06-04-web-provider-agent-integration-design.md  [committed d510c42]
│   └── plans\2026-06-04-web-provider-agent-integration.md          [committed cd86ba1]
└── vitest-stubs\
    ├── i18n.ts                          [T12]  stub for WXT #i18n
    └── imports.ts                       [T12]  stub for WXT #imports
```

## How to verify on a fresh machine

```bash
cd D:\Project\CebianX\cebian-web-provider
pnpm install
pnpm test           # 142/142 pass
pnpm run check      # WXT prepare + tsc + i18n lint
pnpm run build      # 9.59 MB output
```

## Next milestone

After T1 (user research) + T14 (E2E verify) pass:
- ⑤ Maintenance: 401 re-login, logout, PBKDF2 hardening of bundle crypto
- ⑥ Tool support: add XML parser to stream function, emit toolcall events
- ⑦ Conversation caching: server-side session memory per provider
- Then: PR to upstream `maotoumao/Cebian` (requires CLA)
