import { describe, expect, it } from 'vitest';
import { isChromeCallAllowed, CHROME_API_WHITELIST } from '@/lib/tools/chrome-api-whitelist';

describe('isChromeCallAllowed', () => {
  it('allows whitelisted tabs methods', () => {
    expect(isChromeCallAllowed('tabs', 'query')).toBe(true);
    expect(isChromeCallAllowed('tabs', 'create')).toBe(true);
    expect(isChromeCallAllowed('tabs', 'captureVisibleTab')).toBe(true);
  });

  it('allows whitelisted windows methods', () => {
    expect(isChromeCallAllowed('windows', 'getAll')).toBe(true);
    expect(isChromeCallAllowed('windows', 'getCurrent')).toBe(true);
  });

  it('allows whitelisted bookmarks methods', () => {
    expect(isChromeCallAllowed('bookmarks', 'getTree')).toBe(true);
    expect(isChromeCallAllowed('bookmarks', 'search')).toBe(true);
  });

  it('allows whitelisted cookies methods', () => {
    expect(isChromeCallAllowed('cookies', 'getAll')).toBe(true);
    expect(isChromeCallAllowed('cookies', 'set')).toBe(true);
  });

  it('allows whitelisted downloads methods', () => {
    expect(isChromeCallAllowed('downloads', 'download')).toBe(true);
    expect(isChromeCallAllowed('downloads', 'search')).toBe(true);
  });

  it('allows whitelisted notifications methods', () => {
    expect(isChromeCallAllowed('notifications', 'create')).toBe(true);
    expect(isChromeCallAllowed('notifications', 'clear')).toBe(true);
  });

  it('allows whitelisted history methods', () => {
    expect(isChromeCallAllowed('history', 'search')).toBe(true);
    expect(isChromeCallAllowed('history', 'deleteUrl')).toBe(true);
  });

  it('allows whitelisted sessions methods', () => {
    expect(isChromeCallAllowed('sessions', 'getRecentlyClosed')).toBe(true);
    expect(isChromeCallAllowed('sessions', 'restore')).toBe(true);
  });

  it('allows whitelisted alarms methods', () => {
    expect(isChromeCallAllowed('alarms', 'create')).toBe(true);
    expect(isChromeCallAllowed('alarms', 'clearAll')).toBe(true);
  });

  it('allows whitelisted webNavigation methods', () => {
    expect(isChromeCallAllowed('webNavigation', 'getFrame')).toBe(true);
  });

  it('allows whitelisted topSites methods', () => {
    expect(isChromeCallAllowed('topSites', 'get')).toBe(true);
  });

  it('blocks unknown namespaces', () => {
    expect(isChromeCallAllowed('storage', 'get')).toBe(false);
    expect(isChromeCallAllowed('runtime', 'sendMessage')).toBe(false);
  });

  it('blocks unknown methods', () => {
    expect(isChromeCallAllowed('tabs', 'executeScript')).toBe(false);
    expect(isChromeCallAllowed('windows', 'evil')).toBe(false);
  });

  it('blocks prototype pollution attempts', () => {
    expect(isChromeCallAllowed('__proto__', 'pollute')).toBe(false);
    expect(isChromeCallAllowed('constructor', 'call')).toBe(false);
    expect(isChromeCallAllowed('prototype', 'toString')).toBe(false);
    expect(isChromeCallAllowed('tabs', '__proto__')).toBe(false);
    expect(isChromeCallAllowed('tabs', 'constructor')).toBe(false);
  });

  it('blocks dotted method paths', () => {
    expect(isChromeCallAllowed('tabs', 'query.update')).toBe(false);
    expect(isChromeCallAllowed('tabs', 'a.b.c')).toBe(false);
  });
});

describe('CHROME_API_WHITELIST', () => {
  it('contains expected namespaces', () => {
    expect(CHROME_API_WHITELIST).toHaveProperty('tabs');
    expect(CHROME_API_WHITELIST).toHaveProperty('windows');
    expect(CHROME_API_WHITELIST).toHaveProperty('bookmarks');
    expect(CHROME_API_WHITELIST).toHaveProperty('cookies');
    expect(CHROME_API_WHITELIST).toHaveProperty('downloads');
    expect(CHROME_API_WHITELIST).toHaveProperty('history');
    expect(CHROME_API_WHITELIST).toHaveProperty('alarms');
    expect(CHROME_API_WHITELIST).toHaveProperty('notifications');
    expect(CHROME_API_WHITELIST).toHaveProperty('sessions');
    expect(CHROME_API_WHITELIST).toHaveProperty('topSites');
    expect(CHROME_API_WHITELIST).toHaveProperty('webNavigation');
  });
});
