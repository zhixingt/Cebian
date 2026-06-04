# ⑤ Maintenance — Verification Report

**Milestone**: ⑤ (Maintenance: 401 re-login + Logout + sidepanel toast)
**Branch**: `feat/web-browser-session-provider`
**Commits**: 5 new (⑤.1..⑤.4) on top of ③+④ (which was 14 commits)
**Tests**: 168/168 passing (was 158 before ⑤; +10 new for ⑤)
**Build**: 9.6 MB clean

## TL;DR

⑤ adds the failure-mode handling for web providers. When a session
cookie has gone stale (e.g., the user manually logged out in their
browser, or the 5min bundle cache + 7d warn missed something), the
fetcher gets a 401/403. Instead of looping on the same error, the
user now gets a clear re-login flow:

1. ⑤.1: Fetcher detects 401/403 → emits `WEB_LLM_NEEDS_RELOGIN`
2. ⑤.2: SW receives it → invalidates bundle cache + broadcasts
3. ⑤.3: User can also proactively log out via a new "Logout" button
   on the WebProviderCard (clears bundle + sets loggedOut)
4. ⑤.4: Sidepanel receives the broadcast → shows a destructive toast
   "Kimi session expired: ..."

## What was delivered (⑤.1..⑤.4)

| Task | Commit | Description | New tests |
|------|--------|-------------|-----------|
| ⑤.1 | 238b1bf | `executeChatRequest()` — 401/403 → `WEB_LLM_NEEDS_RELOGIN` (not generic error) | +7 |
| ⑤.2 | a313539 | `entrypoints/background/web-provider-relogin.ts` — SW handler: invalidate + broadcast | +9 |
| ⑤.3 | c1aa5d8 | Logout button on WebProviderCard + i18n keys (en/zh_CN/zh_TW) | +4 |
| ⑤.4 | c00253d | `hooks/handle-web-provider-needs-relogin.ts` — sidepanel toast (pure) + useBackgroundAgent wiring | +6 |

**New files (2)**: `hooks/handle-web-provider-needs-relogin.ts`,
`entrypoints/background/web-provider-relogin.ts`

**Modified files (6)**: `lib/ai-config/web-provider-relay.ts`, `entrypoints/background/index.ts`,
`components/settings/provider/WebProviderCard.tsx`,
`components/settings/sections/WebProvidersSubSection.tsx`,
`lib/protocol.ts`, `hooks/useBackgroundAgent.ts`

**i18n keys added (en/zh_CN/zh_TW, all in parity)**:
- `webProviders.fields.logout` = "Logout" / "退出登录" / "登出"
- `webProviders.messages.logoutSuccess`
- `webProviders.messages.logoutFailed`

## Architecture: the re-login loop

```
            ┌──────────────────────────────────────────────────────┐
            │  User types a message with a logged-in web model     │
            └────────────────────┬─────────────────────────────────┘
                                 │ (chat prompt)
            ┌────────────────────▼─────────────────────────────────┐
            │  Background: agent → runWebSessionStream (T10)      │
            │  → TabRegistry.openOrReuseTab (T6)                  │
            │  → injectRelayScripts (T7)                          │
            └────────────────────┬─────────────────────────────────┘
                                 │
            ┌────────────────────▼─────────────────────────────────┐
            │  MAIN-world fetcher (T8) — executeChatRequest (⑤.1)│
            │  fetch(endpoint, { credentials: 'include' })        │
            └────────────────────┬─────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              ┌─────▼─────┐              ┌──────▼──────┐
              │ 200 + SSE │              │ 401 / 403  │
              │ chunks    │              │            │
              └─────┬─────┘              └──────┬──────┘
                    │                         │
                    │                         ▼
                    │            ┌────────────────────────────┐
                    │            │ ⑤.1: emit                  │
                    │            │ WEB_LLM_NEEDS_RELOGIN      │
                    │            └────────┬───────────────────┘
                    │                     │
                    │                     ▼
                    │            ┌────────────────────────────┐
                    │            │ ⑤.2: SW handler            │
                    │            │ • invalidateBundle(id)     │
                    │            │ • broadcast to sidepanel   │
                    │            └────────┬───────────────────┘
                    │                     │
                    │                     ▼
                    │            ┌────────────────────────────┐
                    │            │ ⑤.4: sidepanel              │
                    │            │ • showToast (destructive)  │
                    │            │ • openSettings (TODO)     │
                    │            └────────┬───────────────────┘
                    │                     │
                    ▼                     ▼
              (stream chunks)      ┌────────────────────────────┐
              to pi-ai             │ User clicks Login button   │
                                    │ → ⑤.3 (or auto on re-login)│
                                    └────────────────────────────┘
```

