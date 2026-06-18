## 1. Foundation (Environment & Core Types)

- [ ] 1.1 Verify dev environment (Node 20+, pnpm 10+, Git 2.x, OpenSpec 1.3+) and install test stack (vitest, @testing-library/react, fake-indexeddb, jsdom) if missing
- [ ] 1.2 Add smoke test to verify vitest infrastructure runs, then delete the smoke test
- [ ] 1.3 Commit test infrastructure changes (`chore(test): add vitest + fake-indexeddb + jsdom`)
- [ ] 1.4 Append `WebProvider` interface and `LoginStatus` union to `lib/types.ts` (presetId, enabled, loginStatus, modelId, supportsToolCalls, supportsReasoning, lastCheckedAt, encryptedCookieBundle, createdAt, updatedAt)
- [ ] 1.5 Run `pnpm run check` to verify types compile, then commit (`feat(types): add WebProvider and LoginStatus interfaces`)

## 2. Data Layer (Presets, Schema, Crypto, Repository)

- [ ] 2.1 Create `lib/ai-config/web-provider-presets.ts` with 3 built-in presets (GLM / Kimi / DeepSeek), each with displayNameKey, descriptionKey, loginUrl, defaultModelId, defaultSupportsToolCalls, defaultSupportsReasoning
- [ ] 2.2 Run `pnpm run check`, commit (`feat(ai-config): add 3 built-in web provider presets`)
- [ ] 2.3 Extend `lib/db.ts`: import `WebProvider` type, declare `webProviders!: Table<WebProvider, string>`, add `this.version(2).stores({...all existing..., webProviders: 'presetId, enabled, updatedAt'})` (strictly additive — re-declare all existing tables in version(2))
- [ ] 2.4 Run `pnpm run check`, commit (`feat(db): add webProviders table in Dexie version(2)`)
- [ ] 2.5 Create `__tests__/lib/ai-config/web-provider-crypto.test.ts` with 3 failing tests: isEncryptionEnabled returns false; encryptCookieBundle throws /not implemented in MVP/i; decryptCookieBundle throws same
- [ ] 2.6 Run test, verify red
- [ ] 2.7 Create `lib/ai-config/web-provider-crypto.ts` with the 3 placeholder functions (throw / not implemented in MVP / or return false)
- [ ] 2.8 Run test, verify green, commit (`feat(ai-config): add crypto placeholder with MVP not-implemented semantics`)
- [ ] 2.9 Create `__tests__/lib/ai-config/web-provider-store.test.ts` with 10 failing tests (3 for list, 2 for get, 1 for setEnabled, 2 for setLoginStatus, 1 for setModelId, 2 for setCapability)
- [ ] 2.10 Run test, verify red
- [ ] 2.11 Create `lib/ai-config/web-provider-store.ts` with `WebProviderRepository` class and `getWebProviderRepository()` singleton (use ESM top-level import of `getDb`)
- [ ] 2.12 Run test, verify all 10 green, commit (`feat(ai-config): add WebProviderRepository with TDD coverage (10 cases)`)

## 3. Internationalization (3 Locales + Lint)

- [ ] 3.1 Add `'webProviders'` to the `ALLOWED_TOP_KEYS` set in `scripts/lint-i18n.mjs`
- [ ] 3.2 Append `webProviders` namespace (sectionTitle, sectionDescription, presets.{glm,kimi,deepseek}.{name,description}, fields.{enabled,modelIdLabel,modelIdHelp,capabilities,toolCalls,reasoning,recheck,checking,openWebsite}, status.{loggedIn,loggedOut,neverChecked}, messages.{loadFailed,recheckFailed}) to `locales/en.yml`
- [ ] 3.3 Append equivalent namespace with full Chinese translations to `locales/zh_CN.yml`
- [ ] 3.4 Append equivalent namespace with full Traditional Chinese translations to `locales/zh_TW.yml`
- [ ] 3.5 Run `pnpm run check` to verify 3 i18n lint checks pass (allow-list, parity, no Chinese in source)
- [ ] 3.6 Commit (`feat(i18n): add webProviders namespace in en/zh_CN/zh_TW`)

