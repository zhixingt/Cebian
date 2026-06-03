import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptCookieBundle, decryptCookieBundle, isEncryptionEnabled } from '@/lib/ai-config/web-provider-crypto';

// Mock chrome.storage.local for key persistence
let mockStorage: Record<string, any> = {};

beforeEach(() => {
  mockStorage = {};
  (global as any).chrome = {
    storage: {
      local: {
        get: vi.fn((k: string) => Promise.resolve({ [k]: mockStorage[k] })),
        set: vi.fn((o: Record<string, any>) => { Object.assign(mockStorage, o); return Promise.resolve(); }),
      },
    },
  };
});

describe('web-provider-crypto (② AES-GCM 256)', () => {
  it('encrypt then decrypt returns original plaintext', async () => {
    const plaintext = JSON.stringify({ 'chatglm_token': 'abc123' });
    const ciphertext = await encryptCookieBundle(plaintext);
    const decrypted = await decryptCookieBundle(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('ciphertext is NOT plaintext (base64, not the original string)', async () => {
    const plaintext = 'secret-cookie-value';
    const ciphertext = await encryptCookieBundle(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);  // base64 alphabet
  });

  it('output structure: 16B salt + 12B iv + ciphertext (>= 28 bytes total)', async () => {
    const ciphertext = await encryptCookieBundle('x');
    const bytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    expect(bytes.length).toBeGreaterThanOrEqual(16 + 12 + 1);  // minimal plaintext
    // Check first 16 bytes look like salt (random), next 12 look like iv (random)
    expect(bytes.length).toBeGreaterThan(28);
  });

  it('decryption with tampered ciphertext throws', async () => {
    const ciphertext = await encryptCookieBundle('x');
    const bytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    // Flip a bit in the auth tag (last byte)
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptCookieBundle(tampered)).rejects.toThrow();
  });

  it('first call auto-creates and persists the key in chrome.storage.local', async () => {
    await encryptCookieBundle('x');
    expect(chrome.storage.local.set).toHaveBeenCalled();
    expect(Object.keys(mockStorage)).toContain('web-provider-crypto-key-v1');
    expect(mockStorage['web-provider-crypto-key-v1']).toHaveLength(32);  // 256 bits = 32 bytes
  });

  it('reuses key across calls (not regenerated)', async () => {
    await encryptCookieBundle('a');
    const key1 = mockStorage['web-provider-crypto-key-v1'];
    await encryptCookieBundle('b');
    const key2 = mockStorage['web-provider-crypto-key-v1'];
    expect(key1).toEqual(key2);
  });

  it('handles empty string', async () => {
    const ciphertext = await encryptCookieBundle('');
    expect(await decryptCookieBundle(ciphertext)).toBe('');
  });

  it('handles unicode (Chinese characters)', async () => {
    const plaintext = '{"name":"智谱","url":"https://chatglm.cn"}';
    const ciphertext = await encryptCookieBundle(plaintext);
    expect(await decryptCookieBundle(ciphertext)).toBe(plaintext);
  });
});

describe('isEncryptionEnabled', () => {
  it('returns true (MVP was false; ② fills in real implementation)', () => {
    expect(isEncryptionEnabled()).toBe(true);
  });
});
