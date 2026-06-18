# Design: Stop button effective abort

## Architecture

```
SW: cancel(sessionId)
  ↓ port.postMessage({type:'abort'})
ISOLATED bridge: port message → window.postMessage({type:'WEB_LLM_ABORT'})
  ↓
MAIN world: window message handler sets window.__webProviderAbortFlag = true
  ↓
MAIN world: polling loop checks flag, breaks early
  ↓
ISOLATED bridge: receives WEB_LLM_DONE (with truncated text), forwards to SW
  ↓
SW: terminated check returns early, cleans up
```

## Key files to modify

| File | Change |
|---|---|
| `lib/ai-config/web-provider-stream.ts` | Open abort port on chat start; close on cancel |
| `lib/ai-config/web-provider-content-script.ts` | Listen on abort port; forward to MAIN world via window.postMessage |
| `lib/ai-config/web-provider-content-fetch-glm.ts` | Add `__webProviderAbortFlag` window global; check in polling loop |
| `entrypoints/background/index.ts` | Manage port lifecycle per session (open on prompt, close on done/error/cancel) |

## Risks

| Risk | Mitigation |
|---|---|
| Port cleanup leaks memory on session destroy | Disconnect port in `finally` of `orchestrateStream` |
| IIFE misses the abort if it's mid-await | Re-check flag at start of each iteration of the polling loop |
| Multiple sessions in flight → ports collide | Use unique port name `abort-${sessionId}` |

## Rollback

Revert the single commit. No schema/storage changes.
