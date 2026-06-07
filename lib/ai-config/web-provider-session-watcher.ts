/**
 * Session watcher: detects when the user has logged out of a web
 * provider (e.g. chatglm.cn) in their browser, *while not actively
 * sending a message*. On detection it fires the existing
 * `web_provider_needs_relogin` flow (handleWebProviderRelogin in
 * entrypoints/background/web-provider-relogin.ts).
 *
 * Triggers:
 *   1. `chrome.cookies.onChanged` (debounced 500ms) for any change on
 *      a watched domain
 *   2. Periodic probe (default 5 min) to catch silent logouts that
 *      don't fire a cookie change (rare but possible — e.g. cookies
 *      cleared via DevTools after a session is restored from
 *      backup and never re-emits a `removed` event on a domain
 *      that's no longer in the jar)
 *
 * The watcher reuses the existing `WEB_LLM_NEEDS_RELOGIN` plumbing;
 * it only adds new *triggers*. No new schema, no new UI, no new
 * sidepanel message type.
 *
 * Testability: every chrome.* and setInterval call is injected
 * via SessionWatcherDeps. The pure predicates (detectSessionLost,
 * shouldFireOnCookieChange) take primitive args and are trivially
 * testable in isolation.
 */

import type { WebProvider } from '../types';

/**
 * Cookie change event payload from chrome.cookies.onChanged.
 * Source: https://developer.chrome.com/docs/extensions/reference/api/cookies#event-onChanged
 *
 * The `cause` field is one of 'evicted' | 'overwrite' | 'expired' |
 * 'explicit' | 'unknown'. We treat all as "something happened, time
 * to re-verify". The actual "are we still logged in?" check is the
 * downstream `detectSessionLost()` call against the current cookie set.
 */
export interface CookieChangeEvent {
  cause: 'evicted' | 'overwrite' | 'expired' | 'explicit' | 'unknown' | string;
  cookie: {
    domain: string;
    name: string;
    // ... other fields exist but we don't use them
  };
  removed: boolean;
}

export interface DetectSessionLostArgs {
  /** preset.sessionIndicators — names of cookies that MUST exist when logged in */
  sessionIndicators: readonly string[];
  /** current cookies for the provider's domain, after the change fired */
  remainingCookies: Record<string, string>;
}

/**
 * True iff the provider is no longer logged in.
 *
 * "Logged in" means AT LEAST ONE of the sessionIndicator cookies
 * exists with a non-empty value. The predicate is conservative on
 * ambiguity: if sessionIndicators is empty (misconfigured preset),
 * assume lost to avoid stale-session false-negatives. Same for
 * cookies whose value is the empty string — treat as gone so the
 * user-facing flow fires NEEDS_RELOGIN one tick earlier rather
 * than waiting for actual deletion.
 */
export function detectSessionLost(args: DetectSessionLostArgs): boolean {
  const { sessionIndicators, remainingCookies } = args;
  if (sessionIndicators.length === 0) return true;
  for (const name of sessionIndicators) {
    const v = remainingCookies[name];
    if (typeof v === 'string' && v.length > 0) {
      return false; // at least one alive → still logged in
    }
  }
  return true; // none alive → lost
}

export interface ShouldFireOnCookieChangeArgs {
  cause: string;
  domain: string;
  watchedDomains: readonly string[];
}

/**
 * Filter for chrome.cookies.onChanged: only fire on the watched domains.
 * The `cause` field is filtered downstream (we fire on all causes and
 * let `detectSessionLost` decide if we're really logged out).
 *
 * Accepts both bare domains (`chatglm.cn`) and leading-dot
 * domains (`.chatglm.cn`) — Chrome reports the latter for cookies
 * set on a subdomain.
 */
