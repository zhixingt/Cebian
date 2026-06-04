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
  domStrategy: GLM_DOM_STRATEGY,  // ⑧: required field
};

describe('WebProviderCard', () => {
  it('renders without crashing', () => {
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );
    // Should display GLM somewhere
    expect(screen.getByText(/GLM/i)).toBeInTheDocument();
  });

  it('toggling enable calls onEnabledChange', () => {
    const onEnabledChange = vi.fn();
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={onEnabledChange}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );
    // The enable switch should be the first switch on the page
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]); // toggle enabled
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it('editing modelId calls onModelIdChange', () => {
    const onModelIdChange = vi.fn();
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={onModelIdChange}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );
    const input = screen.getByDisplayValue('GLM-4.6');
    fireEvent.change(input, { target: { value: 'GLM-5' } });
    expect(onModelIdChange).toHaveBeenCalledWith('GLM-5');
  });

  it('clicking recheck calls onRecheck', () => {
    const onRecheck = vi.fn();
    render(
      <WebProviderCard
        provider={fakeProvider}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={onRecheck}
      />,
    );
    const button = screen.getByRole('button', { name: /re-check/i });
    fireEvent.click(button);
    expect(onRecheck).toHaveBeenCalled();
  });

  // ⭐ ⑤.3: Logout button tests
  it('shows Logout button when loginStatus=loggedIn', () => {
    const loggedIn = { ...fakeProvider, loginStatus: 'loggedIn' as const };
    render(
      <WebProviderCard
        provider={loggedIn}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('does NOT show Logout button when loginStatus=loggedOut', () => {
    const loggedOut = { ...fakeProvider, loginStatus: 'loggedOut' as const };
    render(
      <WebProviderCard
        provider={loggedOut}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('logout-button')).not.toBeInTheDocument();
  });

  it('does NOT show Logout button when loginStatus=unknown', () => {
    render(
      <WebProviderCard
        provider={fakeProvider}  // loginStatus='unknown'
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('logout-button')).not.toBeInTheDocument();
  });

  it('clicking Logout calls onLogout (parent clears bundle + sets loggedOut)', () => {
    const onLogout = vi.fn();
    const loggedIn = { ...fakeProvider, loginStatus: 'loggedIn' as const };
    render(
      <WebProviderCard
        provider={loggedIn}
        preset={fakePreset}
        isChecking={false}
        onEnabledChange={vi.fn()}
        onModelIdChange={vi.fn()}
        onCapabilityChange={vi.fn()}
        onRecheck={vi.fn()}
        onLogout={onLogout}
      />,
    );
    fireEvent.click(screen.getByTestId('logout-button'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
