## Why

Cebian currently requires API keys for every LLM provider (OpenAI, Anthropic, Google, custom OpenAI-compatible). A growing category of providers—chatglm.cn, kimi.com, chat.deepseek.com—offer free web UIs that already authorize calls using the user's logged-in browser session, with no API key needed. Users who have signed in to those sites in Chrome cannot currently reuse that auth state inside Cebian. This MVP adds a new provider category, "Web (Browser Session)", that lets users point Cebian at those sites and skip the API-key provisioning step.

## What Changes

- **New provider category** in the Settings page: "Web (Browser Session)" sub-section under `ProvidersSection`, rendered alongside existing API Key and OAuth provider cards
- **3 built-in presets** shipped in code: GLM (chatglm.cn), Kimi (kimi.com), DeepSeek (chat.deepseek.com) — each with a default Model ID, official login URL, and recommended capability flags (tool calls / reasoning)
- **Dexie schema extension** to version(2) with a new `webProviders` table (key = `presetId`); preserves all existing data (additive migration only)
- **Encryption field reservation** on each `WebProvider` row (`encryptedCookieBundle: string | null`) so future milestones can plug in real cookie storage without schema changes
- **Settings UI for 7 fields per preset**: enable toggle, login status badge, re-check button (1-2 second mocked flow with 70% success rate), editable Model ID, tool-calls toggle, reasoning toggle, "open website" link
- **i18n** for the new sub-section in 3 locales (en, zh_CN, zh_TW); reuses existing `common.time.*` keys for "last checked X minutes ago"
- **31 new unit tests** covering the Dexie repository, both React hooks, the placeholder crypto module, and the card component (TDD red-green)
- **MOCKED login flow in MVP** — no real cookie extraction, no network calls, no agent integration. All login state is simulated via local toggle + Dexie persistence. The mocked hook (`useWebProviderSimulatedLogin`) is structurally identical to its future real replacement (`useWebProviderRealLogin`), so swapping is a localized change

**BREAKING**: none. The change is purely additive — all existing provider cards, OAuth flows, Skills, Chat, and other Settings sections are untouched.

## Capabilities

### New Capabilities

- `web-browser-session-providers`: New provider category in Cebian that allows users to leverage their existing logged-in browser sessions to web-based AI chat services (e.g., chatglm.cn, kimi.com, chat.deepseek.com) without configuring API keys. In this MVP, login state is mocked; future milestones will add real cookie extraction, encrypted storage, network relay, and agent integration.

### Modified Capabilities

None. No existing spec-level behavior changes; this is a purely additive capability. (The `provider` capability in `openspec/specs/` is not affected — we do not modify the existing API Key / OAuth provider card behavior.)

## Impact

- **New files (10 source + 5 test)**:
  - `lib/types.ts` — add `WebProvider`, `LoginStatus` (+30 lines)
  - `lib/ai-config/web-provider-presets.ts` — 3 built-in presets
  - `lib/ai-config/web-provider-store.ts` — Dexie repository + singleton
  - `lib/ai-config/web-provider-crypto.ts` — encryption placeholder
  - `hooks/useWebProviders.ts` — CRUD + persistence hook
  - `hooks/useWebProviderSimulatedLogin.ts` — 1-2s mock flow
  - `components/settings/provider/WebProviderCard.tsx` — one card per preset
  - `components/settings/sections/WebProvidersSubSection.tsx` — container
  - `components/settings/provider/EmptyWebProvidersState.tsx` — Dexie-error fallback
  - 5 test files in `__tests__/`
- **Modified files (4)**:
  - `lib/db.ts` — add `webProviders` table to `version(2)`
  - `components/settings/sections/ProvidersSection.tsx` — append `<WebProvidersSubSection />`
  - `scripts/lint-i18n.mjs` — add `'webProviders'` to `ALLOWED_TOP_KEYS`
  - `locales/en.yml`, `locales/zh_CN.yml`, `locales/zh_TW.yml` — add `webProviders` namespace
- **No new runtime dependencies** — uses existing Dexie, React, shadcn/ui, sonner
- **No backend or network changes** — entirely client-side
- **No CLA implications** — additive, no upstream contract changes
- **AGPL-3.0** — all new code inherits the project's license; no new obligations

## Out of Scope (Reserved for Future Milestones)

The following are explicitly **not** part of this MVP and will be tracked as separate OpenSpec changes:

- ② Real `chrome.cookies.getAll()` extraction
- ③ Real encrypted IndexedDB bundle storage (AES-GCM via Web Crypto API)
- ④ Cross-origin network relay via background service worker
- ⑤ pi-agent-core integration (WebProvider as a model kind)
- Real 401/403 detection and re-login prompt
- User-defined custom presets
- Cross-tab state synchronization
- Dexie `liveQuery` reactive subscriptions

The MVP's architecture guarantees that none of these future milestones will require UI or hook changes — only the placeholder crypto module, a new repository method, and a new agent factory case need to be added.