export function shouldFireOnCookieChange(args: ShouldFireOnCookieChangeArgs): boolean {
  const domain = args.domain.replace(/^\./, '');
  for (const w of args.watchedDomains) {
    if (w === domain) return true;
    const wNorm = w.replace(/^\./, '');
    if (wNorm === domain) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────
// Watcher (lifecycle + dispatch)
// ────────────────────────────────────────────────────────────────────

export interface NeedsReloginBroadcast {
  type: 'web_provider_needs_relogin';
  providerId: string;
  status: 401;
  message: string;
}

export interface SessionWatcherDeps {
  /** Chrome API surface. Allows tests to swap in a mock. */
  chromeApi: {
    cookies: {
      onChanged: {
        addListener: (cb: (event: CookieChangeEvent) => void) => void;
      };
    };
  };
  /** Broadcast the existing `web_provider_needs_relogin` ServerMessage. */
  broadcast: (msg: NeedsReloginBroadcast) => void;
  /** Read all cookies for a domain. */
  listCookies: (domain: string) => Promise<Record<string, string>>;
  /** Invalidate the bundle cache (existing helper). */
  invalidateBundle: (providerId: string) => void;
  /** Preset's session-indicator cookie names. */
  sessionIndicators: readonly string[];
  /** Domain(s) to watch (typically the preset's cookieDomain). */
  watchedDomains: readonly string[];
  /** Periodic probe interval. Default 5*60_000 in production. */
  intervalMs: number;
  /** Injected for tests. Defaults to globalThis.setInterval. */
  setIntervalImpl?: (cb: () => void, ms: number) => unknown;
  /** Injected for tests. */
  clearIntervalImpl?: (h: unknown) => void;
  /** Injected for tests. Defaults to globalThis.setTimeout. */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  /** Injected for tests. */
  clearTimeoutImpl?: (h: unknown) => void;
  /** Debounce window for cookie changes. Default 500ms. */
  cookieDebounceMs?: number;
}

export interface SessionWatcherHandle {
  providerId: string;
  intervalId: unknown;
  /**
   * Re-run the probe right now. Used by the global cookie listener
   * to short-circuit the 500ms debounce when a change fires for
   * the right domain.
   */
  runProbe: () => Promise<void>;
  /** Remove the cookie listener + clear the interval. Idempotent. */
  stop: () => void;
}

const DEFAULT_SET_INTERVAL = (cb: () => void, ms: number): unknown => setInterval(cb, ms);
const DEFAULT_CLEAR_INTERVAL = (h: unknown): void => clearInterval(h as ReturnType<typeof setInterval>);
const DEFAULT_SET_TIMEOUT = (cb: () => void, ms: number): unknown => setTimeout(cb, ms);
const DEFAULT_CLEAR_TIMEOUT = (h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>);
const DEFAULT_DEBOUNCE_MS = 500;

export function startSessionWatcher(
  providerId: string,
  deps: SessionWatcherDeps,
): SessionWatcherHandle {
  const setI = deps.setIntervalImpl ?? DEFAULT_SET_INTERVAL;
  const clearI = deps.clearIntervalImpl ?? DEFAULT_CLEAR_INTERVAL;
  const setT = deps.setTimeoutImpl ?? DEFAULT_SET_TIMEOUT;
  const clearT = deps.clearTimeoutImpl ?? DEFAULT_CLEAR_TIMEOUT;
  const debounceMs = deps.cookieDebounceMs ?? DEFAULT_DEBOUNCE_MS;
  let stopped = false;

  const probe = async (): Promise<void> => {
    if (stopped) return;
    for (const domain of deps.watchedDomains) {
      const cookies = await deps.listCookies(domain);
      if (detectSessionLost({ sessionIndicators: deps.sessionIndicators, remainingCookies: cookies })) {
        deps.invalidateBundle(providerId);
        deps.broadcast({
          type: 'web_provider_needs_relogin',
          providerId,
          status: 401,
          message: `Session cookies for ${providerId} on ${domain} are gone. Please re-login via Settings → Web Providers.`,
        });
        return; // one broadcast per tick is enough
      }
    }
  };

  const intervalId = setI(() => { void probe(); }, deps.intervalMs);

  // Debounce cookie changes so a burst of changes (e.g. tab closing
  // emits several) triggers one probe.
  let debounceHandle: unknown = null;
  const onCookieChange = (_event: CookieChangeEvent): void => {
    if (stopped) return;
    if (debounceHandle != null) clearT(debounceHandle);
    debounceHandle = setT(() => {
      debounceHandle = null;
      void probe();
    }, debounceMs);
  };
  deps.chromeApi.cookies.onChanged.addListener(onCookieChange);

  return {
    providerId,
    intervalId,
    runProbe: () => probe(),
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearI(intervalId);
      if (debounceHandle != null) {
        clearT(debounceHandle);
        debounceHandle = null;
      }
    },
  };
}

export function stopSessionWatcher(handle: SessionWatcherHandle): void {
  handle.stop();
}

// WebProvider presetId re-export for the BG wiring layer.
export type WatcherProviderId = WebProvider['presetId'];
