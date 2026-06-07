import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  installSessionWatcher,
  _resetSessionWatcherBgForTesting,
  type InstallDeps,
} from '@/entrypoints/background/web-provider-session-watcher-bg';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';
import { getDb } from '@/lib/db';
import type { WebProvider } from '@/lib/types';

function makeDeps(overrides: Partial<InstallDeps> = {}): InstallDeps {
  // Use `'presets' in overrides` to distinguish "use the real
  // WEB_PROVIDER_PRESETS" (the production default) from "force empty
  // array". A simple `overrides.presets ?? []` would collapse the
  // two: passing `presets: undefined` to test the real preset list
  // would silently become `[]`.
  const deps: InstallDeps = {
    startSessionWatcher: overrides.startSessionWatcher ?? vi.fn().mockReturnValue({
      providerId: 'glm',
      intervalId: 0,
      runProbe: vi.fn(),
      stop: vi.fn(),
    }),
    addCookieListener: overrides.addCookieListener ?? vi.fn(),
    addMessageListener: overrides.addMessageListener ?? vi.fn(),
  };
  if ('presets' in overrides) deps.presets = overrides.presets;
  return deps;
}

beforeEach(async () => {
  _resetSessionWatcherBgForTesting();
  await getDb().webProviders.clear();
});

describe('installSessionWatcher (BG wiring for 401 detection)', () => {
  it('starts a watcher for each preset whose Dexie loginStatus is loggedIn', async () => {
    const repo = getWebProviderRepository();
    // Seed the two presets
    await repo.list();
    // glm loggedIn
    await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedIn');
    // (Only 'glm' is in the default presets array for this test)

    const startSessionWatcher = vi.fn().mockReturnValue({ stop: vi.fn(), runProbe: vi.fn(), providerId: 'glm', intervalId: 0 });
    const deps = makeDeps({ presets: undefined, startSessionWatcher });
    installSessionWatcher(deps);
    // wait for the async IIFE to resolve
    await new Promise(r => setTimeout(r, 10));
    expect(startSessionWatcher).toHaveBeenCalledTimes(1);
    expect(startSessionWatcher.mock.calls[0][0]).toBe('glm');
  });

  it('does NOT start a watcher for a preset whose loginStatus is loggedOut', async () => {
    const repo = getWebProviderRepository();
    await repo.list();
    await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedOut');

    const startSessionWatcher = vi.fn().mockReturnValue({ stop: vi.fn(), runProbe: vi.fn(), providerId: 'glm', intervalId: 0 });
    const deps = makeDeps({ presets: undefined, startSessionWatcher });
    installSessionWatcher(deps);
    await new Promise(r => setTimeout(r, 10));
    expect(startSessionWatcher).not.toHaveBeenCalled();
  });

  it('installs a single global chrome.cookies.onChanged listener', () => {
    const addCookieListener = vi.fn();
    const deps = makeDeps({ addCookieListener });
    installSessionWatcher(deps);
    expect(addCookieListener).toHaveBeenCalledTimes(1);
  });

  it('installs a chrome.runtime.onMessage listener for relogin_success', () => {
    const addMessageListener = vi.fn();
    const deps = makeDeps({ addMessageListener });
    installSessionWatcher(deps);
    expect(addMessageListener).toHaveBeenCalledTimes(1);
  });

  it('idempotent: calling install twice does not double-install listeners', () => {
    const addCookieListener = vi.fn();
    const addMessageListener = vi.fn();
    const deps = makeDeps({ addCookieListener, addMessageListener });
    installSessionWatcher(deps);
    installSessionWatcher(deps);
    expect(addCookieListener).toHaveBeenCalledTimes(1);
    expect(addMessageListener).toHaveBeenCalledTimes(1);
  });

  it('restarts the watcher for a provider when relogin_success arrives', async () => {
    const repo = getWebProviderRepository();
    await repo.list();
    await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedIn');

    let capturedMessageHandler: ((msg: any) => void) | null = null;
    const startSessionWatcher = vi.fn().mockReturnValue({ stop: vi.fn(), runProbe: vi.fn(), providerId: 'glm', intervalId: 0 });
    const deps = makeDeps({
      presets: undefined,
      startSessionWatcher,
      addMessageListener: (cb) => { capturedMessageHandler = cb; },
    });
    installSessionWatcher(deps);
    await new Promise(r => setTimeout(r, 10));
    // Initial install started one watcher for glm
    expect(startSessionWatcher).toHaveBeenCalledTimes(1);

    // Simulate the relogin flow posting a relogin_success message
    capturedMessageHandler!({ type: 'relogin_success', providerId: 'glm' });
    // The watcher should have been stopped (the new one replaces it)
    const firstHandle = (startSessionWatcher.mock.results[0] as { value: { stop: () => void } }).value;
    expect(firstHandle.stop).toHaveBeenCalled();
    // And a new watcher started
    expect(startSessionWatcher).toHaveBeenCalledTimes(2);
  });

  it('relogin_success for an unknown provider is a no-op', async () => {
    let capturedMessageHandler: ((msg: any) => void) | null = null;
    const startSessionWatcher = vi.fn().mockReturnValue({ stop: vi.fn(), runProbe: vi.fn(), providerId: 'glm', intervalId: 0 });
    const deps = makeDeps({
      startSessionWatcher,
      addMessageListener: (cb) => { capturedMessageHandler = cb; },
    });
    installSessionWatcher(deps);
    const callsBefore = startSessionWatcher.mock.calls.length;
    capturedMessageHandler!({ type: 'relogin_success', providerId: 'nonexistent' });
    expect(startSessionWatcher).toHaveBeenCalledTimes(callsBefore);
  });

  it('cookie change listener dispatches to the right preset watcher via runProbe', async () => {
    const repo = getWebProviderRepository();
    await repo.list();
    await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedIn');

    let capturedCookieHandler: ((e: any) => void) | null = null;
    const runProbe = vi.fn().mockResolvedValue(undefined);
    const startSessionWatcher = vi.fn().mockReturnValue({
      stop: vi.fn(), runProbe, providerId: 'glm', intervalId: 0,
    });
    const deps = makeDeps({
      presets: undefined,
      startSessionWatcher,
      addCookieListener: (cb) => { capturedCookieHandler = cb; },
    });
    installSessionWatcher(deps);
    await new Promise(r => setTimeout(r, 10));

    // Fire a cookie change on the watched domain
    capturedCookieHandler!({ cookie: { domain: 'chatglm.cn', name: 'chatglm_token' } });
    // Give the async runProbe a tick
    await new Promise(r => setTimeout(r, 0));
    expect(runProbe).toHaveBeenCalled();
  });

  it('cookie change listener ignores unrelated domains (no runProbe)', async () => {
    const repo = getWebProviderRepository();
    await repo.list();
    await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedIn');

    let capturedCookieHandler: ((e: any) => void) | null = null;
    const runProbe = vi.fn().mockResolvedValue(undefined);
    const startSessionWatcher = vi.fn().mockReturnValue({
      stop: vi.fn(), runProbe, providerId: 'glm', intervalId: 0,
    });
    const deps = makeDeps({
      presets: undefined,
      startSessionWatcher,
      addCookieListener: (cb) => { capturedCookieHandler = cb; },
    });
    installSessionWatcher(deps);
    await new Promise(r => setTimeout(r, 10));

    // Fire a cookie change on a different domain
    capturedCookieHandler!({ cookie: { domain: 'unrelated.com', name: 'x' } });
    await new Promise(r => setTimeout(r, 0));
    expect(runProbe).not.toHaveBeenCalled();
  });

  it('cookie change listener handles leading-dot domains (chrome .chatglm.cn format)', async () => {
    const repo = getWebProviderRepository();
    await repo.list();
    await repo.setLoginStatus('glm' as WebProvider['presetId'], 'loggedIn');

    let capturedCookieHandler: ((e: any) => void) | null = null;
    const runProbe = vi.fn().mockResolvedValue(undefined);
    const startSessionWatcher = vi.fn().mockReturnValue({
      stop: vi.fn(), runProbe, providerId: 'glm', intervalId: 0,
    });
    const deps = makeDeps({
      presets: undefined,
      startSessionWatcher,
      addCookieListener: (cb) => { capturedCookieHandler = cb; },
    });
    installSessionWatcher(deps);
    await new Promise(r => setTimeout(r, 10));

    capturedCookieHandler!({ cookie: { domain: '.chatglm.cn', name: 'chatglm_token' } });
    await new Promise(r => setTimeout(r, 0));
    expect(runProbe).toHaveBeenCalled();
  });
});
