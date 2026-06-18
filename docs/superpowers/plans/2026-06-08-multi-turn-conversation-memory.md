# Plan: ⑨.2 — Multi-turn conversation memory for Web (Browser Session) Provider

> **For agentic workers:** Pick this up after Issue 1 (Stop button) is done. Multi-turn memory is a real product feature — once GLM/DeepSeek is logged in, conversations should continue from where they left off, not start fresh each chat.

## Goal

Persist per-provider conversation state so that when the user sends a new message in an existing conversation, the Web (Browser Session) provider's chat surface uses the same conversation ID / parent message ID. Right now, every message is a fresh conversation (cookies captured once, no per-conversation state).

## Current state

The Dexie `webProviderConversations` table exists (from milestone ⑦ foundation) but is **unwired**:
- Schema: `providerId`, `conversationId` (or `parentMessageId` depending on provider), `lastUsedAt`, `createdAt`
- No code reads or writes it
- Every chat starts a new session in the provider's UI

## Per-provider state shape

| Provider | Conversation state | Where it lives |
|---|---|---|
| GLM | `conversation_id` in chatglm.cn URL + `parentMessageId` for each reply | URL path + last reply metadata |
| ~~Kimi~~ | (removed) | — |
| ~~DeepSeek~~ | (removed) | — |

GLM only is in scope (others removed per the 2026-06-07 cleanup).

## Proposed approach

### Phase 1: Persist `conversation_id` per session

1. On first message in a new chat: SW opens chatglm.cn → DOM-injection → reads `conversation_id` from the URL on the chat page
2. Persist `webProviderConversations` row: `{providerId: 'glm', sessionId: <chat sessionId>, conversationId: 'xxx', lastUsedAt: now}`
3. On subsequent message in the same session: SW navigates chatglm.cn to `https://chatglm.cn/main/chat/{conversationId}` BEFORE injecting the message
4. This way the provider's chat surface loads the existing conversation; new messages append to it

### Phase 2: Persist `parentMessageId` for the last reply

GLM's API needs the `parentMessageId` of the previous reply to maintain multi-turn context (each new query references the parent reply). After each successful reply:

1. DOM reader extracts `parentMessageId` from the reply's DOM (likely a `data-message-id` attribute or a hidden metadata field)
2. SW persists it: `webProviderConversations[sessionId].lastReplyId = 'xxx'`
3. On next message, the DOM adapter includes `parentMessageId` in the query (or the chatglm.cn chat surface does this automatically once we're on the right conversation page)

### Phase 3: Invalidate on session loss

When the session watcher (Issue 2 fix) detects session loss and broadcasts `web_provider_needs_relogin`:
1. Don't clear `webProviderConversations` rows (they're not session-bound)
2. After re-login, the next message will create a new conversation (old `conversation_id` may be invalid) — the row will be updated with the new ID

## Key files to touch

| File | Change |
|---|---|
| `lib/ai-config/web-provider-conversations.ts` | Add helpers: `getConversation(sessionId)`, `setConversation(sessionId, data)`, `clearConversation(sessionId)` |
| `lib/ai-config/web-provider-content-script.ts` | Extract `conversation_id` from URL on chat page; include in `WEB_LLM_DONE` payload |
| `lib/ai-config/web-provider-stream.ts` | Before each chat: navigate to conversation URL; persist conversationId on done |
| `lib/ai-config/web-provider-content-fetch-glm.ts` | Read `parentMessageId` from reply DOM, include in subsequent requests |

## Tests (TDD)

- **Unit (`web-provider-conversations.ts`)**: get/set/clear round-trip; multiple sessionIds don't collide
- **Unit (stream)**: navigates to conversation URL on second message
- **Integration**: full multi-turn — 3 messages in one session, all land in the same chatglm.cn conversation

## Risks

| Risk | Mitigation |
|---|---|
| `conversation_id` becomes invalid after re-login | Phase 3: invalidate on session loss |
| chatglm.cn URL pattern changes | Centralize URL builder; easy to update |
| Race: two parallel chats on same session | Add a per-session lock in the stream |

## Non-goals

- ❌ Cross-device sync (Dexie is local-only)
- ❌ Per-model conversation memory (one conversation per session, not per model)
- ❌ Conversation title/rename (use chatglm.cn's auto-generated title)

## Effort estimate

~2-3 days. TDD with 12-15 new tests. Worth doing because it makes the Web Provider actually usable for multi-turn (currently it's a fancy single-turn chat).

## Rollback

Revert the commits. `webProviderConversations` table can stay (it's harmless when unused) or be dropped in a follow-up cleanup.
