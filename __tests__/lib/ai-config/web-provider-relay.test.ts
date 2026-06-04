import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TabRegistry,
  getTabRegistry,
  _resetTabRegistryForTesting,
  _getTabEntryForTesting,
} from '@/lib/ai-config/web-provider-relay';
import type { WebProvider } from '@/lib/types';

let mockExistingChromeTabs: Array<{ id: number; windowId: number; url: string }> = [];
let mockCreatedTabId = 1000;

beforeEach(() => {
  _resetTabRegistryForTesting();
  mockExistingChromeTabs = [];
  mockCreatedTabId = 1000;
  (global as any).chrome = {
    tabs: {
      query: vi.fn((_opts: any) => Promise.resolve(mockExistingChromeTabs)),
      create: vi.fn((opts: any) => {
        const tab = { id: mockCreatedTabId++, windowId: 1, url: opts.url };
        mockExistingChromeTabs.push(tab);
        return Promise.resolve(tab);
      }),
      get: vi.fn((id: number) => {
        const t = mockExistingChromeTabs.find(t => t.id === id);
        return t ? Promise.resolve(t) : Promise.reject(new Error('Tab not found'));
      }),
      remove: vi.fn((id: number) => {
        mockExistingChromeTabs = mockExistingChromeTabs.filter(t => t.id !== id);
        return Promise.resolve();
      }),
      update: vi.fn(() => Promise.resolve()),
    },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
});

afterEach(() => {
  _resetTabRegistryForTesting();
});

describe('TabRegistry (T6: ③+④ tab reuse + 5min auto-close)', () => {
  describe('openOrReuseTab', () => {
    it('creates a new tab when no Chrome tab and no registry entry exists', async () => {
      const reg = new TabRegistry();
      const tabId = await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(tabId).toBe(1000);
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://chatglm.cn', active: false });
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(1000);
    });

    it('reuses existing registry entry on second call (no new chrome.tabs.create)', async () => {
      const reg = new TabRegistry();
      const t1 = await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      const createCallsBefore = (chrome.tabs.create as any).mock.calls.length;
      const t2 = await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(t2).toBe(t1);
      expect((chrome.tabs.create as any).mock.calls.length).toBe(createCallsBefore);
    });

    it('reuses existing Chrome tab at same hostname when registry is cold (cold-start path)', async () => {
      mockExistingChromeTabs = [{ id: 99, windowId: 1, url: 'https://chatglm.cn/already-open' }];
      const reg = new TabRegistry();
      const tabId = await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(tabId).toBe(99);
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(99);
    });
  });

  describe('markUsed', () => {
    it('markUsed creates a fresh close timer (proves the timer was reset)', async () => {
      const reg = new TabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      const beforeTimerId = _getTabEntryForTesting(reg, 'glm' as WebProvider['presetId'])!.closeTimerId;
      reg.markUsed('glm' as WebProvider['presetId']);
      const afterTimerId = _getTabEntryForTesting(reg, 'glm' as WebProvider['presetId'])!.closeTimerId;
      // markUsed calls clearTimeout(before) + setTimeout(new) → new handle ≠ old handle
      expect(afterTimerId).not.toBe(beforeTimerId);
    });

    it('markUsed is a no-op for unknown provider', () => {
      const reg = new TabRegistry();
      expect(() => reg.markUsed('kimi' as WebProvider['presetId'])).not.toThrow();
    });
  });

  describe('closeTab', () => {
    it('removes the tab and clears registry state', async () => {
      const reg = new TabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      await reg.closeTab('glm' as WebProvider['presetId']);
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBeUndefined();
      expect(chrome.tabs.remove).toHaveBeenCalledWith(1000);
    });

    it('is a no-op for unknown provider', async () => {
      const reg = new TabRegistry();
      await reg.closeTab('kimi' as WebProvider['presetId']);  // should not throw
      expect(chrome.tabs.remove).not.toHaveBeenCalled();
    });

    it('swallows chrome.tabs.remove error if tab already closed', async () => {
      const reg = new TabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      (chrome.tabs.remove as any) = vi.fn(() => Promise.reject(new Error('Tab not found')));
      await expect(reg.closeTab('glm' as WebProvider['presetId'])).resolves.not.toThrow();
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBeUndefined();
    });
  });

  describe('getTab', () => {
    it('returns undefined for unknown provider', () => {
      const reg = new TabRegistry();
      expect(reg.getTab('kimi' as WebProvider['presetId'])).toBeUndefined();
    });

    it('returns the tabId for a known provider', async () => {
      const reg = new TabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(1000);
    });
  });

  describe('5min auto-close (T6 core feature)', () => {
    it('auto-closes the tab after idleCloseMs', async () => {
      _resetTabRegistryForTesting({ idleCloseMs: 100 });
      const reg = getTabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(1000);
      // Wait > idleCloseMs
      await new Promise(r => setTimeout(r, 150));
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBeUndefined();
      expect(chrome.tabs.remove).toHaveBeenCalledWith(1000);
    });

    it('markUsed within idle window prevents auto-close', async () => {
      _resetTabRegistryForTesting({ idleCloseMs: 100 });
      const reg = getTabRegistry();
      await reg.openOrReuseTab('glm' as WebProvider['presetId'], 'https://chatglm.cn');
      // Use it again before timeout
      setTimeout(() => reg.markUsed('glm' as WebProvider['presetId']), 50);
      // Wait past original timeout
      await new Promise(r => setTimeout(r, 150));
      expect(reg.getTab('glm' as WebProvider['presetId'])).toBe(1000);
    });
  });
});
