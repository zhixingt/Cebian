/**
 * Regression lock for `ToolCard` (in `components/chat/ToolCard.tsx`).
 *
 * Contract under test:
 *  - The card is **collapsed by default** — only the header (label + status
 *    icon + chevron) is rendered. The args/result body must NOT be in the
 *    DOM until the user clicks.
 *  - Clicking the header toggles the body open/closed.
 *  - The status icon reflects the `status` prop (running / done / error).
 *
 * The body uses a conditional render (`{open && ...}`), so a closed state
 * is verifiable by absence-of-element rather than a className check.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCard } from '@/components/chat/ToolCard';

// Stable references the assertions can match against.
const ARGS = 'ls -la /tmp';
const RESULT = 'file1\nfile2\nfile3';

describe('ToolCard — default-collapsed behavior', () => {
  it('does not render args or result body on first mount', () => {
    render(<ToolCard label="shell" status="done" args={ARGS} result={RESULT} />);
    expect(screen.queryByText(ARGS)).toBeNull();
    expect(screen.queryByText(RESULT)).toBeNull();
  });

  it('does not render the chevron in the rotated (open) state by default', () => {
    render(<ToolCard label="shell" status="done" args={ARGS} result={RESULT} />);
    const chevron = document.querySelector('svg.lucide-chevron-right');
    expect(chevron).not.toBeNull();
    expect(chevron?.className.baseVal ?? chevron?.getAttribute('class') ?? '').not.toMatch(/rotate-90/);
  });

  it('clicking the header reveals args and result', () => {
    render(<ToolCard label="shell" status="done" args={ARGS} result={RESULT} />);
    fireEvent.click(screen.getByRole('button'));
    // jsdom normalizes whitespace in text nodes, so use a regex matcher
    // that tolerates \n → space collapsing inside <pre> elements.
    expect(screen.getByText((_, el) => el?.tagName === 'CODE' && el.textContent === ARGS)).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'CODE' && el.textContent === RESULT)).toBeInTheDocument();
  });

  it('clicking the header a second time collapses again', () => {
    render(<ToolCard label="shell" status="done" args={ARGS} result={RESULT} />);
    const header = screen.getByRole('button');
    fireEvent.click(header);
    expect(screen.getByText((_, el) => el?.tagName === 'CODE' && el.textContent === ARGS)).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByText((_, el) => el?.tagName === 'CODE' && el.textContent === ARGS)).toBeNull();
  });
});

describe('ToolCard — status icon', () => {
  it('renders the spinner icon for status=running', () => {
    render(<ToolCard label="x" status="running" args="a" />);
    expect(document.querySelector('svg.lucide-loader-circle')).not.toBeNull();
  });

  it('renders the check icon for status=done', () => {
    render(<ToolCard label="x" status="done" args="a" />);
    expect(document.querySelector('svg.lucide-check')).not.toBeNull();
  });

  it('renders the x icon for status=error', () => {
    render(<ToolCard label="x" status="error" args="a" />);
    expect(document.querySelector('svg.lucide-x')).not.toBeNull();
  });
});
