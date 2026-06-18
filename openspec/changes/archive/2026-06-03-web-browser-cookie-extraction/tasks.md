# Tasks: Web Browser Cookie Extraction

See: `docs/superpowers/plans/2026-06-03-web-browser-cookie-extraction.md`
(1864 lines, committed: `c858143`).

## 15 tasks (numbered 0-14, sequential)

| # | Task | TDD cases |
|---|---|---|
| 0 | Verify MVP baseline (32 tests pass) | 0 |
| 1 | Create OpenSpec change (this change) | 0 |
| 2 | Extend WebProvider type (`userOverrides`, `loginAuditLog`, `expired`) | 0 |
| 3 | Update presets + `resolveEffectiveConfig` (A2) | 4 |
| 4 | Real AES-GCM 256 crypto (replaces placeholder) | 8 |
| 5 | Repository A2/A4 methods (4 new methods) | 5 |
| 6 | Background service: login + A3 + A5 + A6 + audit | 12 |
| 7 | `useWebProviderWebLogin` hook (replaces simulated) | 8 |
| 8 | UI updates: Login button + A1 + A2 Advanced + A4 audit | 0 |
| 9 | Delete `useWebProviderSimulatedLogin` | 0 |
| 10 | Manifest permissions (`scripting` + 5 hosts) | 0 |
| 11 | i18n additions (7 strings × 3 locales) | 0 |
| 12 | Full test suite + build verification | 0 |
| 13 | Manual Chrome verification (24 checks) | 0 |
| 14 | Final commit + push + OpenSpec archive | 0 |

**Total: 37 new test cases** (32 MVP retained = 69 total).
