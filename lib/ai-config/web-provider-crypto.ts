/**
 * Web Crypto API AES-GCM 256 encryption for web provider cookies.
 *
 * ② fills in real implementation; MVP was a placeholder.
 *
 * Threat model:
 * - ✅ Protects against raw IndexedDB inspection (ciphertext is opaque)
 * - ✅ Origin isolation prevents other extensions from reading our Dexie
 * - ❌ Does NOT protect against stolen device + extension source access
 *   (key in chrome.storage.local is recoverable)
 * - Follow-up: PBKDF2 + user passphrase (deferred to post-⑤)
 *
 * Output format: base64(salt[16] || iv[12] || ciphertext+N[16])
 * - salt is used as additionalData (binds ciphertext to this key generation)
 * - iv is fresh per encryption
 * - ciphertext includes the 16-byte GCM auth tag at the end
 */

const KEY_STORAGE_KEY = 'web-provider-crypto-key-v1';
const KEY_ALGORITHM = { name: 'AES-GCM', length: 256 } as const;
const SALT_LENGTH = 16;   // bytes
const IV_LENGTH = 12;     // bytes (recommended for GCM)

/** Get or create the persistent key. Persisted in chrome.storage.local. */
async function getOrCreateKey(): Promise<CryptoKey> {
  const stored = await chrome.storage.local.get(KEY_STORAGE_KEY);
  const rawKeyBytes = stored[KEY_STORAGE_KEY] as number[] | undefined;
  if (rawKeyBytes && rawKeyBytes.length === 32) {
    return crypto.subtle.importKey(
      'raw',
      new Uint8Array(rawKeyBytes),
      KEY_ALGORITHM,
      false,                        // not extractable (best effort)
      ['encrypt', 'decrypt'],
    );
  }
  // First run: generate new key
  const key = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.local.set({ [KEY_STORAGE_KEY]: Array.from(new Uint8Array(raw)) });
  // Re-import as non-extractable for the in-memory handle
  return crypto.subtle.importKey('raw', raw, KEY_ALGORITHM, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt a plaintext string. Output is base64(salt + iv + ciphertext).
 * Format: [16B salt][12B iv][N B ciphertext+16B authTag]
 */
export async function encryptCookieBundle(plaintext: string): Promise<string> {
  const key = await getOrCreateKey();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: salt },
    key,
    new TextEncoder().encode(plaintext),
  );

  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

  return base64Encode(combined);
}

/**
 * Decrypt a base64-encoded bundle back to the original plaintext string.
 * Throws if the bundle is tampered (GCM auth tag mismatch).
 */
export async function decryptCookieBundle(b64: string): Promise<string> {
  const key = await getOrCreateKey();
  const combined = base64Decode(b64);
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: salt },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

/** MVP always returned false; ② actually returns true now. */
export function isEncryptionEnabled(): boolean {
  return true;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
