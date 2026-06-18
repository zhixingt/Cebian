/**
 * ⑨.4: Diagnostic logging gate.
 *
 * All `[WS-DIAG*]` logs in the web provider code paths are routed
 * through this module. They are SILENT in production unless the
 * user has explicitly enabled debug logging via the chrome.storage
 * flag `web_provider_debug` (e.g. from the Settings → Web Providers
 * → "Enable debug logs" toggle in a future PR).
 *
 * Why a gate and not just a build-time `if (DEBUG)`?
 *   - chrome.storage.local is shared across all extension contexts
 *     (SW, ISOLATED content scripts, MAIN world via SW proxy).
 *   - Users (and we) can toggle it live without reloading the
 *     extension to debug a specific failure.
 *   - Production console stays clean — no spam in DevTools when
 *     running normally.
 *
 * Usage:
 *   import { diag, diagWarn, diagError } from './web-provider-diag';
 *   diag('WS-DIAG-LISTENER', 'received', msg);     // tag + payload
 *   diagWarn('WS-DIAG', 'injection failed', err); // warn level
 *
 * Tag conventions:
 *   - WS-DIAG          : SW orchestration steps (parse, preset, tab, inject)
 *   - WS-DIAG-BRIDGE   : ISOLATED bridge receive/forward
 *   - WS-DIAG-LISTENER : SW listener receive/drop
 *   - GLM-DIAG / DS-DIAG : per-adapter state transitions (not per-chunk)
 *
 * The helper is async because chrome.storage.local.get is async, but
 * the cache (`cached`) means the typical hot-path cost is a single
 * boolean read. `diag()` is fire-and-forget: callers don't need to
 * await it.
 */

const STORAGE_KEY = 'web_provider_debug';
const TRUE = true as const;
const FALSE = false as const;

// In-memory cache so the hot path doesn't re-read chrome.storage
// on every chunk (DS/GLM adapters emit dozens of chunks per second).
let cached: boolean | null = null;

// Subscribers that want live updates when the flag changes
// (e.g. a future Settings UI wants to reflect state).
type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

function getChrome(): typeof chrome | null {
  if (typeof chrome === 'undefined') return null;
  return chrome as unknown as typeof chrome;
}

/**
 * Read the current flag value, hitting chrome.storage on first call
 * (and after a clear). Returns false (production-safe default) if
 * chrome.storage is unavailable (e.g. test env without a mock).
 */
export async function isDiagEnabled(): Promise<boolean> {
  if (cached !== null) return cached;
  const c = getChrome();
  if (!c?.storage?.local) {
    cached = FALSE;
    return FALSE;
  }
  try {
    const got = await c.storage.local.get(STORAGE_KEY);
    cached = got?.[STORAGE_KEY] === TRUE;
  } catch {
    cached = FALSE;
  }
  return cached;
}

/**
 * Subscribe to live changes of the flag. Returns an unsubscribe fn.
 * The callback fires whenever chrome.storage.onChanged reports a
 * change to `web_provider_debug` (whether caused by this process
 * via `setDiagEnabled` or by a different context like the Settings UI).
 */
export function subscribeDiagEnabled(cb: Listener): () => void {
  listeners.add(cb);
  // Lazy-attach the chrome.storage.onChanged listener the first time
  // someone subscribes. Idempotent: re-attaching is a no-op because
  // `installed` is module-scope.
  installOnChangedOnce();
  return () => {
    listeners.delete(cb);
  };
}

let installed = false;
function installOnChangedOnce(): void {
  if (installed) return;
  const c = getChrome();
  if (!c?.storage?.onChanged) return;
  installed = true;
  c.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    cached = change.newValue === TRUE;
    for (const l of listeners) {
      try {
        l(cached);
      } catch {
        /* a broken listener shouldn't break the others */
      }
    }
  });
}

/**
 * Set the flag programmatically. Useful for tests and for a future
 * Settings UI. Returns the resolved value (which is always what
 * was passed in, modulo coercion).
 */
export async function setDiagEnabled(value: boolean): Promise<void> {
  const c = getChrome();
  if (!c?.storage?.local) {
    cached = value;
    return;
  }
  await c.storage.local.set({ [STORAGE_KEY]: value });
  // The onChanged listener will update `cached` and notify
  // subscribers; we also set it eagerly so callers that read
  // `isDiagEnabled` immediately after don't see a stale value.
  cached = value;
  for (const l of listeners) {
    try {
      l(cached);
    } catch {
      /* see subscribeDiagEnabled */
    }
  }
}

/**
 * Hot-path diagnostic log. Fire-and-forget: the chrome.storage read
 * is short-circuited by the cache. The `tag` argument is wrapped in
 * `[...]` automatically — don't include brackets yourself.
 *
 * If the cache is cold (e.g. first call after module load before
 * `isDiagEnabled()` has resolved), we schedule a fire-and-forget
 * warm. The first call after a cold start is always silent — by the
 * time the next call comes, the cache is populated.
 */
export function diag(tag: string, msg: string, extra?: unknown): void {
  if (cached === null) {
    // Cold start: schedule a warm. Don't block the caller.
    void isDiagEnabled();
    return;
  }
  if (cached !== TRUE) return;
  if (extra === undefined) {
    console.log(`[${tag}] ${msg}`);
  } else {
    console.log(`[${tag}] ${msg}`, extra);
  }
}

/** Like `diag` but uses console.warn. For non-fatal issues that
 *  the user might want to know about (e.g. recoverable fetch errors). */
export function diagWarn(tag: string, msg: string, extra?: unknown): void {
  if (cached === null) {
    void isDiagEnabled();
    return;
  }
  if (cached !== TRUE) return;
  if (extra === undefined) {
    console.warn(`[${tag}] ${msg}`);
  } else {
    console.warn(`[${tag}] ${msg}`, extra);
  }
}

/** Like `diag` but uses console.error. Reserved for actual errors
 *  (failed executeScript, Dexie write rejected, etc.). */
export function diagError(tag: string, msg: string, extra?: unknown): void {
  if (cached === null) {
    void isDiagEnabled();
    return;
  }
  if (cached !== TRUE) return;
  if (extra === undefined) {
    console.error(`[${tag}] ${msg}`);
  } else {
    console.error(`[${tag}] ${msg}`, extra);
  }
}
