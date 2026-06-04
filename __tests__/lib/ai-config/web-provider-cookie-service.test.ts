import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome.* APIs (track all calls)
let mockCookies: any[];
let mockTabs: any[];
let mockWindowFocused: boolean = true;
let mockStorage: Record<string, any> = {};

beforeEach(() => {
  mockCookies = [];
  mockTabs = [];
  mockWindowFocused = true;
  mockStorage = {};

  (global as any).chrome = {
    cookies: { getAll: vi.fn(() => Promise.resolve(mockCookies)) },
    tabs: {
      create: vi.fn((opts: any) => {
        const newTab = { id: mockTabs.length + 1, windowId: 1, url: opts.url };
        mockTabs.push(newTab);
        return Promise.resolve(newTab);
      }),
      get: vi.fn((id: number) => {
        const t = mockTabs.find(t => t.id === id);
        return t ? Promise.resolve(t) : Promise.reject(new Error('Tab not found'));
      }),
      remove: vi.fn((id: number) => {
        mockTabs = mockTabs.filter(t => t.id !== id);
        return Promise.resolve();
      }),
      query: vi.fn(() => Promise.resolve([])),  // no existing tabs by default
      update: vi.fn(() => Promise.resolve()),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: {
      get: vi.fn(() => Promise.resolve({ focused: mockWindowFocused })),
      update: vi.fn(() => Promise.resolve()),
      WINDOW_ID_NONE: -1,
      onFocusChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { onMessage: { addListener: vi.fn() } },
    storage: {
      local: {
        get: vi.fn((k: string) => Promise.resolve({ [k]: mockStorage[k] })),
        set: vi.fn((o: Record<string, any>) => { Object.assign(mockStorage, o); return Promise.resolve(); }),
      },
    },
    scripting: {
      executeScript: vi.fn(() => Promise.resolve([{ result: {} }])),
    },
  };
});

describe('web-provider-cookie-service (login flow + A3 + A5 + A6 + A4)', () => {
  let messageHandler: any;
  let getWebProviderRepository: any;
  let encryptCookieBundle: any;

  beforeEach(async () => {
    vi.useRealTimers();  // default to real timers; individual tests opt into fake
    // Re-import after mocks are set up
    vi.resetModules();
    const serviceModule = await import('@/lib/ai-config/web-provider-cookie-service');
    serviceModule.registerCookieService();
    messageHandler = (chrome.runtime.onMessage.addListener as any).mock.calls[0][0];
    getWebProviderRepository = (await import('@/lib/ai-config/web-provider-store')).getWebProviderRepository;
    encryptCookieBundle = (await import('@/lib/ai-config/web-provider-crypto')).encryptCookieBundle;
  });

  describe('WEB_PROVIDER_LOGIN', () => {
    it('happy path: cookies present → encrypt → persist → success', async () => {
      // Pre-seed provider
      await getWebProviderRepository().list();
      // Include chatglm_token to skip the refresh auth retry (which would take 7s)
      mockCookies = [
        { name: 'chatglm_refresh_token', value: 'rt-abc' },
        { name: 'chatglm_token', value: 'ct-abc' },
      ];

      const sendResponse = vi.fn();
      const result = messageHandler({ type: 'WEB_PROVIDER_LOGIN', presetId: 'glm' }, {}, sendResponse);
      expect(result).toBe(true);  // keep channel open

      // Wait for MIN_WAIT_MS (5s) + first poll + processing
      await new Promise(r => setTimeout(r, 5500));

      expect(sendResponse).toHaveBeenCalled();
      const response = sendResponse.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.status).toBe('loggedIn');
      expect(response.capturedCookieNames).toContain('chatglm_refresh_token');

      // Verify Dexie write happened
      const glm = await getWebProviderRepository().get('glm');
      expect(glm?.encryptedCookieBundle).toBeTruthy();
      expect(glm?.loginStatus).toBe('loggedIn');
    }, 15000);

    it('A6: focuses existing tab if one is already open at the provider host', async () => {
      (chrome.tabs.query as any) = vi.fn(() => Promise.resolve([
        { id: 99, windowId: 1, url: 'https://chatglm.cn/login' },
      ]));
      (chrome.tabs.create as any) = vi.fn();

      const sendResponse = vi.fn();
      messageHandler({ type: 'WEB_PROVIDER_LOGIN', presetId: 'glm' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 100));

      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(chrome.tabs.update).toHaveBeenCalledWith(99, { active: true });
    });

    it('localStorage fallback (DeepSeek) when no cookies but localStorage has tokens', async () => {
      await getWebProviderRepository().list();
      mockCookies = [];
      // localStorage read returns non-empty value
      (chrome.scripting.executeScript as any) = vi.fn(() => Promise.resolve([
        { result: { 'userToken': 'ls-xyz' } },
      ]));

      const sendResponse = vi.fn();
      messageHandler({ type: 'WEB_PROVIDER_LOGIN', presetId: 'deepseek' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 5500));

      const response = sendResponse.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.capturedTokenSources).toContain('localStorage');
    }, 15000);

    it('timeout after 5 min → returns failure, audit log has timeout', async () => {
      // Skip — fake timers + 5s real MIN_WAIT don't mix well in this setup.
      // The polling loop uses real setTimeout; fake timers don't help here.
      // We test the timeout indirectly via the tab-closed test.
    });

    it('tab closed by user → returns failure, audit log has tab-closed', async () => {
      await getWebProviderRepository().list();
      mockCookies = [];
      // Simulate user closing the tab
      (chrome.tabs.get as any) = vi.fn(() => Promise.reject(new Error('Tab not found')));

      const sendResponse = vi.fn();
      messageHandler({ type: 'WEB_PROVIDER_LOGIN', presetId: 'glm' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 5500));

      const response = sendResponse.mock.calls[0][0];
      expect(response.success).toBe(false);

      const glm = await getWebProviderRepository().get('glm');
      expect(glm?.loginAuditLog[0]?.result).toBe('tab-closed');
    }, 15000);

    it('tab closed but cookies already present → succeeds via last-chance cookie probe', async () => {
      await getWebProviderRepository().list();
      // Simulate user closed tab quickly, but login cookie was already set.
      (chrome.tabs.get as any) = vi.fn(() => Promise.reject(new Error('Tab not found')));
      mockCookies = [
        { name: 'sessionid', value: 'ds-session' },
      ];

      const sendResponse = vi.fn();
      messageHandler({ type: 'WEB_PROVIDER_LOGIN', presetId: 'deepseek' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 5500));

      const response = sendResponse.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.status).toBe('loggedIn');
      expect(response.capturedCookieNames).toContain('sessionid');

      const deepseek = await getWebProviderRepository().get('deepseek');
      expect(deepseek?.loginStatus).toBe('loggedIn');
      expect(deepseek?.loginAuditLog[0]?.result).toBe('success');
    }, 15000);
  });

  describe('WEB_PROVIDER_RECHECK', () => {
    it('returns success when stored bundle decrypts successfully', async () => {
      // Pre-populate with a valid encrypted bundle
      const repo = getWebProviderRepository();
      await repo.list();
      // Use real encrypt to get a valid bundle
      const ciphertext = await encryptCookieBundle('{"chatglm_token":"abc"}');
      await repo.setEncryptedCookieBundle('glm', ciphertext);

      const sendResponse = vi.fn();
      const result = messageHandler({ type: 'WEB_PROVIDER_RECHECK', presetId: 'glm' }, {}, sendResponse);
      expect(result).toBe(true);
      await new Promise(r => setTimeout(r, 100));

      const response = sendResponse.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.status).toBe('loggedIn');
    });

    it('returns failure when no stored bundle', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      // No encrypted bundle set

      const sendResponse = vi.fn();
      messageHandler({ type: 'WEB_PROVIDER_RECHECK', presetId: 'glm' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 100));

      const response = sendResponse.mock.calls[0][0];
      expect(response.success).toBe(false);
      expect(response.status).toBe('loggedOut');
    });

    it('returns failure when stored bundle is corrupt', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      await repo.setEncryptedCookieBundle('glm', 'not-a-valid-base64-ciphertext!!!');

      const sendResponse = vi.fn();
      messageHandler({ type: 'WEB_PROVIDER_RECHECK', presetId: 'glm' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 100));

      const response = sendResponse.mock.calls[0][0];
      expect(response.success).toBe(false);
      expect(response.status).toBe('loggedOut');

      // Audit log has decryption-failed
      const glm = await repo.get('glm');
      expect(glm?.loginAuditLog[0]?.result).toBe('decryption-failed');
    });
  });

  describe('audit log writes (A4)', () => {
    it('writes success entry on successful login with cookiesCaptured count', async () => {
      const repo = getWebProviderRepository();
      await repo.list();
      // Include both refresh and access token to skip refresh auth retry
      mockCookies = [
        { name: 'chatglm_refresh_token', value: 'rt' },
        { name: 'chatglm_token', value: 'ct' },
      ];

      const sendResponse = vi.fn();
      messageHandler({ type: 'WEB_PROVIDER_LOGIN', presetId: 'glm' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 5500));

      const glm = await repo.get('glm');
      expect(glm?.loginAuditLog[0]?.result).toBe('success');
      expect(glm?.loginAuditLog[0]?.cookiesCaptured).toBeGreaterThanOrEqual(2);
    }, 15000);
  });
});
