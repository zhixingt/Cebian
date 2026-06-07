import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebProviderCard } from '@/components/settings/provider/WebProviderCard';
import type { WebProvider } from '@/lib/types';
import type { WebProviderPreset } from '@/lib/ai-config/web-provider-presets';
import { GLM_DOM_STRATEGY } from '@/lib/ai-config/web-provider-dom-strategy';

const fakeProvider: WebProvider = {
  presetId: 'glm',
  enabled: true,
  loginStatus: 'unknown',
  modelId: 'GLM-4.6',
  supportsToolCalls: true,
  supportsReasoning: false,
  lastCheckedAt: null,
  encryptedCookieBundle: null,
  userOverrides: null,
  loginAuditLog: [],
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
};

const fakePreset: WebProviderPreset = {
  id: 'glm',
  displayNameKey: 'webProviders.presets.glm.name',
  descriptionKey: 'webProviders.presets.glm.description',
  loginUrl: 'https://chatglm.cn',
  defaultModelId: 'GLM-4.6',
  defaultSupportsToolCalls: true,
  defaultSupportsReasoning: false,
  cookieDomain: 'chatglm.cn',
  sessionIndicators: ['chatglm_refresh_token', 'chatglm_token'],
  useLocalStorageFallback: false,
  refreshUrl: 'https://chatglm.cn/api/v1/auth/refresh',
  domStrategy: GLM_DOM_STRATEGY,
};

function renderCard(overrides: Partial<{
  provider: WebProvider;
  preset: WebProviderPreset;
  onEnabledChange: () => void;
  onModelIdChange: (v: string) => void;
  onCapabilityChange: (cap: string, v: boolean) => void;
  onRecheck: () => void;
  onLogin: () => void;
  onLogout: () => void;
  isLoginLoading: boolean;
}> = {}) {
  return render(
    <WebProviderCard
      provider={overrides.provider ?? fakeProvider}
      preset={overrides.preset ?? fakePreset}
      isChecking={false}
      onEnabledChange={overrides.onEnabledChange ?? vi.fn()}
      onModelIdChange={overrides.onModelIdChange ?? vi.fn()}
      onCapabilityChange={overrides.onCapabilityChange ?? vi.fn()}
      onRecheck={overrides.onRecheck ?? vi.fn()}
      onLogin={overrides.onLogin}
      onLogout={overrides.onLogout}
      isLoginLoading={overrides.isLoginLoading}
    />,
  );
}

describe('WebProviderCard (2026-06-08 UI redesign)', () => {
  it('renders without crashing and shows the preset name + description', () => {
    renderCard();
    // vitest stub returns the raw i18n key (e.g. "webProviders.presets.glm.name")
    // so we just verify the key is rendered into the provider-name element.
    expect(screen.getByTestId('provider-name').textContent).toBe('webProviders.presets.glm.name');
    expect(screen.getByText(/webProviders\.presets\.glm\.description/)).toBeInTheDocument();
  });

  it('shows the Login button when loginStatus=unknown (not logged in)', () => {
    renderCard({ onLogin: vi.fn() });
    expect(screen.getByTestId('login-button')).toBeInTheDocument();
    expect(screen.queryByTestId('logout-button')).not.toBeInTheDocument();
  });

  it('shows the Login button when loginStatus=loggedOut', () => {
    renderCard({
      provider: { ...fakeProvider, loginStatus: 'loggedOut' as const },
      onLogin: vi.fn(),
    });
    expect(screen.getByTestId('login-button')).toBeInTheDocument();
  });

  it('shows the Logout button when loginStatus=loggedIn (no Login button)', () => {
    renderCard({
      provider: { ...fakeProvider, loginStatus: 'loggedIn' as const },
      onLogout: vi.fn(),
    });
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
    expect(screen.queryByTestId('login-button')).not.toBeInTheDocument();
  });

  it('clicking Login calls onLogin', () => {
    const onLogin = vi.fn();
    renderCard({ onLogin });
    fireEvent.click(screen.getByTestId('login-button'));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('toggling the Enabled switch calls onEnabledChange (re-added 2026-06-08)', () => {
    const onEnabledChange = vi.fn();
    renderCard({ onEnabledChange });
    // 2026-06-08: after the second pass, the card has 2 switches:
    //   1. Enabled toggle (re-added per user feedback)
    //   2. Tool calls toggle
    // The Enabled toggle is the FIRST switch in the actions row.
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(switches[0]);
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it('clicking Logout calls onLogout', () => {
    const onLogout = vi.fn();
    renderCard({
      provider: { ...fakeProvider, loginStatus: 'loggedIn' as const },
      onLogout,
    });
    fireEvent.click(screen.getByTestId('logout-button'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('disables Login button while isLoginLoading=true', () => {
    renderCard({ onLogin: vi.fn(), isLoginLoading: true });
    const btn = screen.getByTestId('login-button') as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it('editing modelId calls onModelIdChange', () => {
    const onModelIdChange = vi.fn();
    renderCard({ onModelIdChange });
    const input = screen.getByDisplayValue('GLM-4.6');
    fireEvent.change(input, { target: { value: 'GLM-5' } });
    expect(onModelIdChange).toHaveBeenCalledWith('GLM-5');
  });

  it('toggling Tool calls calls onCapabilityChange (Reasoning toggle is GONE)', () => {
    const onCapabilityChange = vi.fn();
    renderCard({ onCapabilityChange });
    // 2026-06-08 (second pass): 2 switches in the UI:
    //   1. Enabled toggle (re-added)
    //   2. Tool calls toggle
    // Reasoning was removed (no UI element). Only supportsToolCalls
    // toggle should fire onCapabilityChange.
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    fireEvent.click(switches[1]); // Tool calls is the 2nd switch
    expect(onCapabilityChange).toHaveBeenCalledWith('supportsToolCalls', false);
  });

  it('Open website link points at preset.loginUrl and opens in new tab', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /open/i });
    expect(link.getAttribute('href')).toBe('https://chatglm.cn');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('shows the advanced collapsible (collapsed by default)', () => {
    renderCard({ onLogin: vi.fn() });
    // onUserOverrideChange is NOT provided in the simple render above,
    // so the advanced section should not render at all.
    expect(screen.queryByTestId('advanced-section')).not.toBeInTheDocument();
  });

  it('shows the advanced section when onUserOverrideChange is provided', () => {
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
        onUserOverrideChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('advanced-section')).toBeInTheDocument();
  });
});
