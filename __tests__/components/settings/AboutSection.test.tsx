/**
 * Regression locks for `AboutSection` (in `components/settings/sections/AboutSection.tsx`).
 *
 * Contract under test:
 *  1. **Version card** — renders version number and tagline in a rounded card.
 *  2. **Quick links** — GitHub / Feedback / License as pill-style buttons.
 *  3. **Project source** — the "项目说明" block follows the same
 *     `SectionHeader + card body` shape as the "检查更新" block: title row
 *     with a horizontal divider, then a card containing 4 paragraphs
 *     (Forked from / 关注作者 / Maintainer / License) with the upstream
 *     and contributor links preserved.
 *  4. **Update check** — shows "已是最新版本" status text alongside a
 *     disabled button. The AboutSection MUST NOT call `useUpdateCheck` at all.
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

describe('AboutSection — version card', () => {
  it('renders version number in a card', () => {
    const { container } = render(<AboutSection />);
    expect(container.textContent).toContain('CebianX v');
  });

  it('renders tagline below version', () => {
    const { container } = render(<AboutSection />);
    expect(container.textContent).toContain('settings.about.tagline');
  });
});

describe('AboutSection — quick links', () => {
  it('renders GitHub link as a pill button', () => {
    const { container } = render(<AboutSection />);
    const githubLink = container.querySelector('a[href*="maotoumao/Cebian"]');
    expect(githubLink).not.toBeNull();
    expect(githubLink!.textContent).toContain('GitHub');
  });

  it('renders feedback (issues) link', () => {
    const { container } = render(<AboutSection />);
    const feedbackLink = container.querySelector('a[href*="github.com/maotoumao/Cebian/issues"]');
    expect(feedbackLink).not.toBeNull();
    expect(feedbackLink!.textContent).toContain('settings.about.feedback');
  });

  it('renders license link', () => {
    const { container } = render(<AboutSection />);
    const licenseLink = container.querySelector('a[href*="LICENSE"]');
    expect(licenseLink).not.toBeNull();
    expect(licenseLink!.textContent).toContain('AGPL-3.0');
  });
});

describe('AboutSection — project source UI matches the check-update section', () => {
  it('shows a section title with a horizontal divider for both check-update and project source', () => {
    const { container } = render(<AboutSection />);
    // Each section using SectionHeader contributes one `h-px flex-1 bg-gradient-to-r`
    // divider. We expect: 1 for 检查更新 + 1 for 项目说明 = 2.
    const dividers = container.querySelectorAll('div.h-px.flex-1.bg-gradient-to-r');
    expect(dividers.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the title as settings.about.projectDesc (no colon)', () => {
    const { container } = render(<AboutSection />);
    expect(container.textContent).toContain('settings.about.projectDesc');
  });

  it('renders four separate <p> lines in the project description card', () => {
    const { container } = render(<AboutSection />);
    // The card body is a div with space-y-2 containing four <p> elements:
    //   1. Forked from: maotoumao/Cebian
    //   2. 关注作者：微信公众号（一只猫头猫）
    //   3. Maintainer: 肖泽林 (@zhixingt)
    //   4. License: AGPL-3.0 (Inherited from upstream)
    const card = container.querySelector('.space-y-2:last-of-type') ?? container.querySelector('.space-y-2');
    expect(card).not.toBeNull();
    const paragraphs = card!.querySelectorAll('p');
    expect(paragraphs.length).toBe(4);
  });

  it('keeps the upstream + contributor links in the card body', () => {
    const { container } = render(<AboutSection />);
    const card = container.querySelector('.space-y-2:last-of-type') ?? container.querySelector('.space-y-2');
    expect(card).not.toBeNull();
    const upstream = card!.querySelector('a[href*="maotoumao/Cebian"]');
    expect(upstream).not.toBeNull();
    const contrib = card!.querySelector('a[href*="github.com/zhixingt"]');
    expect(contrib).not.toBeNull();
    expect(card!.textContent).toContain('肖泽林');
    expect(card!.textContent).toContain('AGPL-3.0');
  });

  it('renders the author follow line directly under Forked from', () => {
    const { container } = render(<AboutSection />);
    const card = container.querySelector('.space-y-2:last-of-type') ?? container.querySelector('.space-y-2');
    expect(card).not.toBeNull();
    const paragraphs = Array.from(card!.querySelectorAll('p'));
    // settings.about.followAuthor line must come immediately after the Forked from line.
    const forkedIdx = paragraphs.findIndex(
      (p) => p.textContent?.startsWith('Forked from:') ?? false,
    );
    const followIdx = paragraphs.findIndex(
      (p) => p.textContent?.includes('settings.about.followAuthor') ?? false,
    );
    expect(forkedIdx).toBeGreaterThanOrEqual(0);
    expect(followIdx).toBe(forkedIdx + 1);
  });

  it('uses the English Forked-from / Maintainer / License copy', () => {
    const { container } = render(<AboutSection />);
    const card = container.querySelector('.space-y-2:last-of-type') ?? container.querySelector('.space-y-2');
    expect(card).not.toBeNull();
    const text = card!.textContent ?? '';
    expect(text).toContain('Forked from:');
    expect(text).toContain('Maintainer:');
    expect(text).toContain('License:');
    expect(text).toContain('Inherited from upstream');
  });
});

describe('AboutSection — update check is fully disabled', () => {
  it('does not call useUpdateCheck at all', () => {
    vi.mocked(useUpdateCheckModule.useUpdateCheck).mockClear();
    render(<AboutSection />);
    expect(useUpdateCheckModule.useUpdateCheck).not.toHaveBeenCalled();
  });

  it('renders the check-update button as a disabled element', () => {
    render(<AboutSection />);
    const btn = screen.getByRole('button', { name: 'settings.about.checkUpdate' });
    expect(btn).toBeDisabled();
  });

  it('shows upToDate status text in the update section', () => {
    render(<AboutSection />);
    // The update section now displays "已是最新版本" alongside the disabled button
    expect(screen.getByText('settings.about.upToDate')).toBeInTheDocument();
  });

  it('does not render checking or failed status text', () => {
    render(<AboutSection />);
    expect(screen.queryByText('settings.about.checking')).toBeNull();
    expect(screen.queryByText('settings.about.checkFailed')).toBeNull();
  });

  it('does not invoke recheck when the disabled button is clicked', () => {
    render(<AboutSection />);
    const btn = screen.getByRole('button', { name: 'settings.about.checkUpdate' });
    fireEvent.click(btn);
    expect(useUpdateCheckModule.useUpdateCheck).not.toHaveBeenCalled();
  });
});
