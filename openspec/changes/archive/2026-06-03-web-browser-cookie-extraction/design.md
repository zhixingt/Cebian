# Design: Web Browser Cookie Extraction

See: `docs/superpowers/specs/2026-06-03-web-browser-cookie-extraction-design.md`
(1250 lines, committed: `276e892`).

## Key sections

- **§3 Detection logic** — 3-tier: cookies → localStorage → stored creds
- **§4 Login flow** — open tab + 5s MIN_WAIT + 2s poll + 5min timeout
- **§5 Encryption** — AES-GCM 256 with key in `chrome.storage.local`
- **§9 Background service** — `chrome.cookies`, `chrome.tabs`, `chrome.scripting`
- **§19 Enhancements A1-A6** — KEY ONE = A2 configurable session indicators

## Reference impl (read-only, NOT forking)

`D:\Project\CebianX\chromeclaw-research\`
- `chrome-extension/src/background/web-providers/auth.ts` (225 lines) — `initiateWebLogin` is the gold standard for our `handleLogin`
- `packages/shared/lib/hooks/use-web-provider-auth.ts` (190 lines) — `useWebProviderAuth` hook pattern; we deviate on encryption and configurability

## Six production-grade enhancements (A1-A6, user-signed)

| ID | Name | Why included |
|---|---|---|
| A1 | UI transparency | Lets user verify preset values are correct |
| **A2** | **Configurable session indicators (KEY ONE)** | Without this, Kimi/DeepSeek unverified presets mean user must edit source code |
| A3 | Active tab tracking | Saves 60% CPU during the 5-min wait |
| A4 | Login attempt audit log | "Why did login fail?" — chromeclaw only shows a toast; we show full history |
| A5 | RefreshAuth retry with exponential backoff | Covers 90% of network blips on GLM's refresh endpoint |
| A6 | Detect already-open tab | Reuse existing tab instead of opening a duplicate |
