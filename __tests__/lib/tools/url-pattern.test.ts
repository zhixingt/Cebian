import { describe, expect, it } from 'vitest';
import {
  parseMatchPattern,
  formatMatchPattern,
  matchUrl,
  parseBgFetchPatterns,
  type MatchPattern,
} from '@/lib/tools/url-pattern';

describe('parseMatchPattern', () => {
  it('parses <all_urls>', () => {
    const p = parseMatchPattern('<all_urls>');
    expect(p.isAllUrls).toBe(true);
    expect(p.scheme).toBe('*');
    expect(p.host).toBe('*');
    expect(p.pathGlob).toBe('/*');
    expect(p.pathRe.test('/anything')).toBe(true);
  });

  it('parses *://*/*', () => {
    const p = parseMatchPattern('*://*/*');
    expect(p.scheme).toBe('*');
    expect(p.host).toBe('*');
    expect(p.pathGlob).toBe('/*');
  });

  it('parses https://example.com/*', () => {
    const p = parseMatchPattern('https://example.com/*');
    expect(p.scheme).toBe('https');
    expect(p.host).toBe('example.com');
    expect(p.pathGlob).toBe('/*');
  });

  it('parses http://*.foo.com/path/*', () => {
    const p = parseMatchPattern('http://*.foo.com/path/*');
    expect(p.scheme).toBe('http');
    expect(p.host).toBe('*.foo.com');
    expect(p.pathGlob).toBe('/path/*');
  });

  it('normalizes scheme to lowercase', () => {
    const p = parseMatchPattern('HTTPS://EXAMPLE.COM/*');
    expect(p.scheme).toBe('https');
    expect(p.host).toBe('example.com');
  });

  it('throws on malformed pattern', () => {
    expect(() => parseMatchPattern('bad')).toThrow(/malformed pattern/);
    expect(() => parseMatchPattern('ftp://example.com/*')).toThrow(/unsupported scheme/);
  });

  it('throws on invalid host', () => {
    expect(() => parseMatchPattern('https://exa@mple.com/*')).toThrow(/invalid host/);
  });
});

describe('formatMatchPattern', () => {
  it('round-trips all_urls', () => {
    const p = parseMatchPattern('<all_urls>');
    expect(formatMatchPattern(p)).toBe('<all_urls>');
  });

  it('round-trips normal pattern', () => {
    const p = parseMatchPattern('https://example.com/*');
    expect(formatMatchPattern(p)).toBe('https://example.com/*');
  });
});

describe('matchUrl', () => {
  it('matches exact host and path', () => {
    const p = parseMatchPattern('https://example.com/*');
    expect(matchUrl(new URL('https://example.com/'), p)).toBe(true);
    expect(matchUrl(new URL('https://example.com/foo'), p)).toBe(true);
  });

  it('rejects wrong scheme', () => {
    const p = parseMatchPattern('https://example.com/*');
    expect(matchUrl(new URL('http://example.com/'), p)).toBe(false);
  });

  it('rejects wrong host', () => {
    const p = parseMatchPattern('https://example.com/*');
    expect(matchUrl(new URL('https://other.com/'), p)).toBe(false);
  });

  it('matches wildcard scheme for http and https', () => {
    const p = parseMatchPattern('*://example.com/*');
    expect(matchUrl(new URL('http://example.com/'), p)).toBe(true);
    expect(matchUrl(new URL('https://example.com/'), p)).toBe(true);
    expect(matchUrl(new URL('ftp://example.com/'), p)).toBe(false);
  });

  it('matches subdomain wildcard', () => {
    const p = parseMatchPattern('https://*.foo.com/*');
    expect(matchUrl(new URL('https://foo.com/'), p)).toBe(true);
    expect(matchUrl(new URL('https://bar.foo.com/'), p)).toBe(true);
    expect(matchUrl(new URL('https://baz.bar.foo.com/'), p)).toBe(true);
    expect(matchUrl(new URL('https://notfoo.com/'), p)).toBe(false);
  });

  it('matches exact path', () => {
    const p = parseMatchPattern('https://example.com/api/*');
    expect(matchUrl(new URL('https://example.com/api/v1'), p)).toBe(true);
    expect(matchUrl(new URL('https://example.com/other'), p)).toBe(false);
  });

  it('matches all_urls against any http(s)', () => {
    const p = parseMatchPattern('<all_urls>');
    expect(matchUrl(new URL('https://any.host/path'), p)).toBe(true);
  });
});

describe('parseBgFetchPatterns', () => {
  it('returns null when no bgFetch permissions', () => {
    expect(parseBgFetchPatterns(['read_page', 'interact'])).toBeNull();
  });

  it('parses bare bgFetch as wildcard', () => {
    const ps = parseBgFetchPatterns(['bgFetch']);
    expect(ps).toHaveLength(1);
    expect(ps![0].scheme).toBe('*');
    expect(ps![0].host).toBe('*');
  });

  it('parses bgFetch:pattern', () => {
    const ps = parseBgFetchPatterns(['bgFetch:https://api.example.com/*']);
    expect(ps).toHaveLength(1);
    expect(ps![0].scheme).toBe('https');
    expect(ps![0].host).toBe('api.example.com');
  });

  it('throws on invalid pattern', () => {
    expect(() => parseBgFetchPatterns(['bgFetch:bad'])).toThrow(/Invalid bgFetch permission/);
  });
});
