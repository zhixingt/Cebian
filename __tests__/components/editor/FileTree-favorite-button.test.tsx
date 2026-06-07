import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileTree } from '@/components/editor/FileTree';

// jsdom doesn't ship ResizeObserver; FileTree uses it for the container size.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverMock;

// react-arborist requires real DOM; we mock it just enough to render rows.
vi.mock('react-arborist', () => ({
  Tree: ({ children }: { children: (props: { node: { data: unknown }; style: unknown; handle: unknown; tree: { containerProps: () => unknown } }) => React.ReactNode }) => (
    <div data-testid="tree">{typeof children === 'function' ? children({
      node: { data: { id: 'a.md', name: 'a.md', isDir: false, path: '/prompts/a.md' } },
      style: {},
      handle: {},
      tree: { containerProps: () => ({}) },
    }) : null}</div>
  ),
}));

describe('FileTree favorite button', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('does NOT show a star button by default', () => {
    render(<FileTree root="/prompts" />);
    expect(screen.queryByRole('button', { name: /favorite/i })).toBeNull();
  });

  it('shows a star button when showFavoriteButton is true', () => {
    render(<FileTree root="/prompts" showFavoriteButton />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('invokes onToggleFavorite with (fileName, willFavorite=true) when star is clicked on a non-favorite', () => {
    const onToggle = vi.fn();
    render(
      <FileTree
        root="/prompts"
        showFavoriteButton
        onToggleFavorite={onToggle}
        isFavorite={(f) => f === 'b.md'}
      />,
    );
    const stars = screen.getAllByRole('button', { name: /favorite|unfavorite|star/i });
    fireEvent.click(stars[0]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('a.md', true);
  });
});
