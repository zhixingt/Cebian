# Cebian Web Provider E2E Harness

Playwright-based end-to-end tests for the 6-item regression list documented
in `docs/superpowers/plans/2026-06-06-web-provider-stale-state-cleanup.md`.

## Prerequisites

1. **Node 20+** (the project uses `v24.15.0`)
2. **Chrome stable** installed at the default path (Windows: `%ProgramFiles%\Google\Chrome\Application\chrome.exe`). The config uses `channel: 'chrome'` so the harness reuses your system Chrome rather than downloading Playwright's bundled Chromium.
3. **The extension built**: `pnpm build` must have produced `.output/chrome-mv3/`. If missing, every spec throws at startup with a clear error.

## Run

```bash
# One-time
pnpm add -D @playwright/test   # already done in this branch
pnpm build                      # produce .output/chrome-mv3/

# Run the full suite
pnpm test:e2e

# Run a single spec
pnpm test:e2e -- e2e/specs/06-reload-cleanup.spec.ts

# Run with headed output + trace
pnpm test:e2e -- --headed --trace on
```

## What each spec covers

| # | File | Item | Manual action needed? |
|---|---|---|---|
| 1 | `01-only-glm.spec.ts` | Settings → Web Provider section lists only GLM | None |
| 2 | `02-pre-auth-blocked.spec.ts` | Pre-auth: sidepanel prompts for login / model selection | None |
| 3 | `03-send-receive.spec.ts` | Login → send → reply (full integration) | **YES — log in to chatglm.cn once** |
| 4 | `04-multi-turn.spec.ts` | 3 consecutive turns, no 60s timeout regression | **YES — log in to chatglm.cn once** |
| 5 | `05-api-key-fallback.spec.ts` | API Key providers unaffected by web provider state | None |
| 6 | `06-reload-cleanup.spec.ts` | Stale `activeModel` cleared on extension reload | None |

## How the login-required specs work

Items 3 and 4 cannot bypass the chatglm.cn login flow (it requires a
password and possibly a captcha, which no automation can solve). The
harness handles this by:

1. Opening a chatglm.cn tab in the test browser
2. Calling `awaitUserLogin(page, 5*60*1000)` which polls every 2s for
   a visible, enabled chat input — a strong signal the user is past
   the login screen
3. Once the user is detected as logged in, the spec proceeds with
   automated chat

When you run the harness, **watch the Chrome window the harness opens**.
You will see:
- A sidepanel at `chrome-extension://<id>/sidepanel.html`
- A chatglm.cn tab at `https://chatglm.cn`
- A console window with `pnpm test:e2e` output

Log in to chatglm.cn in the opened tab. The spec will detect the login
within 2s and continue.

## How the test isolation works

- `e2e/.userdata/` is a dedicated Chrome user data dir. Specs that need
  a clean slate call `wipeUserDataDir()` before launch.
- `workers: 1` in `playwright.config.ts` because the extension shares
  state across pages.
- `fullyParallel: false` for the same reason.

## Limitations / caveats

- **chatglm.cn is a real production site.** Selectors in `helpers/chatglm.ts`
  use broad fallbacks because the site's DOM may change. If chatglm.cn
  updates its UI, the helpers may need updates.
- **The Dexie `webProviderConversations` table is not asserted.** The
  cleanup code in `web-provider-store.list()` only targets
  `webProviders`, not `webProviderConversations` (per the plan:
  harmless because `getConversation()` filters by current provider).
  If that table starts causing issues, add a new spec.
- **API Key provider chat is not exercised end-to-end.** Item 5 only
  asserts the model selector is reachable and `activeModel` is well-
  formed. A full "send a message via API key" test would require
  either a real API key or a mock backend.
