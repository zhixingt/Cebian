import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { PromptsSection } from '@/components/settings/sections/PromptsSection';
import { useStorageItem } from '@/hooks/useStorageItem';
import type { SettingsOutletContext } from '@/components/settings/SettingsLayout';
import * as scanner from '@/lib/ai-config/scanner';

vi.mock('@/hooks/useStorageItem');
vi.mock('@/components/settings/sections/FileWorkspace', () => ({
  FileWorkspace: () => <div data-testid="file-workspace" />,
}));
vi.mock('@/lib/ai-config/scanner', () => ({
  scanPrompts: vi.fn(),
}));

const renderWithRouter = () =>
  render(
    <MemoryRouter initialEntries={['/settings/prompts']}>
      <Routes>
        <Route
          element={
            <Outlet
              context={
                { basePath: '/settings', breakpoint: 'standard' } as SettingsOutletContext
              }
            />
          }
        >
          <Route path="/settings/prompts" element={<PromptsSection />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('PromptsSection', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders the FavoritesList area when there are favorites', async () => {
    vi.mocked(useStorageItem).mockReturnValue([['a.md'], vi.fn()]);
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([
      { fileName: 'a.md', name: 'alpha', description: '', filePath: '/prompts/a.md' },
    ]);
    renderWithRouter();
    expect(await screen.findByTestId('favorites-list')).toBeInTheDocument();
    expect(screen.getByTestId('file-workspace')).toBeInTheDocument();
  });

  it('does not render the FavoritesList area when favorites is empty', () => {
    vi.mocked(useStorageItem).mockReturnValue([[], vi.fn()]);
    renderWithRouter();
    expect(screen.queryByTestId('favorites-list')).toBeNull();
    expect(screen.getByTestId('file-workspace')).toBeInTheDocument();
  });
});
