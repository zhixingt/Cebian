import { describe, it, expect } from 'vitest';
import {
  encryptCookieBundle,
  decryptCookieBundle,
  isEncryptionEnabled,
} from '@/lib/ai-config/web-provider-crypto';

describe('web-provider-crypto (MVP placeholder)', () => {
  it('isEncryptionEnabled returns false', () => {
    expect(isEncryptionEnabled()).toBe(false);
  });

  it('encryptCookieBundle throws not implemented', async () => {
    await expect(encryptCookieBundle('any-string')).rejects.toThrow(
      /not implemented in MVP/i,
    );
  });

  it('decryptCookieBundle throws not implemented', async () => {
    await expect(decryptCookieBundle('any-string')).rejects.toThrow(
      /not implemented in MVP/i,
    );
  });
});
