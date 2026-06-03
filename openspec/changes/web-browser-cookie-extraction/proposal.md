# Proposal: Web Browser Cookie Extraction

## Summary

Replace the simulated login in the Web (Browser Session) Provider MVP with real
`chrome.cookies.getAll()` extraction, AES-GCM 256 encrypted storage, and a
"Login" tab-open polling flow. Add 6 production-grade enhancements (A1-A6) that
definitively outperform the chromeclaw reference implementation.

## Why

- MVP (shipped, 18 commits, 32 tests) has working UI but no real cookie
  capture — every "Re-check login" was `Math.random() < 0.7`
- Three LLM providers (chatglm.cn, kimi.com, chat.deepseek.com) offer
  logged-in web sessions users already have; we should let them reuse it
- The chromeclaw reference shows the design space but uses plain-text
  storage; we can do better with Web Crypto API AES-GCM 256
- Six production-grade enhancements (configurable session indicators,
  audit log, etc.) make this production-ready, not a toy

## What changes

**New files (5 source + 4 test = 9):**
- `hooks/useWebProviderWebLogin.ts` — real login hook (replaces `useWebProviderSimulatedLogin`)
- `lib/ai-config/web-provider-crypto.ts` — real AES-GCM 256 (replaces placeholder)
- `lib/ai-config/web-provider-cookie-service.ts` — background SW handlers
- `__tests__/lib/ai-config/web-provider-crypto.test.ts` — 8 tests
- `__tests__/lib/ai-config/web-provider-cookie-service.test.ts` — 12 tests
- `__tests__/hooks/useWebProviderWebLogin.test.ts` — 8 tests
- `__tests__/lib/ai-config/web-provider-presets.test.ts` — 4 tests

**Modified files (8):**
- `lib/types.ts` — add `LoginAuditEntry`, `LoginAttemptResult`, extend `WebProvider` with `userOverrides`, `loginAuditLog`, `expired` (5th LoginStatus)
- `lib/ai-config/web-provider-presets.ts` — add 4 fields to `WebProviderPreset`; populate for 3 presets; export `resolveEffectiveConfig`
- `lib/ai-config/web-provider-store.ts` — add 4 methods (`setEncryptedCookieBundle`, `clearEncryptedCookieBundle`, `setUserOverrides`, `appendAuditEntry`)
- `components/settings/provider/WebProviderCard.tsx` — add "Login" button + A1 transparency line + A2 "Advanced" section + A4 audit display
- `components/settings/sections/WebProvidersSubSection.tsx` — import swap + destructure new props
- `entrypoints/background.ts` — register cookie service
- `wxt.config.ts` — add `scripting` permission + 5 host_permissions
- `locales/{en,zh_CN,zh_TW}.yml` — 7 new strings × 3 locales

**Deleted files (2):**
- `hooks/useWebProviderSimulatedLogin.ts`
- `__tests__/hooks/useWebProviderSimulatedLogin.test.ts`

## Impact

- Affected specs: `web-browser-session-providers` (add 8 new requirements)
- New code: ~1,015 lines
- Modified code: ~260 lines
- Deleted code: ~100 lines
- New tests: ~37 test cases (8 crypto + 5 repo + 12 service + 8 hook + 4 presets)
- Effort: 5-7 days (was 1.5-2 days; user signed off on all 6 enhancements)
- User-visible: 0 breaking changes (UI only adds features)

## Out of scope (deferred)

- ③ Network relay (background SW fetches provider's API using stored cookies)
- ④ Agent integration (WebProvider as a model kind in `pi-agent-core` factory)
- ⑤ 401/403 re-login prompt
- PBKDF2 + user passphrase for encryption key
- Logout button in UI
- Custom user-defined presets (beyond 3 built-in)
