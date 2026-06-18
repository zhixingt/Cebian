# Proposal: Stop button effective abort (DOM-injection path)

## Summary

Make the red "Stop" button in the chat sidepanel actually cancel the in-flight AI reply on the DOM-injection path (GLM provider), so no residual text appears in the assistant message bubble after Stop is clicked.

## Problem

Currently, clicking Stop only cancels the SW-side stream (`terminated = true`, `stream.end()`). The MAIN-world IIFE polling the DOM every 100ms keeps running, continues reading the AI reply, and eventually pushes `WEB_LLM_DONE` with the full accumulated text — which then leaks into the assistant message bubble.

## Solution

Add a bidirectional abort channel between the SW and the MAIN-world IIFE via `chrome.runtime.connect`:

1. SW opens a named port `abort-${sessionId}` on chat start
2. On `cancel(sessionId)`, SW posts `{type: 'abort'}` on the port
3. ISOLATED bridge forwards the abort to the MAIN world via `window.postMessage({type: 'WEB_LLM_ABORT'})`
4. MAIN-world IIFE checks `window.__webProviderAbortFlag` at the top of each polling iteration and breaks early

## Non-goals

- HTTP-replay path (Issue 1 only affects DOM-injection path)
- Content script abort for chatglm.cn's own UI (we only cancel our polling)
- UX improvements to the Stop button itself (focus on the backend)
