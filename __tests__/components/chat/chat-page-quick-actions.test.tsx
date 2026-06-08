/**
 * Regression test: ChatPage must mount <QuickActionsBar /> above <ChatInput />
 * so the user can quick-trigger favorite prompts.
 *
 * The bar reads `favoritePrompts` storage and resolves them via
 * `resolveFavorites → scanPrompts`. When the list is non-empty AND the
 * referenced prompts exist, the `quick-actions-bar` testid must be in the
 * DOM. When the list is empty (or the bar's resolution yields 0 items), the
 * testid must be absent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { useStorageItem } from '@/hooks/useStorageItem';
import { favoritePrompts } from '@/lib/storage';

vi.mock('@/hooks/useStorageItem');
vi.mock('@/lib/ai-config/scanner', () => ({
  scanPrompts: vi.fn(),
}));

// Heavy ChatPage dependencies — we don't render the full subtree, but the
// page still imports them at module-evaluation time, so they must resolve.
vi.mock('@/hooks/useBackgroundAgent', () => ({
  useBackgroundAgent: () => ({
    state: {
      messages: [],
      isAgentRunning: false,
      sessionId: null,
      sessionTitle: '',
      connected: true,
      lastError: null,
    },
    pendingTools: new Map(),
    send: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    resolveTool: vi.fn(),
  }),
}));
vi.mock('@/hooks/useStickToBottom', () => ({
  useStickToBottom: () => ({
    scrollRef: { current: null },
    isAtBottom: true,
    scrollToBottom: vi.fn(),
  }),
}));
vi.mock('@/lib/i18n', () => ({ t: (s: string) => s }));
vi.mock('@/lib/instance-id', () => ({ myInstanceId: 'test-instance' }));
vi.mock('@/lib/message-helpers', () => ({
  getAssistantText: vi.fn().mockReturnValue(''),
  getThinkingBlocks: vi.fn().mockReturnValue([]),
  getToolCalls: vi.fn().mockReturnValue([]),
  findToolResult: vi.fn().mockReturnValue(undefined),
  extractUserText: vi.fn().mockReturnValue(''),
}));
vi.mock('@/lib/tools/tool-labels', () => ({ getToolLabel: vi.fn() }));
vi.mock('@/lib/tools/ui-registry', () => ({
  uiToolRegistry: { get: vi.fn() },
}));
vi.mock('@/lib/tools/mcp-tool', () => ({
  isMcpAppResult: vi.fn().mockReturnValue(false),
}));

// ChatInput is heavy (recorder, web-providers, mobile emulation, etc.).
// This test only checks that the QuickActionsBar is mounted above it — the
// ref wiring between the two lives in a separate test.
vi.mock('@/components/chat/ChatInput', () => ({ ChatInput: () => null }));
vi.mock('@/components/chat/Message', () => ({
  UserMessageBubble: () => null,
  AgentMessage: () => null,
  AgentTextBlock: () => null,
  ThinkingBlock: () => null,
}));
vi.mock('@/components/chat/ToolCard', () => ({ ToolCard: () => null }));
vi.mock('@/components/chat/ToolCardWithUI', () => ({ ToolCardWithUI: () => null }));

import * as scanner from '@/lib/ai-config/scanner';
import { ChatPage } from '@/entrypoints/sidepanel/pages/chat';

const renderInRouter = (ui: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={['/chat/new']}>
      <Routes>
        <Route path="/chat/new" element={ui} />
      </Routes>
    </MemoryRouter>,
  );

const makePrompt = (fileName: string, name = fileName.replace('.md', '')) => ({
  fileName,
  name,
  description: '',
  filePath: `/prompts/${fileName}`,
});

describe('ChatPage mounts QuickActionsBar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: every storage item returns its declared fallback. The
    // per-test override below re-routes `favoritePrompts` to controlled
    // values; everything else (activeModel, etc.) gets its fallback.
    vi.mocked(useStorageItem).mockImplementation((_item, fallback) => [fallback, vi.fn()]);
  });

  it('renders the quick-actions-bar testid when favorites is non-empty', async () => {
    vi.mocked(useStorageItem).mockImplementation((item, fallback) => {
      if (item === favoritePrompts) return [['a.md'], vi.fn()];
      return [fallback, vi.fn()];
    });
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([makePrompt('a.md', 'alpha')]);

    renderInRouter(<ChatPage />);

    expect(await screen.findByTestId('quick-actions-bar')).toBeInTheDocument();
  });

  it('does NOT render the quick-actions-bar when favorites is empty', () => {
    vi.mocked(useStorageItem).mockImplementation((item, fallback) => {
      if (item === favoritePrompts) return [[], vi.fn()];
      return [fallback, vi.fn()];
    });
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([]);

    renderInRouter(<ChatPage />);

    expect(screen.queryByTestId('quick-actions-bar')).toBeNull();
  });
});
