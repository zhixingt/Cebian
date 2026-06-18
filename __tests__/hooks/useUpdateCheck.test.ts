import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useUpdateCheck, findFirstStableRelease } from '@/hooks/useUpdateCheck';

const FEED_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <id>tag:github.com,2008:https://github.com/zhixingt/Cebian/releases</id>
  <link type="text/html" rel="alternate" href="https://github.com/zhixingt/Cebian/releases"/>
  <link type="application/atom+xml" rel="self" href="https://github.com/zhixingt/Cebian/releases.atom"/>
  <title>Release notes from Cebian</title>
  <updated>2026-06-07T14:53:12Z</updated>
</feed>`;

const FEED_PRERELEASE_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title>Release notes from Cebian</title>
  <entry>
    <id>tag:github.com,2008:Repository/1206145332/v1.3.2-alpha.0</id>
    <updated>2026-06-07T03:50:34Z</updated>
    <title>v1.3.2-alpha.0</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1206145332/v1.3.0-beta.1</id>
    <updated>2026-05-20T07:24:33Z</updated>
    <title>v1.3.0-beta.1</title>
  </entry>
</feed>`;

const FEED_MIXED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title>Release notes from Cebian</title>
  <entry>
    <id>tag:github.com,2008:Repository/v1.3.2-alpha.0</id>
    <updated>2026-06-07T03:50:34Z</updated>
    <title>v1.3.2-alpha.0</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/v1.3.1</id>
    <updated>2026-05-30T11:32:38Z</updated>
    <title>v1.3.1</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/v1.3.0</id>
    <updated>2026-05-30T07:24:33Z</updated>
    <title>v1.3.0</title>
  </entry>
</feed>`;

const FEED_STABLE_FIRST = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title>Release notes from Cebian</title>
  <entry>
    <title>v1.3.1</title>
  </entry>
</feed>`;

const FEED_MALFORMED = `not xml at all <<<>>>`;

describe('findFirstStableRelease', () => {
  it('returns null for an empty feed (no <entry>)', () => {
    expect(findFirstStableRelease(FEED_EMPTY)).toBeNull();
  });

  it('returns null when every entry is a prerelease', () => {
    expect(findFirstStableRelease(FEED_PRERELEASE_ONLY)).toBeNull();
  });

  it('skips prereleases and returns the first stable tag', () => {
    expect(findFirstStableRelease(FEED_MIXED)).toBe('1.3.1');
  });

  it('strips leading v from a single stable release', () => {
    expect(findFirstStableRelease(FEED_STABLE_FIRST)).toBe('1.3.1');
  });

  it('returns null for malformed XML', () => {
    expect(findFirstStableRelease(FEED_MALFORMED)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(findFirstStableRelease('')).toBeNull();
  });

  it('treats +build suffix as a prerelease (semver build metadata)', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>v1.3.1+build.42</title></entry>
    </feed>`;
    expect(findFirstStableRelease(xml)).toBeNull();
  });

  it('skips entries with missing/empty <title>', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title></title></entry>
      <entry><title>v1.3.1</title></entry>
    </feed>`;
    expect(findFirstStableRelease(xml)).toBe('1.3.1');
  });
});

describe('useUpdateCheck — integration with atom feed', () => {
  beforeEach(() => {
    localStorage.clear();
    (global as any).chrome = {
      runtime: {
        getManifest: () => ({ version: '1.3.1' }),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (global as any).fetch;
  });

  function stubFetch(status: number, body: string) {
    const fetchMock = vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      text: () => Promise.resolve(body),
    });
    (global as any).fetch = fetchMock;
    return fetchMock;
  }

  it('mounts to noRelease when atom feed is empty (fork has 0 releases)', async () => {
    stubFetch(200, FEED_EMPTY);
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('noRelease');
    });
    expect(result.current.status.kind).toBe('noRelease');
  });

  it('mounts to noRelease when feed contains only prereleases', async () => {
    stubFetch(200, FEED_PRERELEASE_ONLY);
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('noRelease');
    });
  });

  it('mounts to upToDate when installed version equals latest stable', async () => {
    stubFetch(200, FEED_MIXED);
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('upToDate');
    });
    if (result.current.status.kind === 'upToDate') {
      expect(result.current.status.latest).toBe('1.3.1');
    }
  });

  it('mounts to updateAvailable when installed is behind latest', async () => {
    (global as any).chrome.runtime.getManifest = () => ({ version: '1.2.0' });
    stubFetch(200, FEED_MIXED);
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('updateAvailable');
    });
    if (result.current.status.kind === 'updateAvailable') {
      expect(result.current.status.latest).toBe('1.3.1');
    }
  });

  it('mounts to error on 403 rate limit (button stays clickable so user can retry)', async () => {
    stubFetch(403, '{"message":"rate limit"}');
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('error');
    });
  });

  it('mounts to error on network failure', async () => {
    (global as any).fetch = vi.fn().mockRejectedValue(new TypeError('NetworkError'));
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('error');
    });
  });

  it('mounts to noRelease on 404 (defensive — repo missing)', async () => {
    stubFetch(404, '');
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('noRelease');
    });
  });

  it('uses cache: second mount within 6h does NOT call fetch', async () => {
    const fetchMock = stubFetch(200, FEED_MIXED);
    const { result, unmount } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('upToDate');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    // Second mount with same cache should not re-fetch.
    const { result: result2 } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result2.current.status.kind).toBe('upToDate');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recheck() with force=true bypasses the cache and re-fetches', async () => {
    const fetchMock = stubFetch(200, FEED_MIXED);
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => {
      expect(result.current.status.kind).toBe('upToDate');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => { result.current.recheck(); });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('caches atom feed parse result with version=3', async () => {
    stubFetch(200, FEED_MIXED);
    renderHook(() => useUpdateCheck());
    await new Promise((r) => setTimeout(r, 50));
    const raw = localStorage.getItem('cebian:updateCheck');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(3);
    expect(parsed.latest).toBe('1.3.1');
    expect(typeof parsed.checkedAt).toBe('number');
  });
});
