/**
 * Encryption placeholder for web provider cookie bundles.
 *
 * MVP: all methods throw or return false. Real AES-GCM via Web Crypto API
 *       is reserved for ② (real cookie extraction).
 *
 * The public surface is defined here so call sites compile today;
 * ② will fill in real implementations without changing any caller.
 */

const NOT_IMPLEMENTED = 'web-provider-crypto: not implemented in MVP';

export async function encryptCookieBundle(_bundle: string): Promise<string> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function decryptCookieBundle(_ciphertext: string): Promise<string> {
  throw new Error(NOT_IMPLEMENTED);
}

export function isEncryptionEnabled(): boolean {
  return false;
}
