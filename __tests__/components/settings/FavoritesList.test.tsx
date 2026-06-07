import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FavoritesList } from '@/components/settings/sections/FavoritesList';
import { useStorageItem } from '@/hooks/useStorageItem';

vi.mock('@/hooks/useStorageItem');
vi.mock('@/lib/ai-config/scanner', () => ({
  scanPrompts: vi.fn(),
}));
import * as scanner from '@/lib/ai-config/scanner';

const makePrompt = (fileName: string, name = fileName.replace('.md', '')) => ({
  fileName,
  name,
  description: '',
  filePath: `/prompts/${fileName}`,
});

describe('FavoritesList', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when favorites is empty', () => {
    vi.mocked(useStorageItem).mockReturnValue([[], vi.fn()]);
    const { container } = render(<FavoritesList />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per favorite in order', async () => {
    const setValue = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useStorageItem).mockReturnValue([['a.md', 'b.md'], setValue]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([
      makePrompt('a.md', 'alpha'),
      makePrompt('b.md', 'beta'),
    ]);

    render(<FavoritesList />);
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(await screen.findByText('beta')).toBeInTheDocument();

    const rows = screen.getAllByTestId(/^favorite-row-/);
    expect(rows[0]).toHaveTextContent('alpha');
    expect(rows[1]).toHaveTextContent('beta');
  });

  it('removes a favorite when the X button is clicked', async () => {
    const setValue = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useStorageItem).mockReturnValue([['a.md', 'b.md'], setValue]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([
      makePrompt('a.md', 'alpha'),
      makePrompt('b.md', 'beta'),
    ]);

    render(<FavoritesList />);
    const removeButtons = await screen.findAllByRole('button', { name: /remove/i });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(setValue).toHaveBeenCalledWith(['b.md']);
    });
  });

  it('shows a placeholder row for a broken favorite (file deleted)', async () => {
    const setValue = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useStorageItem).mockReturnValue([['missing.md'], setValue]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([]);

    render(<FavoritesList />);
    expect(await screen.findByText('missing.md')).toBeInTheDocument();
    // Broken row: no friendly name, just the filename shown muted.
  });
});
