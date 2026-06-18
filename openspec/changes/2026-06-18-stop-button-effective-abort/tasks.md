# Tasks: Stop button effective abort

## 1. SW-side abort port

- [ ] 1.1 In `lib/ai-config/web-provider-stream.ts`, open `chrome.runtime.connect({name: \`abort-${sessionId}\`})` when starting a chat; keep the port reference in session state
- [ ] 1.2 On `cancel(sessionId)`, call `port.postMessage({type: 'abort'})` then `port.disconnect()`
- [ ] 1.3 In the `finally` block of `orchestrateStream`, ensure port is disconnected (cleanup on done/error/cancel)

## 2. ISOLATED bridge abort forwarding

- [ ] 2.1 In `lib/ai-config/web-provider-content-script.ts`, listen for messages on the abort port
- [ ] 2.2 On receiving `{type: 'abort'}`, forward to MAIN world via `window.postMessage({type: 'WEB_LLM_ABORT'})`

## 3. MAIN-world IIFE abort flag

- [ ] 3.1 In `lib/ai-config/web-provider-content-fetch-glm.ts`, add `window.__webProviderAbortFlag = false` at the start of `runDomRelayMainWorld`
- [ ] 3.2 Add a `window.addEventListener('message', ...)` handler that sets `window.__webProviderAbortFlag = true` on receiving `WEB_LLM_ABORT`
- [ ] 3.3 At the top of the polling loop, check `window.__webProviderAbortFlag` and break early if set (post `WEB_LLM_DONE` with truncated text so SW cleans up)

## 4. Tests (TDD)

- [ ] 4.1 Unit test: `runDomRelayMainWorld` returns early when `__webProviderAbortFlag` is set mid-poll
- [ ] 4.2 Unit test: ISOLATED bridge forwards `WEB_LLM_ABORT` from port to window.postMessage
- [ ] 4.3 Unit test: SW `cancel()` calls `port.postMessage({type:'abort'})`
- [ ] 4.4 Integration test: full flow — SW starts chat → cancel mid-stream → no residual text in assistant message

## 5. Verification

- [ ] 5.1 Run `pnpm test` — all tests pass
- [ ] 5.2 Run `pnpm compile` — TypeScript zero errors
