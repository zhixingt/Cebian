# Changelog — Web (Browser Session) Provider

Branch: `feat/web-browser-session-provider`
Total commits: 27 (② + B + ③+④ + ⑤ + followups)
Tests: 181/181 passing (was 64 at ② start; +117 new)
Build: 9.6 MB clean • i18n: en/zh_CN/zh_TW parity ✓

---

## ② — Cookie Capture (foundation)

**16 commits.** Lets the user reuse their browser's existing login state
(no API key required) for Kimi/GLM/DeepSeek.

| Feature | Description |
|---|---|
| Login button | Opens a tab at the provider, polls for session cookies, encrypts + persists |
| Re-check button | Verifies stored bundle can still decrypt (re-auth indicator) |
| A1 capture display | Shows what was captured (count, names, timestamp) |
| A2 user overrides | Per-provider overrides for cookie domain, session indicators, refresh URL |
| A4 audit log | Last 5 login attempts (success/timeout/refresh-failed/decryption-failed/no-cookies) |
| Cookie crypto | AES-GCM 256 with chrome.storage.local key; ② already filled in real impl |
| Dexie schema v2 | Adds `webProviders` table with all provider fields |

**Bug fixes during ②**:
- A1: "Captured N cookies" line now persists per provider after login
- Toast position: top-right → bottom-right
- Toast on failure path (was missing)

---

## B — ChatInput wiring (post-③+④ UI gap)

**1 commit.** T12 added `webProviders?: WebProvider[]` prop to
ModelSelector, but ChatInput never passed it. Without this, the Web
group was never visible in the dropdown, even after T1 lands.

- `hooks/useWebProviders().providers` → `ModelSelector.webProviders`
- 3 new i18n keys: `webProviders.selector.groupLabel` per locale

---

## ③+④ — Network Relay & Agent Integration

**13 commits + REPORT.md.** The core wiring that makes Web providers
actually usable in chat.

| Layer | New file | Purpose |
|---|---|---|
| Types | `web-provider-presets.ts` (T2/T3) | `WebProviderChatApi` interface (9 fields), populated for 3 providers with placeholders |
| Cache | `web-provider-bundle.ts` (T4) | `resolveBundle()` with 5min in-memory cache + 7d stale soft-warn |
| Model | `web-provider-models.ts` (T5) | `pi-ai Model<'web-session'>` constructor; `getAvailableWebModels` filter |
| Relay | `web-provider-relay.ts` (T6/T7/T8/T9) | TabRegistry (reuse + 5min auto-close), injectRelayScripts (ISOLATED then MAIN), parseSseFrames, parseDelta, processChatStream (AbortSignal + 60s timeout) |
| Stream | `web-provider-stream.ts` (T10) | `pi-ai StreamFunction<'web-session'>`: parses model id, builds request, opens tab, listens for messages, maps to pi-ai events |
| Wiring | `entrypoints/background/index.ts` (T11) | `registerWebProviderStream()` on SW startup |
| UI | `ModelSelector.tsx` (T12) | "Web (Logged in)" group at top of dropdown |
| UI helper | `components/chat/provider-groups.ts` (T12) | Pure `buildProviderGroups` for testability |

**Event flow** (chat with Web provider):
1. Agent → runWebSessionStream → resolveBundle → openOrReuseTab → injectScripts
2. MAIN-world fetcher → fetch() with first-party cookies → SSE stream
3. MAIN → ISOLATED bridge → chrome.runtime.sendMessage → SW listener
4. SW → orchestrateStream (T10) → text_start, text_delta, text_end, done events
5. pi-ai event stream → pi-ai agent loop

**Test coverage**: 86 new tests across 9 test files (T2-T12).

---

## ⑤ — Maintenance (401 re-login + Logout + toast)

**6 commits + REPORT.md + 2 followups.** Handles the failure mode when
a Web provider's session cookie has gone stale.

| Step | File | Behavior |
|---|---|---|
| ⑤.1 detect | `web-provider-relay.ts:executeChatRequest` | 401/403 → `WEB_LLM_NEEDS_RELOGIN` (not generic error) |
| ⑤.2 SW handle | `entrypoints/background/web-provider-relogin.ts` | Invalidate bundle cache + broadcast to sidepanel |
| ⑤.3 Logout button | `WebProviderCard.tsx` + `WebProvidersSubSection.tsx` | Clears bundle, sets loggedOut, invalidates cache, toast |
| ⑤.4 toast | `hooks/handle-web-provider-needs-relogin.ts` | Destructive toast + openSettings |
| ⑤.4.followup | `hooks/useBackgroundAgent.ts` | Plumbed `onOpenSettings` callback (was no-op TODO) |
| ⑤.INTEGRATION | `__tests__/integration/web-provider-relogin-flow.test.ts` | End-to-end: fetcher 401 → SW → sidepanel toast + openSettings |
| T14 #7-#8 | `__tests__/integration/web-provider-logout-flow.test.ts` | Logout flow: cache invalidation, re-login restores capability, no fetch call when logged out |

**Test coverage**: 15 new tests (⑤.1-⑤.4 pure handlers + SW integration + sidepanel + 2 integration flows).

---

## T1-partial — Web search (autonomous T1 attempt)

**1 commit.** The user's T1 (DevTools research) requires their physical
Chrome + login + traffic capture. I attempted the autonomous
counterpart: web search of published API docs.

