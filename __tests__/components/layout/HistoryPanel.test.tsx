import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { HistoryPanel } from '@/components/layout/HistoryPanel';

vi.mock('@/lib/i18n', () => ({ t: (s: string, ...args: unknown[]) => {
  if (s === 'common.session.messageCount') {
    const n = args[0] as number;
    return `${n} messages`;
  }
  if (s === 'common.time.minutesAgo') return `${args[0]} min ago`;
  return s;
} }));

vi.mock('@/lib/dialog', () => ({ showConfirm: vi.fn(() => Promise.resolve(true)) }));

const makeSession = (id: string, title: string, model: string, messageCount = 1, isRunning = false): {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  isRunning: boolean;
  updatedAt: number;
} => ({
  id,
  title,
  model,
  messageCount,
  isRunning,
  updatedAt: Date.now() - 60000,
});

describe('HistoryPanel', () => {
  let messageListener: ((msg: unknown) => void) | null = null;
  const mockPort = {
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((cb: (msg: unknown) => void) => { messageListener = cb; }),
      removeListener: vi.fn(() => { messageListener = null; }),
    },
    disconnect: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    messageListener = null;
    vi.stubGlobal('chrome', {
      runtime: {
        connect: vi.fn(() => mockPort),
      },
    });
  });

  it('renders search input', () => {
    render(<HistoryPanel open onClose={vi.fn()} onSelectSession={vi.fn()} />);
    expect(screen.getByPlaceholderText('common.searchPlaceholder')).toBeInTheDocument();
  });

  it('filters sessions by title when typing in search box', async () => {
    render(<HistoryPanel open onClose={vi.fn()} onSelectSession={vi.fn()} />);

    // Simulate session list response from background
    const sessions = [
      makeSession('1', 'Alpha Chat', 'gpt-4'),
      makeSession('2', 'Beta Discussion', 'claude-3'),
      makeSession('3', 'Gamma Notes', 'gpt-3.5'),
    ];
    await waitFor(() => expect(messageListener).not.toBeNull());
    act(() => { messageListener!({ type: 'session_list_result', sessions }); });

    expect(screen.getByText('Alpha Chat')).toBeInTheDocument();
    expect(screen.getByText('Beta Discussion')).toBeInTheDocument();
    expect(screen.getByText('Gamma Notes')).toBeInTheDocument();

    // Type in search box
    const searchInput = screen.getByPlaceholderText('common.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'alpha' } });

    expect(screen.getByText('Alpha Chat')).toBeInTheDocument();
    expect(screen.queryByText('Beta Discussion')).not.toBeInTheDocument();
    expect(screen.queryByText('Gamma Notes')).not.toBeInTheDocument();
  });

  it('filters sessions by model name when typing in search box', async () => {
    render(<HistoryPanel open onClose={vi.fn()} onSelectSession={vi.fn()} />);

    const sessions = [
      makeSession('1', 'Alpha Chat', 'gpt-4'),
      makeSession('2', 'Beta Discussion', 'claude-3'),
    ];
    await waitFor(() => expect(messageListener).not.toBeNull());
    act(() => { messageListener!({ type: 'session_list_result', sessions }); });

    const searchInput = screen.getByPlaceholderText('common.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'claude' } });

    expect(screen.queryByText('Alpha Chat')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Discussion')).toBeInTheDocument();
  });

  it('shows clear button when search query is not empty', async () => {
    render(<HistoryPanel open onClose={vi.fn()} onSelectSession={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('common.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'test' } });

    const clearBtn = screen.getByLabelText('common.cancel');
    expect(clearBtn).toBeInTheDocument();
  });

  it('clears search query when clear button is clicked', async () => {
    render(<HistoryPanel open onClose={vi.fn()} onSelectSession={vi.fn()} />);

    const sessions = [
      makeSession('1', 'Alpha Chat', 'gpt-4'),
      makeSession('2', 'Beta Discussion', 'claude-3'),
    ];
    await waitFor(() => expect(messageListener).not.toBeNull());
    act(() => { messageListener!({ type: 'session_list_result', sessions }); });

    const searchInput = screen.getByPlaceholderText('common.searchPlaceholder') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'alpha' } });
    expect(searchInput.value).toBe('alpha');

    const clearBtn = screen.getByLabelText('common.cancel');
    fireEvent.click(clearBtn);

    expect(searchInput.value).toBe('');
  });

  it('shows empty state when no sessions match search', async () => {
    render(<HistoryPanel open onClose={vi.fn()} onSelectSession={vi.fn()} />);

    const sessions = [makeSession('1', 'Alpha Chat', 'gpt-4')];
    await waitFor(() => expect(messageListener).not.toBeNull());
    act(() => { messageListener!({ type: 'session_list_result', sessions }); });

    const searchInput = screen.getByPlaceholderText('common.searchPlaceholder');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.getByText('common.noMatch')).toBeInTheDocument();
  });

  it('calls onSelectSession when a session row is clicked', async () => {
    const onSelectSession = vi.fn();
    render(<HistoryPanel open onClose={vi.fn()} onSelectSession={onSelectSession} />);

    const sessions = [makeSession('1', 'Alpha Chat', 'gpt-4')];
    await waitFor(() => expect(messageListener).not.toBeNull());
    act(() => { messageListener!({ type: 'session_list_result', sessions }); });

    fireEvent.click(screen.getByText('Alpha Chat'));
    expect(onSelectSession).toHaveBeenCalledWith('1');
  });

  it('calls onClose when back button is clicked', () => {
    const onClose = vi.fn();
    render(<HistoryPanel open onClose={onClose} onSelectSession={vi.fn()} />);

    const backButton = screen.getByLabelText('common.back');
    fireEvent.click(backButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets search query when panel closes', async () => {
    const { rerender } = render(<HistoryPanel open onClose={vi.fn()} onSelectSession={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('common.searchPlaceholder') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'test' } });
    expect(searchInput.value).toBe('test');

    rerender(<HistoryPanel open={false} onClose={vi.fn()} onSelectSession={vi.fn()} />);
    rerender(<HistoryPanel open onClose={vi.fn()} onSelectSession={vi.fn()} />);

    expect(searchInput.value).toBe('');
  });
});
