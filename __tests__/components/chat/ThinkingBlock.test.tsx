/**
 * Tests for `ThinkingBlock` (in `components/chat/Message.tsx`).
 *
 * Locks two contracts:
 *  1. Labels are sourced from the i18n keys `chat.thinkingBlock.live` and
 *     `chat.thinkingBlock.label` — never hard-coded English. The keys
 *     intentionally live in a separate `chat.thinkingBlock.*` namespace
 *     from `chat.thinking.*` (used by `ThinkingLevelSelector`) to avoid
 *     placeholder-shape collisions.
 *  2. The block auto-expands while `isLive` is true and auto-collapses
 *     once `isLive` flips to false. The user can still click the header
 *     to manually toggle the body after streaming ends.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThinkingBlock } from '@/components/chat/Message';
import { t } from '@/lib/i18n';

vi.mock('@/lib/i18n', () => ({ t: vi.fn((k: string) => k) }));
// Markdown render in the body is heavy and irrelevant to these contracts.
vi.mock('@/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

describe('ThinkingBlock — i18n labels', () => {
  beforeEach(() => vi.mocked(t).mockClear());

  it('uses chat.thinkingBlock.live while streaming', () => {
    render(<ThinkingBlock content="reasoning…" isLive={true} />);
    expect(t).toHaveBeenCalledWith('chat.thinkingBlock.live');
  });

  it('uses chat.thinkingBlock.label after streaming ends', () => {
    render(<ThinkingBlock content="reasoning…" isLive={false} />);
    expect(t).toHaveBeenCalledWith('chat.thinkingBlock.label');
  });

  it('does not call the colliding chat.thinking.label key', () => {
    render(<ThinkingBlock content="x" isLive={true} />);
    render(<ThinkingBlock content="x" isLive={false} />);
    const calledKeys = vi.mocked(t).mock.calls.map(([k]) => k);
    expect(calledKeys).not.toContain('chat.thinking.label');
  });
});

describe('ThinkingBlock — collapse behavior', () => {
  it('renders the body open while isLive is true', () => {
    render(<ThinkingBlock content="live content" isLive={true} />);
    // The MarkdownRenderer stub exposes content via data-testid when the
    // body grid-row is expanded.
    expect(screen.getByTestId('md')).toHaveTextContent('live content');
  });

  it('auto-collapses the body when isLive flips to false', () => {
    const { rerender } = render(<ThinkingBlock content="x" isLive={true} />);
    rerender(<ThinkingBlock content="x" isLive={false} />);
    // After auto-collapse, the body div with overflow-hidden keeps the
    // content mounted but visually hidden via grid-rows-[0fr]. We assert
    // the body container switched its grid-template-rows class to the
    // collapsed variant.
    const collapsedWrapper = document.querySelector('.grid-rows-\\[0fr\\]');
    expect(collapsedWrapper).not.toBeNull();
  });

  it('user click after streaming ends re-expands the body', () => {
    render(<ThinkingBlock content="x" isLive={false} />);
    // Header is a <button>; the label is rendered inside it. Click it.
    const headerButton = screen.getByRole('button');
    fireEvent.click(headerButton);
    // After manual toggle, the body wrapper should switch to the open
    // grid-template-rows class.
    const openWrapper = document.querySelector('.grid-rows-\\[1fr\\]');
    expect(openWrapper).not.toBeNull();
  });

  it('does not allow manual toggle while isLive is true', () => {
    // While live, the body must stay open regardless of header clicks.
    render(<ThinkingBlock content="x" isLive={true} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('md')).toHaveTextContent('x');
  });
});
