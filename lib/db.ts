import Dexie, { type EntityTable } from 'dexie';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { WebProvider } from './types';

// ─── Schema ───

export interface SessionRecord {
  id: string;
  title: string;
  model: string;
  provider: string;
  userInstructions: string;
  thinkingLevel: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  messages: AgentMessage[];
}

// ─── Database ───

const db = new Dexie('cebian') as Dexie & {
  sessions: EntityTable<SessionRecord, 'id'>;
  webProviders: EntityTable<WebProvider, 'presetId'>;
};

db.version(1).stores({
  sessions: 'id, updatedAt',
});

// version(2) is strictly additive — re-declares sessions to avoid data loss
// and introduces the webProviders table for the new Web (Browser Session)
// provider feature. See docs/superpowers/specs/2026-06-03-web-browser-session-provider-design.md
// section 3.3 for the migration rationale.
db.version(2).stores({
  sessions: 'id, updatedAt',
  webProviders: 'presetId, enabled, updatedAt',
});

/**
 * Singleton accessor for the Dexie database. Matches the style expected by
 * the WebProviderRepository (lib/ai-config/web-provider-store.ts) and other
 * future repositories. Existing code continues to use the module-level
 * `db` const directly; this function is additive.
 */
export function getDb(): typeof db {
  return db;
}

// ─── Session CRUD ───

export async function createSession(session: SessionRecord): Promise<void> {
  await db.sessions.add(session);
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return db.sessions.get(id);
}

export async function listSessions(): Promise<SessionRecord[]> {
  return db.sessions.orderBy('updatedAt').reverse().toArray();
}

export async function updateSessionMessages(
  id: string,
  messages: AgentMessage[],
): Promise<void> {
  // Token / cost totals are derived on-demand from each AssistantMessage.usage
  // in the UI; we deliberately do not persist aggregates to keep a single
  // source of truth (see entrypoints/sidepanel/pages/chat/index.tsx).
  await db.sessions.update(id, {
    messages,
    messageCount: messages.length,
    updatedAt: Date.now(),
  });
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  await db.sessions.update(id, { title, updatedAt: Date.now() });
}

export async function deleteSession(id: string): Promise<void> {
  await db.sessions.delete(id);
}

// ─── Throttled writer ───

export class ThrottledSessionWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { id: string; messages: AgentMessage[] } | null = null;

  constructor(private delayMs = 3000) {}

  schedule(id: string, messages: AgentMessage[]): void {
    this.pending = { id, messages: [...messages] };
    if (this.timer) return; // Already scheduled
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      const { id, messages } = this.pending;
      this.pending = null;
      await updateSessionMessages(id, messages);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }
}
