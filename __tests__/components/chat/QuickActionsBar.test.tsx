import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuickActionsBar, handleWheelOnElement } from '@/components/chat/QuickActionsBar';
import { useStorageItem } from '@/hooks/useStorageItem';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/hooks/useStorageItem');
vi.mock('@/lib/ai-config/scanner', () => ({ scanPrompts: vi.fn() }));
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

    // Click the disabled placeholder — toast.warning must fire.
    fireEvent.click(btn);
    expect(toast.warning).toHaveBeenCalled();
  });

  it('renders pills without SVG icons', async () => {
    vi.mocked(useStorageItem).mockReturnValue([['a.md'], vi.fn()]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([makePrompt('a.md', 'alpha')]);
    const { container } = render(<QuickActionsBar onTrigger={vi.fn()} />);
    await screen.findByRole('button', { name: /alpha/ });
    // No <svg> element inside any pill button — icons were removed.
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });

  it('uses scrollbar-none class to hide the scrollbar', async () => {
    vi.mocked(useStorageItem).mockReturnValue([['a.md'], vi.fn()]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([makePrompt('a.md', 'alpha')]);
    render(<QuickActionsBar onTrigger={vi.fn()} />);
    const bar = await screen.findByTestId('quick-actions-bar');
    expect(bar).toHaveClass('scrollbar-none');
  });

});

describe('handleWheelOnElement', () => {
  it('calls scrollBy with deltaY when there is overflow', () => {
    const el = document.createElement('div');
    vi.spyOn(el, 'scrollWidth', 'get').mockReturnValue(1000);
    vi.spyOn(el, 'clientWidth', 'get').mockReturnValue(200);
    const scrollBySpy = vi.fn();
    el.scrollBy = scrollBySpy;
    const event = new WheelEvent('wheel', { deltaY: 120 });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    handleWheelOnElement(el, event);
    expect(scrollBySpy).toHaveBeenCalledWith({ left: 120, behavior: 'auto' });
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('does nothing when there is no overflow', () => {
    const el = document.createElement('div');
    vi.spyOn(el, 'scrollWidth', 'get').mockReturnValue(200);
    vi.spyOn(el, 'clientWidth', 'get').mockReturnValue(200);
    const scrollBySpy = vi.fn();
    el.scrollBy = scrollBySpy;
    const event = new WheelEvent('wheel', { deltaY: 120 });
    handleWheelOnElement(el, event);
    expect(scrollBySpy).not.toHaveBeenCalled();
  });

  it('does nothing when el is null', () => {
    const event = new WheelEvent('wheel', { deltaY: 120 });
    // Should not throw.
    handleWheelOnElement(null, event);
  });
});
