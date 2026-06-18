import { getDb, type WebProviderConversationRecord } from '@/lib/db';

/**
 * Per-(provider, model) server-side conversation memory pointer.
 *
 * Some web chat providers use a stateful protocol where the client must
 * echo back a server-issued id on each new message to keep the server's
 * context (Kimi uses `conversation_id`, GLM uses `conversation_id`,
 * DeepSeek uses `parent_message_id`, etc.). This record stores whichever
 * field the provider actually returns.
 *
 * The actual wire format (which field name to send on the next request,
 * and which field name to extract from each response) is provider-specific
 * and gated on T1 DevTools research. Until then, this storage layer
 * provides the durable foundation; the relay hook that populates it can
 * be added per-provider once the protocol is known.
 */
export interface WebProviderConversationState {
  /** Provider presetId (e.g. 'kimi', 'glm', 'deepseek') */
  providerId: string;
  /** Model id within the provider (e.g. 'kimi-k2-0711-preview') */
  modelId: string;
  /** Provider's conversation/session/thread id (whichever applies) */
  conversationId?: string;
  /**
   * Some providers track the last message id separately from the
   * conversation id (e.g. DeepSeek's parent_message_id). Optional
   * because not all providers use it.
   */
  parentMessageId?: string;
  /** Last write timestamp (ms since epoch). Used for LRU eviction later. */
  lastUpdated: number;
}

const KEY_SEP = '::';

function makeKey(providerId: string, modelId: string): string {
  return `${providerId}${KEY_SEP}${modelId}`;
}

/**
 * Look up a saved conversation state. Returns null if not present.
 * The synthetic `id` field (Dexie primary key) is stripped from the
 * returned record so callers see only the user-facing state shape.
 */
export async function getConversation(
  providerId: string,
  modelId: string,
): Promise<WebProviderConversationState | null> {
  const key = makeKey(providerId, modelId);
  const got = await getDb().webProviderConversations.get(key);
  if (!got) return null;
  const { id: _id, ...state } = got as WebProviderConversationRecord;
  return state as WebProviderConversationState;
}

/**
 * Persist a conversation state. Upserts on (providerId, modelId).
 */
export async function setConversation(
  state: WebProviderConversationState,
): Promise<void> {
  const key = makeKey(state.providerId, state.modelId);
  await getDb().webProviderConversations.put({ ...state, id: key } as any);
}

/**
 * Remove a conversation state. Idempotent: no-op if not present.
 */
export async function clearConversation(
  providerId: string,
  modelId: string,
): Promise<void> {
  const key = makeKey(providerId, modelId);
  await getDb().webProviderConversations.delete(key);
}
