import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  type WebProviderConversationState,
  clearConversation,
  getConversation,
  setConversation,
} from '@/lib/ai-config/web-provider-conversations';

describe('webProviderConversations (⑦: state storage foundation)', () => {
  beforeEach(async () => {
    // Reset webProviderConversations table for each test (no-op if table
    // doesn't exist yet on the first test run, which is the RED phase).
    try {
      await getDb().webProviderConversations.clear();
    } catch {
      // Table may not exist yet during initial TDD red phase.
    }
  });

  it('getConversation returns null when no state exists', async () => {
    const result = await getConversation('kimi', 'kimi-k2-0711-preview');
    expect(result).toBeNull();
  });

  it('setConversation then getConversation round-trips a state', async () => {
    const state: WebProviderConversationState = {
      providerId: 'kimi',
      modelId: 'kimi-k2-0711-preview',
      // Provider-specific field names. After T1 we know whether providers
      // use conversation_id, session_id, thread_id, or parent_message_id.
      // The interface allows multiple optional fields; the relay extracts
      // whichever the provider actually returns.
      conversationId: 'conv_abc123',
      parentMessageId: 'msg_xyz789',
      lastUpdated: 1717500000000,
    };
    await setConversation(state);
    const got = await getConversation('kimi', 'kimi-k2-0711-preview');
    expect(got).toEqual(state);
  });

  it('clearConversation removes the state for a given provider+model', async () => {
    const state: WebProviderConversationState = {
      providerId: 'glm',
      modelId: 'glm-4.6',
      conversationId: 'conv_zzz',
      lastUpdated: 1717500000000,
    };
    await setConversation(state);
    await clearConversation('glm', 'glm-4.6');
    const got = await getConversation('glm', 'glm-4.6');
    expect(got).toBeNull();
  });

  it('isolates state by (providerId, modelId) — clearing one does not affect others', async () => {
    const a: WebProviderConversationState = {
      providerId: 'kimi',
      modelId: 'kimi-k2-0711-preview',
      conversationId: 'conv_a',
      lastUpdated: 1,
    };
    const b: WebProviderConversationState = {
      providerId: 'glm',
      modelId: 'glm-4.6',
      conversationId: 'conv_b',
      lastUpdated: 2,
    };
    const c: WebProviderConversationState = {
      providerId: 'kimi',
      modelId: 'different-model',
      conversationId: 'conv_c',
      lastUpdated: 3,
    };
    await setConversation(a);
    await setConversation(b);
    await setConversation(c);
    await clearConversation('kimi', 'kimi-k2-0711-preview');
    expect(await getConversation('kimi', 'kimi-k2-0711-preview')).toBeNull();
    expect(await getConversation('glm', 'glm-4.6')).toEqual(b);
    expect(await getConversation('kimi', 'different-model')).toEqual(c);
  });

  it('setConversation upserts — overwriting previous state for same key', async () => {
    const v1: WebProviderConversationState = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      conversationId: 'conv_old',
      lastUpdated: 100,
    };
    const v2: WebProviderConversationState = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      conversationId: 'conv_new',
      parentMessageId: 'msg_parent',
      lastUpdated: 200,
    };
    await setConversation(v1);
    await setConversation(v2);
    const got = await getConversation('deepseek', 'deepseek-chat');
    expect(got).toEqual(v2);
  });

  it('handles state with only required fields (no conversationId/parentMessageId)', async () => {
    const minimal: WebProviderConversationState = {
      providerId: 'kimi',
      modelId: 'kimi-k2-0711-preview',
      lastUpdated: 1717500000000,
    };
    await setConversation(minimal);
    const got = await getConversation('kimi', 'kimi-k2-0711-preview');
    expect(got).toEqual(minimal);
  });
});
