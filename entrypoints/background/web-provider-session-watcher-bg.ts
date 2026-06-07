/**
 * BG wiring for the session watcher (Issue 2: 401/session-expired
 * proactive detection, KNOWN_ISSUES.md).
 *
 * The watcher itself lives in `lib/ai-config/web-provider-session-watcher.ts`
 * and is fully testable in isolation (pure predicates + dep-injected
 * watcher). This module is the *thin* BG-side glue that:
 *
 *   1. Reads `WEB_PROVIDER_PRESETS` and the Dexie `webProviders` table
 *   2. For each preset whose `loginStatus === 'loggedIn'`, starts a
 *      `SessionWatcher` and stores the handle in a module-level map
 *   3. Installs a single global `chrome.cookies.onChanged` listener
 *      that dispatches to the right preset's `runProbe` (filtered by
 *      the preset's `cookieDomain` — leading-dot normalized)
 *   4. Listens for `{type:'relogin_success'}` messages (emitted by
 *      `web-provider-relogin.ts` after a successful re-login) and
 *      restarts the watcher for that provider (re-reads cookies)
 *
 * Idempotency: `installSessionWatcher()` is safe to call multiple
 * times — only the first call installs listeners. This matches the
 * pattern used by `registerWebProviderReloginHandler`.
 *
 * The watcher reuses the existing `WEB_LLM_NEEDS_RELOGIN` plumbing —
 * when a probe detects session loss, it broadcasts the same
 * `web_provider_needs_relogin` ServerMessage that the HTTP-replay
 * 401 path already produces. The sidepanel toast + openSettings
 * flow is untouched.
 */

import type { WebProviderPreset } from '@/lib/ai-config/web-provider-presets';
import { WEB_PROVIDER_PRESETS } from '@/lib/ai-config/web-provider-presets';
import type { WebProvider } from '@/lib/types';
import {
  startSessionWatcher as defaultStartSessionWatcher,
  shouldFireOnCookieChange,
  type SessionWatcherHandle,
} from '@/lib/ai-config/web-provider-session-watcher';
import { listCookiesForDomain as defaultListCookies } from '@/lib/ai-config/web-provider-cookie-service';
import { invalidateBundle as defaultInvalidateBundle } from '@/lib/ai-config/web-provider-bundle';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';

const PROBE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface InstallDeps {
  /**
   * Presets to watch. In production this defaults to `WEB_PROVIDER_PRESETS`;
   * tests pass a custom (possibly empty) array. Only presets whose Dexie
   * `loginStatus === 'loggedIn'` actually get a watcher started.
   */
  presets?: readonly WebProviderPreset[];
  /** startSessionWatcher injection — production uses the real one. */
  startSessionWatcher: typeof defaultStartSessionWatcher;
  /** addListener injection. Production: chrome.cookies.onChanged.addListener. */
  addCookieListener: (cb: (event: unknown) => void) => void;
  /** addListener injection. Production: chrome.runtime.onMessage.addListener. */
  addMessageListener: (cb: (msg: any) => void) => void;
}

let _installed = false;
const _handles = new Map<WebProvider['presetId'], SessionWatcherHandle>();
let _domainToPresetId = new Map<string, WebProvider['presetId']>();

/**
 * Install the session watcher. Idempotent — only the first call has
 * any effect. Production callers (entrypoints/background/index.ts)
 * invoke this once on SW boot.
 */
