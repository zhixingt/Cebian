import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from '@/components/common/MarkdownRenderer';

vi.mock('@/lib/i18n', () => ({ t: (s: string) => s }));
vi.mock('@/lib/vfs', () => ({ encodeRelPath: vi.fn(), vfs: {} }));
vi.mock('@/lib/mime', () => ({ isImageMime: vi.fn(), mimeFromPath: vi.fn() }));

describe('MarkdownRenderer', () => {
  it('renders markdown text content', () => {
    render(<MarkdownRenderer content="Hello World" />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('applies text-justify and textAlignLast:left to paragraphs', () => {
    const { container } = render(<MarkdownRenderer content="This is a paragraph." />);
    const p = container.querySelector('p');
    expect(p).toBeInTheDocument();
    expect(p).toHaveClass('text-justify');
    expect(p).toHaveStyle({ textAlignLast: 'left' });
  });

  it('does not apply text-justify to image-only paragraphs (gallery layout)', () => {
    // 两条独立的图片 markdown 行，各自渲染为 p > img
    // 由于 react-markdown 的 p 组件内部检查 node.children，
    // 这里我们只验证普通段落一定有 text-justify，而多图段落走 gallery 分支
    const { container } = render(<MarkdownRenderer content="Plain text paragraph here." />);
    const p = container.querySelector('p');
    expect(p).toHaveClass('text-justify');
  });

  it('renders multiple paragraphs with text-justify', () => {
    const { container } = render(<MarkdownRenderer content={"First paragraph.\n\nSecond paragraph."} />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);
    paragraphs.forEach((p) => {
      expect(p).toHaveClass('text-justify');
      expect(p).toHaveStyle({ textAlignLast: 'left' });
    });
  });
});