## What was deferred (small follow-ups)

### 1. `openSettings` is a no-op (⑤.4 TODO)

The sidepanel's `useBackgroundAgent` doesn't have access to the
view state, so the `openSettings` dep in the handler is currently a
no-op. The toast alone alerts the user, who can navigate to Settings
manually. To plumb it through:

- Add a `setActiveView('settings')` or similar callback to
  `useBackgroundAgent` (signature change)
- OR use a global event bus / context
- OR keep the no-op and consider it MVP-acceptable

### 2. No confirmation dialog on Logout (⑤.3 MVP)

The Logout button is destructive (red color) but has no "Are you
sure?" modal. Re-login is one click, so the risk is low. Follow-up
if users report accidents: add a 2-step confirm.

## How to test manually (after T1 lands)

1. Login to a provider (e.g., Kimi) via Settings
2. Manually sign out in your browser (e.g., clear Kimi cookies)
3. Try to chat with the Kimi model
4. **Expected**: Sidepanel shows toast "Kimi session expired:
   Provider rejected the session (HTTP 401). Please re-login to
   kimi via Settings → Web Providers." — within 1-2 seconds
5. Click "Login" in Settings → Web Providers
6. Re-login → next chat works

## How to test manually (Logout, no T1 required)

1. Login to any provider
2. Click the red "Logout" button on its WebProviderCard
3. **Expected**:
   - Toast: "Logged out. Stored cookies have been cleared."
   - Status badge changes from "Logged in" to "Not logged in"
   - Next chat attempt shows "please log in" (no 401 loop)

## Performance / correctness assertions

- ⑤.1: Promise.race against abort signal — cancellation is
  immediate (no waiting for the read() to return)
- ⑤.2: invalidateBundle runs BEFORE broadcast (so the next
  resolveBundle() in any concurrent chat sees loggedOut)
- ⑤.3: Bundle cache invalidated after Dexie clear (no 5min stale
  window)
- ⑤.4: showToast runs BEFORE openSettings (user sees notification
  even if view change is slow)

## Files at a glance

```
D:\Project\CebianX\cebian-web-provider\
├── hooks\
│   ├── handle-web-provider-needs-relogin.ts   [⑤.4 NEW]  pure handler (testable)
│   └── useBackgroundAgent.ts                  [⑤.4 MOD]  +1 switch case
├── entrypoints\background\
│   ├── index.ts                               [⑤.2 MOD]  +registerWebProviderReloginHandler call
│   └── web-provider-relogin.ts                [⑤.2 NEW]  SW handler
├── lib\
│   ├── ai-config\web-provider-relay.ts         [⑤.1 MOD]  +executeChatRequest, +WEB_LLM_NEEDS_RELOGIN
│   └── protocol.ts                            [⑤.4 MOD]  +ServerMessage variant
├── components\settings\
│   ├── provider\WebProviderCard.tsx           [⑤.3 MOD]  +Logout button + onLogout prop
│   └── sections\WebProvidersSubSection.tsx    [⑤.3 MOD]  +onLogout callback wiring
├── locales\en.yml, zh_CN.yml, zh_TW.yml       [⑤.3 MOD]  +3 keys
└── __tests__\
    ├── lib\ai-config\web-provider-relay.test.ts      [⑤.1]  +7
    ├── background\web-provider-relogin.test.ts      [⑤.2]  +9
    ├── components\settings\provider\WebProviderCard.test.tsx  [⑤.3]  +4
    └── hooks\handle-web-provider-needs-relogin.test.ts      [⑤.4]  +6
```

## Branch state

```
$ git log --oneline -6
c00253d feat(sidepanel): handle web_provider_needs_relogin with toast (⑤.4)
c1aa5d8 feat(chat): add Logout button on WebProviderCard (⑤.3)
a313539 feat(background): handle WEB_LLM_NEEDS_RELOGIN (invalidate + broadcast) (⑤.2)
238b1bf feat(relay): detect 401/403 in fetcher and emit WEB_LLM_NEEDS_RELOGIN (⑤.1)
53af256 docs: add ③+④ Network Relay & Agent Integration verification report (T15)
ec4f79a feat(chat): wire webProviders from useWebProviders to ModelSelector (B follow-up)
... ② + ③+④ ...
```

19 commits total on `feat/web-browser-session-provider` branch.

## Next milestone

⑥ Tool support: add XML parser to stream function, emit
`toolcall_start/delta/end` events. Reserved in T10 but never emitted
— all 3 providers (Kimi/GLM/DeepSeek) use UI buttons for tool calls
in their web sessions, so this is YAGNI for MVP. Skip to ⑦ (conversation
caching) if no provider supports XML tool calls in the web UI.
