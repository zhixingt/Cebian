/**
 * Regression test: ChatPage must forward the `onOpenSettings` prop to
 * `useBackgroundAgent` so that the `web_provider_needs_relogin` flow
 * (which calls `callbacks.onOpenSettings?.()` in useBackgroundAgent.ts:255)
 * actually navigates the sidepanel to /settings when the session watcher
 * fires a 401 / needs-relogin.
 *
 * Bug history: 2026-06-07 real-E2E confirmed the toast fired but the
 * sidepanel did NOT navigate to Settings. Root cause: ChatPage was
 * destructuring `onOpenSettings` and only forwarding it to ChatInput's
 * "go to settings" button, never to `useBackgroundAgent`. The optional
 * chaining `callbacks.onOpenSettings?.()` silently no-op'd.
 *
 * This test catches the regression by mocking `useBackgroundAgent` and
 * asserting the callbacks object passed to it includes the same
 * `onOpenSettings` reference.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

// Capture the callbacks passed into useBackgroundAgent
const capturedCallbacks: { current: any } = { current: null };

vi.mock('@/hooks/useBackgroundAgent', () => ({
  useBackgroundAgent: (callbacks: any) => {
    capturedCallbacks.current = callbacks;
    return {
      state: { messages: [], isAgentRunning: false, sessionId: null, sessionTitle: '', connected: true, lastError: null },
      pendingTools: new Map(),
      send: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      resolveTool: vi.fn(),
    };
  },
}));

// Stub the rest of ChatPage's heavy imports
vi.mock('@/hooks/useStickToBottom', () => ({
  useStickToBottom: () => ({ scrollRef: { current: null }, isAtBottom: true, scrollToBottom: vi.fn() }),
}));
vi.mock('@/hooks/useStorageItem', () => ({
  // Return each item's declared fallback so the newly-mounted
  // <QuickActionsBar /> gets `[]` for `favoritePrompts` (its fallback) and
  // doesn't crash in `resolveFavorites(favorites).length` checking.
  useStorageItem: (_item: unknown, fallback: unknown) => [fallback, () => Promise.resolve()],
}));
vi.mock('@/lib/storage', () => ({
  activeModel: { getValue: vi.fn().mockResolvedValue(null), setValue: vi.fn() },
  // The page now mounts <QuickActionsBar />, which reads `favoritePrompts`.
  // The mock needs to expose it so the import doesn't throw, but its value
  // doesn't matter for these tests (we assert about captured useBackgroundAgent
  // callbacks, not the bar itself).
  favoritePrompts: { getValue: vi.fn().mockResolvedValue([]), setValue: vi.fn() },
}));
vi.mock('@/lib/i18n', () => ({
  t: (s: string) => s,
}));
vi.mock('@/lib/instance-id', () => ({
  myInstanceId: 'test-instance',
}));
vi.mock('@/components/chat/ChatInput', () => ({
  ChatInput: () => null,
}));
vi.mock('@/components/chat/Message', () => ({
  UserMessageBubble: () => null,
  AgentMessage: () => null,
  AgentTextBlock: () => null,
  ThinkingBlock: () => null,
}));
vi.mock('@/components/chat/ToolCard', () => ({
  ToolCard: () => null,
}));
vi.mock('@/components/chat/ToolCardWithUI', () => ({
  ToolCardWithUI: () => null,
}));

import { ChatPage } from '@/entrypoints/sidepanel/pages/chat';

beforeEach(() => {
  capturedCallbacks.current = null;
});

describe('ChatPage forwards onOpenSettings to useBackgroundAgent', () => {
  it('passes the onOpenSettings prop into useBackgroundAgent (so 401 relogin navigates to /settings)', () => {
    const onOpenSettings = vi.fn();
    render(
      <MemoryRouter initialEntries={['/chat/new']}>
        <Routes>
          <Route path="/chat/new" element={<ChatPage onOpenSettings={onOpenSettings} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(capturedCallbacks.current).not.toBeNull();
    expect(capturedCallbacks.current.onOpenSettings).toBe(onOpenSettings);
  });

  it('tolerates missing onOpenSettings prop (no throw, callback is undefined)', () => {
    expect(() => {
      render(
        <MemoryRouter initialEntries={['/chat/new']}>
          <Routes>
            <Route path="/chat/new" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>,
      );
    }).not.toThrow();
    expect(capturedCallbacks.current.onOpenSettings).toBeUndefined();
  });
});
