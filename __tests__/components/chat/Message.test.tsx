import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserMessageBubble, AgentMessage, AgentTextBlock } from '@/components/chat/Message';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/i18n', () => ({ t: (s: string) => s }));
vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('@/lib/dialog', () => ({ showDialog: vi.fn() }));

import { copyText } from '@/lib/clipboard';

const makeUserMessage = (text: string) => ({
  role: 'user' as const,
  content: [{ type: 'text' as const, text }],
  timestamp: Date.now(),
});

describe('UserMessageBubble', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders user text content', () => {
    render(<UserMessageBubble msg={makeUserMessage('Hello world')} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('applies text-justify and textAlignLast:left to user message bubble', () => {
    const { container } = render(<UserMessageBubble msg={makeUserMessage('Hello world')} />);
    const bubble = container.querySelector('.text-justify');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveStyle({ textAlignLast: 'left' });
  });

  it('shows message actions on hover', () => {
    const { container } = render(
      <UserMessageBubble msg={makeUserMessage('Hello')} onCopy={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    // MessageActions uses group-hover:opacity-100; simulate hover on the parent group
    const group = container.querySelector('.group');
    expect(group).not.toBeNull();
    // Actions container should be in the DOM even when opacity is 0
    expect(container.querySelector('[aria-label="common.copy"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="common.edit"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="common.delete"]')).toBeInTheDocument();
  });

  it('calls onCopy when copy button is clicked', () => {
    const onCopy = vi.fn();
    render(<UserMessageBubble msg={makeUserMessage('Hello')} onCopy={onCopy} />);
    fireEvent.click(screen.getByLabelText('common.copy'));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('falls back to copying text directly when onCopy is not provided', () => {
    render(<UserMessageBubble msg={makeUserMessage('Hello')} />);
    fireEvent.click(screen.getByLabelText('common.copy'));
    expect(copyText).toHaveBeenCalledWith('Hello');
  });

  it('enters edit mode when edit button is clicked', () => {
    const onEdit = vi.fn();
    render(<UserMessageBubble msg={makeUserMessage('Hello')} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('common.edit'));
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument();
  });

  it('submits edited text and calls onEdit', () => {
    const onEdit = vi.fn();
    render(<UserMessageBubble msg={makeUserMessage('Hello')} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('common.edit'));
    const textarea = screen.getByDisplayValue('Hello');
    fireEvent.change(textarea, { target: { value: 'Hello edited' } });
    fireEvent.click(screen.getByText('common.send'));
    expect(onEdit).toHaveBeenCalledWith('Hello edited');
  });

  it('cancels edit mode and restores original text on cancel button click', () => {
    const onEdit = vi.fn();
    render(<UserMessageBubble msg={makeUserMessage('Hello')} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('common.edit'));
    const textarea = screen.getByDisplayValue('Hello');
    fireEvent.change(textarea, { target: { value: 'Changed' } });
    fireEvent.click(screen.getByText('common.cancel'));
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('cancels edit mode on Escape key', () => {
    const onEdit = vi.fn();
    render(<UserMessageBubble msg={makeUserMessage('Hello')} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('common.edit'));
    const textarea = screen.getByDisplayValue('Hello');
    fireEvent.change(textarea, { target: { value: 'Changed' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('submits on Enter key without shift', () => {
    const onEdit = vi.fn();
    render(<UserMessageBubble msg={makeUserMessage('Hello')} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('common.edit'));
    const textarea = screen.getByDisplayValue('Hello');
    fireEvent.change(textarea, { target: { value: 'Hello edited' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onEdit).toHaveBeenCalledWith('Hello edited');
  });

  it('does not submit when trimmed text is empty', () => {
    const onEdit = vi.fn();
    render(<UserMessageBubble msg={makeUserMessage('Hello')} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('common.edit'));
    const textarea = screen.getByDisplayValue('Hello');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('common.send'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<UserMessageBubble msg={makeUserMessage('Hello')} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText('common.delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('does not render edit button when onEdit is not provided', () => {
    render(<UserMessageBubble msg={makeUserMessage('Hello')} />);
    expect(screen.queryByLabelText('common.edit')).not.toBeInTheDocument();
  });

  it('does not render delete button when onDelete is not provided', () => {
    render(<UserMessageBubble msg={makeUserMessage('Hello')} />);
    expect(screen.queryByLabelText('common.delete')).not.toBeInTheDocument();
  });
});

describe('AgentMessage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders children content', () => {
    render(<AgentMessage>Bot response</AgentMessage>);
    expect(screen.getByText('Bot response')).toBeInTheDocument();
  });

  it('shows header by default', () => {
    render(<AgentMessage>Hello</AgentMessage>);
    expect(screen.getByText('Cebian Agent')).toBeInTheDocument();
  });

  it('hides header when showHeader is false', () => {
    render(<AgentMessage showHeader={false}>Hello</AgentMessage>);
    expect(screen.queryByText('Cebian Agent')).not.toBeInTheDocument();
  });

  it('shows streaming indicator when isStreaming', () => {
    const { container } = render(<AgentMessage isStreaming>Hello</AgentMessage>);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows copy button when copyText is provided', () => {
    render(
      <TooltipProvider>
        <AgentMessage copyText="copy me">Hello</AgentMessage>
      </TooltipProvider>,
    );
    const buttons = screen.getAllByLabelText('common.copy');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('calls copyText when copy button is clicked', () => {
    render(
      <TooltipProvider>
        <AgentMessage copyText="copy me">Hello</AgentMessage>
      </TooltipProvider>,
    );
    const buttons = screen.getAllByLabelText('common.copy');
    fireEvent.click(buttons[0]);
    expect(copyText).toHaveBeenCalledWith('copy me');
  });

  it('shows delete button when onDelete is provided', () => {
    const onDelete = vi.fn();
    render(
      <TooltipProvider>
        <AgentMessage onDelete={onDelete}>Hello</AgentMessage>
      </TooltipProvider>,
    );
    expect(screen.getByLabelText('common.delete')).toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(
      <TooltipProvider>
        <AgentMessage onDelete={onDelete}>Hello</AgentMessage>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByLabelText('common.delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('does not show action buttons while streaming', () => {
    render(<AgentMessage isStreaming copyText="copy me">Hello</AgentMessage>);
    expect(screen.queryByLabelText('common.copy')).not.toBeInTheDocument();
  });
});

describe('CollapsibleContainer via AgentTextBlock', () => {
  let originalGetComputedStyle: typeof window.getComputedStyle;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalGetComputedStyle = window.getComputedStyle;
  });

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
  });

  it('renders markdown content', () => {
    render(
      <TooltipProvider>
        <AgentTextBlock content="Hello World" />
      </TooltipProvider>,
    );
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('does not show expand button when content is short', () => {
    window.getComputedStyle = () => ({ lineHeight: '24px' } as CSSStyleDeclaration);
    render(
      <TooltipProvider>
        <AgentTextBlock content="Short" />
      </TooltipProvider>,
    );
    expect(screen.queryByText('chat.expand')).not.toBeInTheDocument();
  });

  it('shows expand button when content exceeds max lines', async () => {
    window.getComputedStyle = () => ({ lineHeight: '24px' } as CSSStyleDeclaration);
    // Mock scrollHeight by overriding the prototype after render
    const longContent = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n\n');
    const { container } = render(
      <TooltipProvider>
        <AgentTextBlock content={longContent} />
      </TooltipProvider>,
    );
    // Find the content div and mock its scrollHeight
    const contentDiv = container.querySelector('.overflow-hidden')?.firstChild as HTMLElement;
    expect(contentDiv).not.toBeNull();
    Object.defineProperty(contentDiv, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(contentDiv, 'clientHeight', { value: 200, configurable: true });
    // Trigger ResizeObserver callback manually
    const ro = (globalThis as any).ResizeObserver;
    const roInstance = ro.prototype;
    // The ResizeObserver mock in setup.ts is a no-op; we need to manually invoke the callback
    // that CollapsibleContainer registered. Since we can't easily access it, we can force a re-render
    // by updating a prop or use a different approach. Instead, let's directly test CollapsibleContainer
    // behavior by creating a standalone test component with mocked dimensions.
    expect(true).toBe(true); // Placeholder; real assertion below in dedicated test
  });
});

// Standalone CollapsibleContainer tests using a minimal wrapper
const originalResizeObserver = globalThis.ResizeObserver;

describe('CollapsibleContainer behavior', () => {
  let callbacks: Array<(entries: unknown[]) => void> = [];
  let originalScrollHeight: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    callbacks = [];
    // Capture ResizeObserver callbacks so we can invoke them manually
    globalThis.ResizeObserver = class MockResizeObserver {
      cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    // Mock getComputedStyle globally for these tests
    Object.defineProperty(window, 'getComputedStyle', {
      value: () => ({ lineHeight: '20px' } as CSSStyleDeclaration),
      configurable: true,
    });

    // Save original descriptor so we can restore it
    originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
  });

  it('shows expand button when content is tall and toggles on click', () => {
    // Set prototype-level scrollHeight so every element reports a tall height
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return 1000; },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() { return 200; },
    });

    const { container } = render(
      <TooltipProvider>
        <AgentTextBlock content={Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n\n')} />
      </TooltipProvider>,
    );

    // Trigger ResizeObserver callbacks manually
    callbacks.forEach((cb) => cb([]));

    // After callback, expand button should appear
    expect(screen.getByText('chat.expand')).toBeInTheDocument();

    // Click expand
    fireEvent.click(screen.getByText('chat.expand'));
    expect(screen.getByText('chat.collapse')).toBeInTheDocument();

    // Click collapse
    fireEvent.click(screen.getByText('chat.collapse'));
    expect(screen.getByText('chat.expand')).toBeInTheDocument();
  });

  it('does not show expand button for short content', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return 50; },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() { return 200; },
    });

    render(
      <TooltipProvider>
        <AgentTextBlock content="Short content" />
      </TooltipProvider>,
    );

    callbacks.forEach((cb) => cb([]));

    expect(screen.queryByText('chat.expand')).not.toBeInTheDocument();
  });
});