## 4. State Hooks (TDD)

- [ ] 4.1 Create `__tests__/hooks/useWebProviderSimulatedLogin.test.ts` with 6 failing tests (initial null, recheck sets checkingId, double-click ignored, success path, failure path, reset after completion)
- [ ] 4.2 Run test, verify red
- [ ] 4.3 Create `hooks/useWebProviderSimulatedLogin.ts` with `useRef` in-flight lock + `useState` checkingId + 1-2s `setTimeout` + `Math.random() < 0.7` success branch
- [ ] 4.4 Run test, verify 6 green, commit (`feat(hooks): add useWebProviderSimulatedLogin with TDD coverage (6 cases)`)
- [ ] 4.5 Create `__tests__/hooks/useWebProviders.test.ts` with 8 failing tests (initial load, setEnabled, setLoginStatus, setModelId, setCapability, error capture, unmount safety, multiple updates)
- [ ] 4.6 Run test, verify red
- [ ] 4.7 Create `hooks/useWebProviders.ts` with the write-then-refresh pattern: 4 update methods each writing to Dexie then calling refresh; cancelled flag in useEffect; error captured in state
- [ ] 4.8 Run test, verify 8 green, commit (`feat(hooks): add useWebProviders with TDD coverage (8 cases)`)

## 5. UI Components (TDD)

- [ ] 5.1 Create `__tests__/components/settings/provider/WebProviderCard.test.tsx` with 4 failing tests (renders without crash, toggle enable calls onEnabledChange, edit modelId calls onModelIdChange, click recheck calls onRecheck)
- [ ] 5.2 Run test, verify red
- [ ] 5.3 Create `components/settings/provider/WebProviderCard.tsx` — fully controlled component using shadcn `<Card>`, `<Switch>`, `<Input>`, `<Button>`, `<Badge>`; 7 props: provider, preset, isChecking, onEnabledChange, onModelIdChange, onCapabilityChange, onRecheck
- [ ] 5.4 Run test, verify 4 green, commit (`feat(ui): add WebProviderCard with TDD coverage (4 cases)`)
- [ ] 5.5 Create `components/settings/provider/EmptyWebProvidersState.tsx` (defensive Dexie-error fallback, no tests)
- [ ] 5.6 Run `pnpm run check`, commit (`feat(ui): add EmptyWebProvidersState for Dexie error path`)
- [ ] 5.7 Create `components/settings/sections/WebProvidersSubSection.tsx` — container that uses both hooks, maps over `providers` to render `<WebProviderCard>`, handles loading + error states; verify i18n import path matches project convention
- [ ] 5.8 Run `pnpm run check`, commit (`feat(ui): add WebProvidersSubSection container`)
- [ ] 5.9 Modify `components/settings/sections/ProvidersSection.tsx`: add `import { WebProvidersSubSection } from './WebProvidersSubSection'`; append `<WebProvidersSubSection />` before the closing tag of the existing return
- [ ] 5.10 Run `pnpm run check`, commit (`feat(settings): mount WebProvidersSubSection in Providers`)

## 6. Verification & Release

- [ ] 6.1 Run `pnpm test` to verify all 31 new unit tests pass (10 + 3 + 6 + 8 + 4)
- [ ] 6.2 Run `pnpm run check` to verify TypeScript zero errors and i18n lint zero warnings
- [ ] 6.3 Run `pnpm run build` to verify the production build completes (output written to `.output/chrome-mv3/`)
- [ ] 6.4 Commit any generated artifacts (`chore(build): regenerate types after MVP additions`) if applicable
- [ ] 6.5 Load the unpacked extension in Chrome via `chrome://extensions` and verify the 12 acceptance criteria from the design doc (3 preset cards visible, 7 fields per card, re-check 1-2s flow, persistence, locale switching, no regression, build loads)
- [ ] 6.6 Push the branch to origin (`git push origin feat/web-browser-session-provider`)
- [ ] 6.7 (Optional) Open a PR from the fork to upstream `maotoumao/Cebian`, ticking the CLA checkbox in the PR template
