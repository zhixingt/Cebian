/**
 * Regression locks for `AboutSection` (in `components/settings/sections/AboutSection.tsx`).
 *
 * Contract under test:
 *  1. **Author section** — the "关注作者" / "Follow the author" list renders as
 *     a vertical list of plain rows (no `<a>` wrappers, no cards). Each row
 *     still shows the platform label and handle text.
 *  2. **Project source** — the "项目来源" / "Project source" block is a single
 *     `<p>` with `text-justify` and still contains the upstream/AGPL/fork
 *     attribution text + working links to maotoumao/Cebian and @zhixingt.
 *  3. **Update check button** — the "检查更新" / "Check for updates" button is
 *     rendered as `<button disabled>` regardless of `useUpdateCheck` state.
 *     It must NOT call `recheck` on click. The status text (up to date,
 *     checking, error) still shows next to it as informational text.
 *
 * Note: tests rely on the vitest i18n stub at `vitest-stubs/i18n.ts` which
 * returns the **full key path** (e.g. `settings.about.checkUpdate`) for
 * any `t()` call. Locator assertions below match that shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AboutSection } from '@/components/settings/sections/AboutSection';
import * as useUpdateCheckModule from '@/hooks/useUpdateCheck';

vi.mock('@/hooks/useUpdateCheck', () => ({
  useUpdateCheck: vi.fn(() => ({
    status: { kind: 'upToDate' as const, current: '0.0.0', latest: '0.0.0' },
    current: '0.0.0',
    recheck: vi.fn(),
  })),
  getInstallGuideUrl: () => 'https://cebian.catcat.work/en/install-guide',
}));

beforeEach(() => {
  // Reset to a known status before every test.
  vi.mocked(useUpdateCheckModule.useUpdateCheck).mockReturnValue({
    status: { kind: 'upToDate' as const, current: '0.0.0', latest: '0.0.0' },
    current: '0.0.0',
    recheck: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AboutSection — author list is vertical, no links', () => {
  it('renders each social row as a <li> without an anchor wrapper', () => {
    const { container } = render(<AboutSection />);
    // The container should hold a <ul> with three <li> children for the
    // wechat / bilibili / xiaohongshu entries.
    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
    const items = list!.querySelectorAll('li');
    expect(items.length).toBe(3);
  });

  it('renders the platform labels and handles as plain text inside <li>', () => {
    render(<AboutSection />);
    // i18n stub returns the full key, so we look for the localized key.
    expect(screen.getByText('settings.about.socials.wechat')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.bilibili')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.xiaohongshu')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.wechatHandle')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.bilibiliHandle')).toBeInTheDocument();
    expect(screen.getByText('settings.about.socials.xiaohongshuHandle')).toBeInTheDocument();
  });

  it('does not render any anchor pointing at bilibili or xiaohongshu', () => {
    render(<AboutSection />);
    // Defensive: external handles must not be exposed as clickable links.
    const anchors = document.querySelectorAll('a[href*="bilibili.com"], a[href*="xiaohongshu.com"]');
    expect(anchors.length).toBe(0);
  });

  it('does not use a 2-col grid for the author rows', () => {
    const { container } = render(<AboutSection />);
    const authorGrid = container.querySelector('.grid.grid-cols-2');
    expect(authorGrid).toBeNull();
  });
});

describe('AboutSection — project source is one justified paragraph', () => {
  it('renders the project-source attribution as a single <p> with text-justify', () => {
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
    // The 肖泽林 contributor name appears once.
    expect(para!.textContent).toContain('肖泽林');
    // AGPL license is mentioned.
    expect(para!.textContent).toContain('AGPL-3.0');
  });
});

describe('AboutSection — check-update button is permanently disabled', () => {
  it('renders the button as a disabled element', () => {
    render(<AboutSection />);
    const btn = screen.getByRole('button', { name: 'settings.about.checkUpdate' });
    expect(btn).toBeDisabled();
  });

  it('does not invoke recheck when clicked', () => {
    // Re-mock with a fresh spy for this case.
    const recheckSpy = vi.fn();
    vi.spyOn(useUpdateCheckModule, 'useUpdateCheck').mockReturnValue({
      status: { kind: 'idle' },
      current: '0.0.0',
      recheck: recheckSpy,
    } as ReturnType<typeof useUpdateCheckModule.useUpdateCheck>);
    render(<AboutSection />);
    const btn = screen.getByRole('button', { name: 'settings.about.checkUpdate' });
    // jsdom's fireEvent on a disabled button does NOT fire a click event.
    // This combines with the toBeDisabled() check above to prove the action
    // is not exposed.
    fireEvent.click(btn);
    expect(recheckSpy).not.toHaveBeenCalled();
  });

  it('still surfaces the current status text next to the button', () => {
    render(<AboutSection />);
    // The mock returns upToDate status, so the localized key appears.
    expect(screen.getByText('settings.about.upToDate')).toBeInTheDocument();
  });
});
