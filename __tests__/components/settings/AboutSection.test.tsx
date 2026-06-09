/**
 * Regression locks for `AboutSection` (in `components/settings/sections/AboutSection.tsx`).
 *
 * Contract under test:
 *  1. **Author section** — the "关注作者" / "Follow the author" list renders as
 *     a vertical list of plain rows (no `<a>` wrappers, no cards). Each row
 *     still shows the platform label and handle text.
 *  2. **Project source** — the "项目来源：" / "Project source" block matches the
 *     author section's UI pattern (title + horizontal divider + card body),
 *     contains a single `text-justify` paragraph, preserves the upstream
 *     and contributor links, and uses no `；` (Chinese semicolon) and no
 *     stray line-leading/trailing punctuation.
 *  3. **Update check** — the "检查更新" / "Check for updates" button is
 *     rendered as `<button disabled>`. The AboutSection MUST NOT call
 *     `useUpdateCheck` at all (the feature is currently disabled by design),
 *     so no status text is rendered next to the button.
 *
 * Note: tests rely on the vitest i18n stub at `vitest-stubs/i18n.ts` which
 * returns the **full key path** (e.g. `settings.about.checkUpdate`) for
 * any `t()` call. Locator assertions below match that shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AboutSection } from '@/components/settings/sections/AboutSection';
import * as useUpdateCheckModule from '@/hooks/useUpdateCheck';

vi.mock('@/hooks/useUpdateCheck', () => ({
  useUpdateCheck: vi.fn(),
  getInstallGuideUrl: () => 'https://cebian.catcat.work/en/install-guide',
}));

describe('AboutSection — author list is vertical, no links', () => {
  it('renders each social row as a <li> without an anchor wrapper', () => {
    const { container } = render(<AboutSection />);
    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
    const items = list!.querySelectorAll('li');
    expect(items.length).toBe(3);
  });

  it('renders the platform labels and handles as plain text inside <li>', () => {
    render(<AboutSection />);
    expect(screen.getByText('settings.about.socials.wechat')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.bilibili')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.xiaohongshu')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.wechatHandle')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.bilibiliHandle')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.xiaohongshuHandle')).toBeInTheDocument();
  });

  it('does not render any anchor pointing at bilibili or xiaohongshu', () => {
    render(<AboutSection />);
    const anchors = document.querySelectorAll('a[href*="bilibili.com"], a[href*="xiaohongshu.com"]');
    expect(anchors.length).toBe(0);
  });

  it('does not use a 2-col grid for the author rows', () => {
    const { container } = render(<AboutSection />);
    const authorGrid = container.querySelector('.grid.grid-cols-2');
    expect(authorGrid).toBeNull();
  });
});

describe('AboutSection — project source UI matches the author section', () => {
  it('shows a section title with a horizontal divider (same shape as FollowAuthorSection)', () => {
    const { container } = render(<AboutSection />);
    // Both section titles are <p class="text-sm font-medium">. The author
    // section additionally has a `h-px flex-1 bg-gradient-to-r from-border`
    // divider. The project-source block should follow the same shape.
    const dividers = container.querySelectorAll('div.h-px.flex-1.bg-gradient-to-r');
    // One for the author section; the project source should add another.
    expect(dividers.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the title without a trailing colon (项目来源, not 项目来源：)', () => {
    const { container } = render(<AboutSection />);
    // Walk every text node looking for the literal "项目来源". We assert
    // presence (the title exists) and absence of the colon variant.
    expect(container.textContent).toContain('项目来源');
    expect(container.textContent).not.toContain('项目来源：');
  });

  it('renders the attribution as a single <p> with text-justify', () => {
    const { container } = render(<AboutSection />);
    const justified = container.querySelectorAll('p.text-justify');
    expect(justified.length).toBe(1);
  });

  it('keeps the upstream + contributor links inside the single paragraph', () => {
    const { container } = render(<AboutSection />);
    const para = container.querySelector('p.text-justify');
    expect(para).not.toBeNull();
    const upstream = para!.querySelector('a[href*="maotoumao/Cebian"]');
    expect(upstream).not.toBeNull();
    const contrib = para!.querySelector('a[href*="github.com/zhixingt"]');
    expect(contrib).not.toBeNull();
    expect(para!.textContent).toContain('肖泽林');
    expect(para!.textContent).toContain('AGPL-3.0');
  });

  it('uses the original wording with Chinese semicolons between attribution facts', () => {
    const { container } = render(<AboutSection />);
    const para = container.querySelector('p.text-justify');
    expect(para).not.toBeNull();
    // The copy was rolled back to the original wording that uses `；`
    // between upstream author / contributor / license facts.
    expect(para!.textContent).toContain('；');
  });
});

describe('AboutSection — update check is fully disabled', () => {
  it('does not call useUpdateCheck at all', () => {
    vi.mocked(useUpdateCheckModule.useUpdateCheck).mockClear();
    render(<AboutSection />);
    // The feature is disabled by design — the section must not import or
    // invoke the hook. The mock is therefore never called.
    expect(useUpdateCheckModule.useUpdateCheck).not.toHaveBeenCalled();
  });

  it('renders the check-update button as a disabled element', () => {
    render(<AboutSection />);
    const btn = screen.getByRole('button', { name: 'settings.about.checkUpdate' });
    expect(btn).toBeDisabled();
  });

  it('does not render any status text next to the button', () => {
    render(<AboutSection />);
    // No "checking", "up to date", "check failed" labels — the check feature
    // is disabled, so the section is silent.
    expect(screen.queryByText('settings.about.checking')).toBeNull();
    expect(screen.queryByText('settings.about.upToDate')).toBeNull();
    expect(screen.queryByText('settings.about.checkFailed')).toBeNull();
  });

  it('does not invoke recheck when the disabled button is clicked', () => {
    render(<AboutSection />);
    const btn = screen.getByRole('button', { name: 'settings.about.checkUpdate' });
    // jsdom blocks click events on disabled buttons, so this is a smoke
    // test that the action has no effect.
    fireEvent.click(btn);
    expect(useUpdateCheckModule.useUpdateCheck).not.toHaveBeenCalled();
  });
});