export function installSessionWatcher(deps: InstallDeps): void {
  if (_installed) return;
  _installed = true;

  const presets = deps.presets ?? WEB_PROVIDER_PRESETS;
  const startW = deps.startSessionWatcher;

  // Build a normalized domain → presetId map so the global cookie
  // listener can dispatch quickly without scanning all presets per
  // event. Both bare ('chatglm.cn') and leading-dot ('.chatglm.cn')
  // shapes are registered.
  _domainToPresetId = new Map();
  for (const p of presets) {
    if (!p.cookieDomain) continue;
    _domainToPresetId.set(p.cookieDomain, p.id);
    _domainToPresetId.set(`.${p.cookieDomain}`, p.id);
  }

  // Start a watcher for each preset whose Dexie loginStatus is loggedIn.
  // Async because Dexie reads are async; we don't block SW boot on this.
  void (async () => {
    const repo = getWebProviderRepository();
    for (const p of presets) {
      try {
        const row = await repo.get(p.id);
        if (row?.loginStatus === 'loggedIn') {
          _startForPreset(p, startW);
        }
      } catch (err) {
        console.warn(`[session-watcher] failed to start for ${p.id}:`, err);
      }
    }
  })();

  // Global cookie listener. The watcher itself only knows about a
  // single domain; the BG layer dispatches the right watcher's probe
  // by looking up the presetId from the event's cookie domain.
  deps.addCookieListener((event: unknown) => {
    const e = event as { cookie?: { domain?: string } } | undefined;
    const domain = e?.cookie?.domain ?? '';
    if (!domain) return;
    if (!shouldFireOnCookieChange({
      cause: 'unknown',
      domain,
      watchedDomains: Array.from(_domainToPresetId.keys()),
    })) {
      return;
    }
    // Map the (possibly dot-prefixed) domain back to its presetId.
    const normalized = domain.replace(/^\./, '');
    const presetId =
      _domainToPresetId.get(domain) ??
      _domainToPresetId.get(normalized) ??
      _domainToPresetId.get(`.${normalized}`);
    if (!presetId) return;
    const handle = _handles.get(presetId);
    if (!handle) return;
    // Short-circuit the 500ms debounce: the change already fired for
    // the right domain, so probe immediately.
    void handle.runProbe();
  });

  // Re-login handler: restart the watcher for that provider so the
  // new (post-relogin) cookies are picked up and the next periodic
  // probe doesn't immediately re-fire NEEDS_RELOGIN.
  deps.addMessageListener((msg: any) => {
    if (msg?.type !== 'relogin_success') return;
    const providerId = msg.providerId;
    if (typeof providerId !== 'string') return;
    const preset = presets.find((p) => p.id === providerId);
    if (!preset) return;
    _startForPreset(preset, startW);
  });
}

function _startForPreset(
  preset: WebProviderPreset,
  startW: typeof defaultStartSessionWatcher,
): void {
  // Stop the old handle if any (idempotent: a no-op if not running).
  _handles.get(preset.id)?.stop();

  const handle = startW(preset.id, {
    chromeApi: {
      cookies: {
        onChanged: {
          // The watcher only needs a stub here — the global listener
          // installed in installSessionWatcher() does the actual
          // dispatch. The stub satisfies the type contract without
          // double-registering listeners.
          addListener: () => { /* global listener owns dispatch */ },
        },
      },
    },
    broadcast: (msg) => {
      // The handle's broadcast must be the one that reaches the
      // sidepanel. We delegate to the existing WEB_LLM_NEEDS_RELOGIN
      // re-login flow which already wires the sidepanel port.
      defaultBroadcast(msg);
    },
    listCookies: (domain) => defaultListCookies(domain),
    invalidateBundle: (providerId) => defaultInvalidateBundle(providerId as WebProvider['presetId']),
    sessionIndicators: preset.sessionIndicators,
    watchedDomains: preset.cookieDomain ? [preset.cookieDomain] : [],
    intervalMs: PROBE_INTERVAL_MS,
  });
  _handles.set(preset.id, handle);
}

/**
 * Default broadcast: post the watcher-detected `web_provider_needs_relogin`
 * message through the same path as the HTTP-replay 401 path. We import
 * `chrome.runtime` lazily to avoid loading chrome.* at module-eval time
 * in unit tests.
 */
function defaultBroadcast(msg: {
  type: 'web_provider_needs_relogin';
  providerId: string;
  status: 401;
  message: string;
}): void {
  try {
    // Lazy import to keep this module side-effect-free at unit-test
    // load time (no chrome.* references at module top level).
    // The BG's registerWebProviderReloginHandler already owns a
    // chrome.runtime.onMessage listener that routes
    // WEB_LLM_NEEDS_RELOGIN-shaped messages back to the sidepanel.
    // We re-use that path by posting a synthetic relay message:
    void chrome.runtime.sendMessage({
      type: 'WEB_LLM_NEEDS_RELOGIN',
      providerId: msg.providerId,
      status: msg.status,
      message: msg.message,
    });
  } catch (err) {
    console.warn('[session-watcher] broadcast failed:', err);
  }
}

/** Test-only: reset module-level state. Use in vitest beforeEach. */
export function _resetSessionWatcherBgForTesting(): void {
  for (const h of _handles.values()) h.stop();
  _handles.clear();
  _domainToPresetId = new Map();
  _installed = false;
}