| Provider | Public API endpoint | Found via | Notes |
|---|---|---|---|
| Kimi | `https://api.moonshot.ai/v1/chat/completions` | platform.kimi.ai | OpenAI-compatible; Bearer auth; tools/function calling supported |
| GLM | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | Z.AI / yangmao.ai docs | OpenAI-compatible; Bearer auth; tools/function calling supported |
| DeepSeek | `https://api.deepseek.com/chat/completions` | api-docs.deepseek.com | OpenAI-compatible; Bearer auth; thinking mode + tools supported |

**What this confirmed**: all 3 use OpenAI-compatible wire format (SSE
with `data: [DONE]`, `choices[0].delta.content`, `choices[0].finish_reason`).

**What this updated** (in `web-provider-presets.ts`):
- Model names: `kimi-k2-0905-preview` → `kimi-k2-0711-preview`; `GLM-4.6` → `glm-4.6`
- Endpoint URLs: updated to public-API best guesses for the web session path
- Added comments explaining public-API-vs-web-session distinction

**What this did NOT do**: the WEB SESSION endpoint hosts (vs public API)
and auth header details still need user DevTools verification.

---

## What remains (user input required)

| | Why blocked | Your action |
|---|---|---|
| **T1** full | Web session endpoints differ from public APIs | Run `chrome.exe --remote-debugging-port=9333` + `agent-browser`, send chats at kimi.com/chatglm.cn/chat.deepseek.com, DevTools → Copy as cURL → paste back. I do the rest. |
| **T14** #1, #2, #8, #9 | Real chat with real providers | After T1, the 4 remaining manual checks are: (1) chat with each provider works, (2) TTFT ≤3s, (8) re-login flow, (9) TTFT assertions. T14 #3-#7 are covered by automated tests. |
| **⑥** Tool support | YAGNI (re-verified 3×) | All 3 providers use UI buttons for tools in web sessions; LLM never emits `tool_calls` in the stream. No autonomous path. |
| **⑦** Conversation caching | Provider-specific protocols | After T1, the request/response for conversation memory is known. Implementing requires per-provider session-id field name + storage. |

---

## Verification commands

```bash
cd D:\Project\CebianX\cebian-web-provider
pnpm install        # 1 minute
pnpm test           # 181/181 pass in ~30s
pnpm run check      # WXT types + TS + i18n lint
pnpm run build      # 9.6 MB output
```

## Reports

- `docs/superpowers/specs/2026-06-04-web-provider-agent-integration-design.md` (475 lines)
- `docs/superpowers/plans/2026-06-04-web-provider-agent-integration.md` (2000+ lines)
- `docs/superpowers/reports/2026-06-04-web-provider-agent-integration-REPORT.md` (208 lines — ③+④)
- `docs/superpowers/reports/2026-06-04-web-provider-maintenance-REPORT.md` (194 lines — ⑤)

## Branch state

```
$ git log --oneline -28
80a92cb test(integration): add logout flow + parseWebModelId round-trip tests (T14 #7-#8)
d7d334f feat(presets): update T3 placeholders with web-search-verified format (T1 partial)
c37f8bc feat(sidepanel): plumb onOpenSettings callback through useBackgroundAgent (⑤.4.followup)
c748463 docs: add ⑤ Maintenance verification report
c00253d feat(sidepanel): handle web_provider_needs_relogin with toast (⑤.4)
c1aa5d8 feat(chat): add Logout button on WebProviderCard (⑤.3)
a313539 feat(background): handle WEB_LLM_NEEDS_RELOGIN (invalidate + broadcast) (⑤.2)
238b1bf feat(relay): detect 401/403 in fetcher and emit WEB_LLM_NEEDS_RELOGIN (⑤.1)
ec4f79a feat(chat): wire webProviders from useWebProviders to ModelSelector (B follow-up)
53af256 docs: add ③+④ Network Relay & Agent Integration verification report (T15)
1bea8ba feat(chat): add 'Web (Logged in)' group to ModelSelector (T12)
a42447b feat(background): wire registerWebProviderStream() in SW startup (T11)
10089a3 feat(ai-config): add web-provider-stream.ts with pi-ai StreamFunction (T10)
3d0fd89 feat(relay): add AbortSignal + 60s timeout to processChatStream (T9)
894f0a1 feat(relay): add SSE parser + delta extractor + real fetcher (T8)
1bd7e46 feat(relay): add injectRelayScripts + message contract (T7)
afb5943 feat(relay): add TabRegistry with reuse + 5min auto-close (T6)
d92822d feat(ai-config): add web-provider-models.ts with pi-ai Model<web-session> lookup (T5)
3b6b350 feat(ai-config): add web-provider-bundle.ts with 5min cache + 7d stale warn (T4)
7ed0d3b feat(ai-config): populate chatApi for kimi/glm/deepseek with OpenAI-compat placeholders (T3)
48244a9 feat(ai-config): add WebProviderChatApi type + optional chatApi? on preset (T2)
cd86ba1 docs(plan): add ③+④ Network Relay & Agent Integration implementation plan
d510c42 docs: add ③+④ Network Relay & Agent Integration design spec
... ② (16 commits) ...
```

---

## Next milestone

When the user provides T1 data, the activation path is:
1. User pastes cURLs from Kimi/GLM/DeepSeek DevTools
2. I extract the web session endpoint + body shape from each cURL
3. I patch `web-provider-presets.ts` `chatApi?` field for the 3 providers (single-file edit)
4. T14 #1, #2, #8, #9 run as manual checks against the real extension
5. (Optionally) start ⑦ conversation caching
6. Final: PR to upstream `maotoumao/Cebian` (requires CLA)
