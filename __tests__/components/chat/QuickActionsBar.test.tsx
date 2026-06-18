import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QuickActionsBar } from '@/components/chat/QuickActionsBar';
import { useStorageItem } from '@/hooks/useStorageItem';
import { toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/hooks/useStorageItem');
vi.mock('@/lib/ai-config/scanner', () => ({ scanPrompts: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ t: (s: string) => s }));
import * as scanner from '@/lib/ai-config/scanner';

const makePrompt = (fileName: string, name = fileName.replace('.md', '')) => ({
  fileName,
  name,
  description: '',
  filePath: `/prompts/${fileName}`,
});

describe('QuickActionsBar', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders nothing when favorites is empty', () => {
    vi.mocked(useStorageItem).mockReturnValue([[], vi.fn()]);
    const { container } = render(<QuickActionsBar onTrigger={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one button per favorite in order', async () => {
    vi.mocked(useStorageItem).mockReturnValue([['a.md', 'b.md'], vi.fn()]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([
      makePrompt('a.md', 'alpha'),
      makePrompt('b.md', 'beta'),
    ]);
    render(<QuickActionsBar onTrigger={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /alpha/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /beta/ })).toBeInTheDocument();
  });

  it('calls onTrigger with the resolved PromptMeta when a button is clicked', async () => {
    vi.mocked(useStorageItem).mockReturnValue([['a.md'], vi.fn()]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([makePrompt('a.md', 'alpha')]);
    const onTrigger = vi.fn();
    render(<QuickActionsBar onTrigger={onTrigger} />);
    fireEvent.click(await screen.findByRole('button', { name: /alpha/ }));
    await waitFor(() => expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'a.md' })));
  });

  it('renders a disabled placeholder for a broken favorite and shows a toast on click', async () => {
    vi.mocked(useStorageItem).mockReturnValue([['missing.md'], vi.fn()]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([]);
    const onTrigger = vi.fn();
    render(<QuickActionsBar onTrigger={onTrigger} />);
    const btn = await screen.findByRole('button', { name: /missing\.md/ });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveClass('opacity-60');

    fireEvent.click(btn);
    expect(toast.warning).toHaveBeenCalled();
  });

  it('renders pills without SVG icons inside pill text', async () => {
    vi.mocked(useStorageItem).mockReturnValue([['a.md'], vi.fn()]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([makePrompt('a.md', 'alpha')]);
    render(<QuickActionsBar onTrigger={vi.fn()} />);
    await screen.findByRole('button', { name: /alpha/ });
    // Pill buttons should contain text spans, not SVG icons in the text area
    const bar = await screen.findByTestId('quick-actions-bar');
    expect(bar.querySelectorAll('span')).toHaveLength(1);
  });

  it('uses scrollbar-none class to hide the scrollbar', async () => {
    vi.mocked(useStorageItem).mockReturnValue([['a.md'], vi.fn()]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([makePrompt('a.md', 'alpha')]);
    render(<QuickActionsBar onTrigger={vi.fn()} />);
    const bar = await screen.findByTestId('quick-actions-bar');
    const scrollContainer = bar.querySelector('.scrollbar-none');
    expect(scrollContainer).not.toBeNull();
  });
});
