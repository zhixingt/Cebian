/**
 * useUpdateCheck — fetches the latest Cebian release from the fork's GitHub
 * Releases atom feed and compares against the currently installed extension
 * version.
 *
 * Why atom feed and not api.github.com:
 * - The unauthenticated api.github.com endpoint is rate-limited to 60 req/h per
 *   IP. The user's IP exhausted this and the check silently 403'd, leaving
 *   the "Check for updates" button perpetually clickable (error state).
 * - The GitHub Pages atom feed (releases.atom) is served from a separate
 *   rate-limit pool and is not subject to the 60/h cap.
 * - The atom feed for a repo with zero releases returns HTTP 200 with an
 *   empty <feed>, which is a deterministic "noRelease" signal.
 *
 * Result is cached in localStorage for 6 hours to avoid hitting the feed on
 * every About-page mount. Call `recheck()` to force-refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const CACHE_KEY = 'cebian:updateCheck';
const CACHE_VERSION = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const RELEASES_URL = 'https://github.com/zhixingt/Cebian/releases.atom';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'noRelease' }
  | { kind: 'upToDate'; current: string; latest: string }
  | { kind: 'updateAvailable'; current: string; latest: string }
  | { kind: 'error' };

interface CacheEntry {
  version: number;
  checkedAt: number;
  latest: string;
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.version !== CACHE_VERSION) return null;
    if (typeof parsed.checkedAt !== 'number' || typeof parsed.latest !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry: Omit<CacheEntry, 'version'>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, ...entry }));
  } catch {
    // ignore quota / disabled storage
  }
}

/**
 * Compare two semver-like strings. Strips any prerelease/build suffix
 * (anything after `-` or `+`) before numeric `a.b.c` comparison.
 * Returns 1, 0, -1.
 */
function compareVersions(a: string, b: string): number {
  const stripSuffix = (s: string) => s.split(/[-+]/)[0];
  const pa = stripSuffix(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = stripSuffix(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function stripV(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

function isPrerelease(tag: string): boolean {
  // semver: anything after '-' is a prerelease; anything after '+' is build metadata.
  // Per the test contract, +build is treated as a prerelease.
  return /[-+]/.test(tag);
}

function buildStatus(current: string, latest: string): UpdateStatus {
  return compareVersions(latest, current) > 0
    ? { kind: 'updateAvailable', current, latest }
    : { kind: 'upToDate', current, latest };
}

function initialStatus(current: string): UpdateStatus {
  const cached = readCache();
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return buildStatus(current, cached.latest);
  }
  return { kind: 'idle' };
}

/**
 * Parse a GitHub Releases atom feed and return the first stable release tag
 * (without leading `v`), or `null` when no stable release is present.
 *
 * An entry is treated as a prerelease when its `<title>` contains `-` or `+`
 * (semver prerelease / build-metadata marker).
 */
export function findFirstStableRelease(xml: string): string | null {
  if (!xml || typeof xml !== 'string') return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  // DOMParser surfaces parse errors as a <parsererror> child of the document.
  if (doc.getElementsByTagName('parsererror').length > 0) return null;

  const entries = Array.from(doc.getElementsByTagName('entry'));
  for (const entry of entries) {
    const title = entry.getElementsByTagName('title')[0]?.textContent?.trim();
    if (!title) continue;
    if (isPrerelease(title)) continue;
    return stripV(title);
  }
  return null;
}

export function useUpdateCheck() {
  const current = chrome.runtime.getManifest().version;
  const [status, setStatus] = useState<UpdateStatus>(() => initialStatus(current));
  const inflightRef = useRef(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const runCheck = useCallback(
    async (force: boolean) => {
      if (inflightRef.current) return;
      if (!force) {
        const cached = readCache();
        if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
          if (mountedRef.current) setStatus(buildStatus(current, cached.latest));
          return;
        }
      }

      inflightRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      if (mountedRef.current) setStatus({ kind: 'checking' });
      try {
        const res = await fetch(RELEASES_URL, {
          headers: { Accept: 'application/atom+xml' },
          signal: controller.signal,
        });
        if (!res.ok) {
          // 404 / 410 on a releases.atom endpoint is a deterministic "this
          // repo has no releases" signal (the URL is correct, the feed just
          // doesn't exist). Map to noRelease so the UI can show a stable
          // "no release" state instead of a perpetual error.
          if (res.status === 404 || res.status === 410) {
            if (mountedRef.current) setStatus({ kind: 'noRelease' });
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const xml = await res.text();
        const latest = findFirstStableRelease(xml);
        if (!latest) {
          // No stable release on the feed (fork with 0 releases, or every
          // entry is a prerelease). Treat as a deterministic terminal state
          // so the caller can show "your fork has no releases" instead of
          // a perpetual spinner / error.
          if (mountedRef.current) setStatus({ kind: 'noRelease' });
          return;
        }
        writeCache({ checkedAt: Date.now(), latest });
        if (mountedRef.current) setStatus(buildStatus(current, latest));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.warn('[useUpdateCheck] update check failed:', err);
        if (mountedRef.current) setStatus({ kind: 'error' });
      } finally {
        inflightRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [current],
  );

  useEffect(() => {
    mountedRef.current = true;
    void runCheck(false);
    return () => {
      mountedRef.current = false;
    };
  }, [runCheck]);

  const recheck = useCallback(() => runCheck(true), [runCheck]);

  return { status, current, recheck };
}

/**
 * Resolves the install-guide URL on cebian.catcat.work based on the current
 * UI language. Chinese locales (zh, zh_CN, zh_TW, zh_HK) all map to /zh;
 * everything else falls back to /en.
 *
 * TODO: add a /zh-tw path once the install guide site ships a Traditional
 * Chinese variant — currently zh_TW users get the Simplified guide.
 */
export function getInstallGuideUrl(): string {
  const lang = chrome.i18n.getUILanguage().toLowerCase();
  const path = lang.startsWith('zh') ? '/zh/install-guide' : '/en/install-guide';
  return `https://cebian.catcat.work${path}`;
}
