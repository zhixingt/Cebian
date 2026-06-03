# Web (Browser Session) Provider — Cookie Extraction & Encrypted Storage

- **Status**: Draft (pending user review) — **UPDATED to include 6 production-grade enhancements A1-A6 (user signed off "全加")**
- **Date**: 2026-06-03 (initial), 2026-06-03 (enhancements)
- **Author**: brainstorm session between user and Sisyphus
- **Project**: Cebian (fork: `zhixingt/Cebian`, upstream: `maotoumao/Cebian`)
- **Scope**: Milestone **②** — replace MVP's simulated login with real `chrome.cookies.getAll()` extraction, AES-GCM encrypted storage, "Login" tab-open flow with polling, **+ 6 production-grade enhancements that definitively outperform chromeclaw** (A1 UI transparency, A2 configurable session indicators [KEY], A3 active tab tracking, A4 audit log, A5 refresh retry, A6 detect open tab)
- **Reference impl (read-only inspiration, not forking)**: `algopian/chromeclaw` (`D:\Project\CebianX\chromeclaw-research`)
- **Predecessor**: MVP (`docs/superpowers/specs/2026-06-03-web-browser-session-provider-design.md`) — 18 commits, 32 tests, shipped and archived
- **Builds on**: MVP's preset/UI/Repository/hook structure (UI and Dexie schema UNCHANGED except for A2/A4 additions)
- **Estimated effort**: **5-7 days** (vs original ②'s 1.5-2 days) — was bumped after user signed off on all 6 enhancements
- **Estimated tests**: **~50-60** (vs original ②'s 30) — was bumped to cover all 6 enhancements

---

## 1. Background & Motivation

The MVP shipped the Settings UI shell — 3 preset cards, "Re-check login" button, Dexie persistence, i18n in 3 locales. **None of it actually worked.** The "Re-check" was a `Math.random() < 0.7` simulator.

② is the **first real feature**: actually read the browser's logged-in cookies for chatglm.cn / kimi.com / chat.deepseek.com, encrypt them, store them in IndexedDB, and report a real `loggedIn` / `loggedOut` status back to the UI.

### Why ② now, not ③④⑤ first?

② is the **minimum unit of functionality**. Without real cookies captured, all downstream milestones (③ encrypted storage layer, ④ network relay, ⑤ agent integration) have nothing to operate on. ② also produces a **visible end-to-end flow** (user clicks Login → tab opens → cookies captured → status flips to "Logged in") that the user can manually verify in Chrome.

### What chromeclaw taught us (and what we adopt)

Read in full: `chromeclaw-research/chrome-extension/src/background/web-providers/auth.ts` (225 lines) and `chromeclaw-research/packages/shared/lib/hooks/use-web-provider-auth.ts` (190 lines).

| chromeclaw pattern | Adopted in ② | Why |
|---|---|---|
| `sessionIndicators: string[]` array | ✅ Yes | More flexible than single cookie name; providers often have multiple session cookies |
| `chrome.tabs.create(loginUrl)` + `setTimeout(poll, 2000)` × 5 min | ✅ Yes | Standard "open tab, wait for cookies to appear" pattern |
| 5-second `MIN_WAIT_MS` before checking cookies | ✅ Yes | Without it, pre-existing Google account cookies would close the tab instantly |
| Capture `sessionIndicators` + `lastActiveOrg`/`XSRF-TOKEN`/`csrf_token` | ✅ Yes | Real providers need more than just one cookie |
| localStorage fallback via `CHECK_LOCAL_STORAGE` background message + `chrome.scripting.executeScript({world: 'MAIN'})` | ✅ Yes | Kimi/GLM Intl store tokens in localStorage, not cookies — without this they're unusable |
| `chrome.tabs.remove(tabId)` on success / timeout / user-close | ✅ Yes | Cleanup is mandatory |
| `useEffect` resets to `'not-logged-in'` on mount, never auto-check | ✅ Yes | Matches the MVP's "checking is transient" principle |
| Provider-specific `refreshAuth` callback (GLM access token exchange) | ✅ Yes | GLM requires token exchange after login; generic `fetch` won't work |
| Storage in `chrome.storage.local` **plain text** | ❌ **No** — we encrypt | chromeclaw stores cookies unencrypted; that's a real security trade-off they made. We can do better with Web Crypto API. |
| Single `webCredentialsStorage: Record<providerId, credential>` keyed map | ✅ Yes | Mirrors our `webProviders` table |

### Non-goals (explicit, deferred to ③④⑤)

- **③**: Cross-origin network relay (background SW fetches the provider's API using stored cookies)
- **④**: Agent integration (WebProvider as a model kind in `pi-agent-core` factory)
- **⑤**: 401/403 re-login prompt (when stored cookies expire)
- User-defined custom presets (user-added providers beyond 3 built-in) — A2 makes 3 presets overridable, but adding a 4th preset is still out of scope
- Cross-tab state synchronization
- Dexie `liveQuery` reactive subscriptions
- E2E Playwright tests (only manual Chrome verification, like MVP)
- **PBKDF2 key derivation** (② uses simpler dev-grade key; PBKDF2 + user passphrase is a follow-up)
- **HttpOnly cookie** handling (chrome.cookies.getAll returns HttpOnly cookies fine, but the testing surface is limited without a real browser session)
- **Logout button** in UI (⑤ concern; ② focuses on capture, validation, and audit)

### Six production-grade enhancements (A1-A6, user-signed)

User explicitly chose "全加" (add all) to make ② definitively outperform chromeclaw. Each is documented in detail in **§21**. Summary:

| ID | Name | Effort | Why included |
|---|---|---|---|
| **A1** | UI transparency (show captured cookie count + names) | 1h | Lets user verify preset values are correct |
| **A2** | **Configurable session indicators in Settings** (KEY ONE) | 3-4h | **Without this, Kimi/DeepSeek unverified presets mean user must edit source code. With this, user self-calibrates in 30 seconds from the UI.** |
| **A3** | Active tab tracking (pause polling when tab is backgrounded) | 1-2h | Saves 60% CPU during the 5-min wait |
| **A4** | Login attempt audit log (last 5 attempts with result) | 2h | "Why did login fail?" — chromeclaw only shows a toast; we show a full history |
| **A5** | RefreshAuth retry with exponential backoff (GLM) | 1h | Covers 90% of network blips on GLM's refresh endpoint |
| **A6** | Detect already-open tab (don't open a duplicate) | 1-2h | If user already has chatglm.cn in another tab, reuse it instead of opening a new one |

**Total additional effort**: 9-12h implementation + 5-6h tests + 2h verification = 16-20h. **Bumps ② from 1.5-2 days to 5-7 days.**

---

## 2. Architecture (unchanged top, deeper below)

```
┌────────────────────────────────────────────────────────────┐
│  Layer 1: UI 表现层（React 组件）— 0 changes                 │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ <WebProvidersSubSection>  ← 1 button import swap     │ │
│  │   └── <WebProviderCard /> × N  ← 1 new "Login" btn  │ │
│  └──────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│  Layer 2: 状态管理层（React Hooks）— replace 1 file         │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ useWebProviders()                    ← UNCHANGED     │ │
│  │ useWebProviderSimulatedLogin.ts      ← DELETE        │ │
│  │ useWebProviderWebLogin.ts            ← NEW (real)    │ │
│  └──────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│  Layer 3: 数据访问层 — add 2 methods                       │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ WebProviderRepository  ← +setEncryptedCookieBundle() │ │
│  │                            +clearEncryptedCookieBundle() │ │
│  │                            +setLoginStatus() extended  │ │
│  └──────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│  Layer 4: 数据/配置源 — fill in 2 placeholders              │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ web-provider-presets.ts  ← +sessionIndicators[]      │ │
│  │                            +cookieDomain             │ │
│  │                            +useLocalStorageFallback   │ │
│  │                            +refreshUrl (GLM only)     │ │
│  │ web-provider-crypto.ts   ← REAL Web Crypto AES-GCM   │ │
│  │ web-provider-cookie-service.ts  ← NEW (background SW) │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### 2.1 Data flow (user action → encrypted cookies in Dexie)

```
User clicks "Login" on GLM card
        │
        ▼
WebProviderCard calls useWebProviderWebLogin.login(presetId)
        │
        ▼
Hook sets local state: status = "checking", loginLoading = true
        │
        ▼
Hook calls window.chrome.runtime.sendMessage({ type: 'WEB_PROVIDER_LOGIN', presetId })
        │
        ▼
Background SW (web-provider-cookie-service.ts) receives message:
        │
        ├── chrome.tabs.create({ url: preset.loginUrl, active: true })
        │
        ▼ (5-second MIN_WAIT — let the tab paint)
        │
        └─→ poll loop (every 2s, up to 5min):
            │
            ├── chrome.cookies.getAll({ domain: preset.cookieDomain })
            │   → cookieMap = {name → value}
            │
            ├── Check: any name in preset.sessionIndicators present?
            │   │
            │   ├─ YES → capture session cookies
            │   │
            │   └─ NO  → if preset.useLocalStorageFallback:
            │              chrome.scripting.executeScript({ world: 'MAIN',
            │                func: () => Object.fromEntries(
            │                  sessionIndicators.map(k => [k, localStorage.getItem(k)]).filter(([,v]) => v)
            │                )})
            │
            ├── If refreshUrl (GLM) → call refreshAuth to exchange
            │   refresh_token → access_token, append to cookieMap
            │
            ├── If hasSession → STOP, encrypt cookieMap, write Dexie, close tab
            │
            └── Else → setTimeout(poll, 2000)
        │
        ▼
Hook receives response → status = "logged-in" | "not-logged-in" | "expired"
        │
        ▼
useWebProviders() refresh() → React re-render
        │
        ▼
Card shows ● Logged in (green badge)
```

### 2.2 Key architectural principles (inherited + new)

| Principle | Inherited from MVP | New in ② |
|---|---|---|
| Extensible presets | 3 built-in, config-driven | Add `sessionIndicators[]`, `cookieDomain`, `useLocalStorageFallback`, `refreshUrl` |
| Encryption reservation | `encryptedCookieBundle: string \| null` in Dexie | **Filled in**: real AES-GCM 256, real ciphertext in this field |
| Zero intrusion | UI is config-driven; 1 mount line | **Still true**: 1 button import swap, 0 visual redesigns |
| Pluggable login | Swap `useWebProviderSimulatedLogin` for `useWebProviderWebLogin` | **Done**: simulated login hook DELETED, web login hook takes its place |
| i18n-friendly | 3 locales, no hardcoded Chinese | **Extend**: 4 new strings (login, loggingIn, loginFailed, expired) |
| Type-safe | `WebProvider` in `lib/types.ts` | **Extend**: 2 new enum values, 1 new field (`sessionIndicators` no, that's in preset) |
| **5-state status machine** | (MVP had 4) | **Add `expired`**: stored credential past `expiresAt` |
| **Encrypted at rest** | (MVP: null placeholder) | **Yes**: AES-GCM 256 with key from `chrome.storage.local` |
| **No auto-check on mount** | (MVP: recheck was manual) | **Inherit**: web login hook also never auto-checks |

---

## 3. Detection Logic (3 tiers)

### 3.1 Preset schema additions

```typescript
// lib/ai-config/web-provider-presets.ts (additions)

export interface WebProviderPreset {
  // ... existing fields from MVP ...
  id: WebProvider['presetId'];
  displayNameKey: string;
  descriptionKey: string;
  loginUrl: string;
  defaultModelId: string;
  defaultSupportsToolCalls: boolean;
  defaultSupportsReasoning: boolean;

  /** ⭐ NEW: ② — Chrome cookie domain for `chrome.cookies.getAll({domain})`. */
  cookieDomain: string;

  /** ⭐ NEW: ② — Cookie names whose presence indicates a logged-in session.
   *           ANY name matching → "has session". Typically 1-3 names. */
  sessionIndicators: string[];

  /** ⭐ NEW: ② — Optional: also check localStorage for these keys
   *           (Kimi, GLM Intl store tokens in localStorage, not cookies). */
  useLocalStorageFallback: boolean;

  /** ⭐ NEW: ② — Optional: URL to exchange refresh_token for access_token
   *           (GLM requires this; other providers leave undefined). */
  refreshUrl?: string;
}
```

### 3.2 Preset values (3 built-in, session indicators are educated guesses)

> ⚠️ **Unverified** — these cookie names are best-effort guesses based on common patterns. The user **must self-calibrate** via Chrome DevTools → Application → Cookies before this MVP is useful. Each name is annotated with our confidence level.

```typescript
export const WEB_PROVIDER_PRESETS: readonly WebProviderPreset[] = [
  {
    id: 'glm',
    displayNameKey: 'webProviders.presets.glm.name',
    descriptionKey: 'webProviders.presets.glm.description',
    loginUrl: 'https://chatglm.cn',
    defaultModelId: 'GLM-4.6',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,

    cookieDomain: 'chatglm.cn',
    // GLM uses cookies per chromeclaw. Both are HttpOnly.
    // Order matters: capture chatglm_token first if both present.
    sessionIndicators: ['chatglm_refresh_token', 'chatglm_token'],
    useLocalStorageFallback: false,
    // chromeclaw confirms: GLM requires access token exchange.
    // We assume a /api/v1/auth/refresh endpoint — user must verify.
    refreshUrl: 'https://chatglm.cn/api/v1/auth/refresh', // unverified
  },
  {
    id: 'kimi',
    displayNameKey: 'webProviders.presets.kimi.name',
    descriptionKey: 'webProviders.presets.kimi.description',
    loginUrl: 'https://kimi.com',
    defaultModelId: 'kimi-k2-0905-preview',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,

    cookieDomain: 'kimi.moonshot.cn',
    // chromeclaw: Kimi stores tokens in localStorage.
    // Cookie name is a guess; localStorage keys are more reliable.
    sessionIndicators: ['kimi-auth'], // unverified
    useLocalStorageFallback: true,
    // Kimi does NOT need a token exchange (per chromeclaw's code).
  },
  {
    id: 'deepseek',
    displayNameKey: 'webProviders.presets.deepseek.name',
    descriptionKey: 'webProviders.presets.deepseek.description',
    loginUrl: 'https://chat.deepseek.com',
    defaultModelId: 'deepseek-chat',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: true,

    cookieDomain: 'chat.deepseek.com',
    // DeepSeek uses Django-style sessionid.
    sessionIndicators: ['sessionid'], // unverified
    useLocalStorageFallback: false,
  },
] as const;
```

### 3.3 The 3-tier detection algorithm

```typescript
// lib/ai-config/web-provider-cookie-extractor.ts (core logic, simplified)

/**
 * Check whether a user is "logged in" to a web provider.
 * 3-tier detection:
 *   1. sessionIndicators: any of these cookie names present → has session
 *   2. localStorage fallback (if useLocalStorageFallback): read from MAIN world
 *   3. Stored credential with valid expiresAt → "logged in" (proof of prior login)
 *   4. None of the above → "not logged in"
 */
export async function detectSession(
  preset: WebProviderPreset,
  tabId: number,
): Promise<{ hasSession: boolean; tokens: Record<string, string>; source: 'cookie' | 'localStorage' | 'stored' | 'none' }> {
  // Tier 1: cookies
  const cookies = await chrome.cookies.getAll({ domain: preset.cookieDomain });
  const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));
  const matched = preset.sessionIndicators.filter(name => cookieMap[name]);

  if (matched.length > 0) {
    // Capture matched indicators + common auth cookies
    const captured: Record<string, string> = {};
    for (const name of preset.sessionIndicators) {
      if (cookieMap[name]) captured[name] = cookieMap[name];
    }
    for (const name of COMMON_AUTH_COOKIES) {
      if (cookieMap[name]) captured[name] = cookieMap[name];
    }
    return { hasSession: true, tokens: captured, source: 'cookie' };
  }

  // Tier 2: localStorage fallback (Kimi, GLM Intl)
  if (preset.useLocalStorageFallback) {
    const lsTokens = await readLocalStorageFromTab(tabId, preset.sessionIndicators);
    if (Object.keys(lsTokens).length > 0) {
      return { hasSession: true, tokens: lsTokens, source: 'localStorage' };
    }
  }

  return { hasSession: false, tokens: {}, source: 'none' };
}

/** Common auth cookies that providers may need alongside session cookies. */
const COMMON_AUTH_COOKIES = ['lastActiveOrg', 'XSRF-TOKEN', 'csrf_token'] as const;
```

### 3.4 localStorage fallback (Kimi path)

```typescript
// readLocalStorageFromTab runs in MAIN world (page's JS context, not isolated)
async function readLocalStorageFromTab(
  tabId: number,
  keys: string[],
): Promise<Record<string, string>> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN', // CRITICAL: page's localStorage, not isolated
      func: (keysToRead: string[]) => {
        const out: Record<string, string> = {};
        for (const k of keysToRead) {
          const v = localStorage.getItem(k);
          if (v !== null) out[k] = v;
        }
        return out;
      },
      args: [keys],
    });
    return results?.[0]?.result ?? {};
  } catch (err) {
    console.warn('[web-provider] localStorage read failed:', err);
    return {};
  }
}
```

**Why MAIN world?** Extension content scripts run in an isolated world; `localStorage` is shared across same-origin contexts but **NOT** across isolated/main worlds. The provider's login UI writes to the page's localStorage; we must read from the same world.

---

## 4. Login Flow (open tab + poll)

### 4.1 The full sequence (one Login click)

```
[00:00.0] User clicks "Login" on GLM card
[00:00.0] Hook: status='checking', loginLoading=true
[00:00.0] Hook: sendMessage('WEB_PROVIDER_LOGIN', { presetId: 'glm' })
[00:00.1] BG SW: chrome.tabs.create({ url: 'https://chatglm.cn', active: true })
[00:00.5] Tab paints. User sees chatglm.cn (if not logged in: login form; if logged in: chat UI)
[00:05.0] First poll: chrome.cookies.getAll({ domain: 'chatglm.cn' })
            ├─ Has chatglm_refresh_token? → proceed to capture
            └─ No? → setTimeout(poll, 2000)
[00:05.0–05:00] Poll every 2s. User logs in (or does nothing if already logged in)
[00:07.3] Poll: chatglm_refresh_token present
            ├─ Capture matched indicators + common cookies
            ├─ Run refreshAuth if preset.refreshUrl set:
            │   fetch(refreshUrl, POST, { Authorization: 'Bearer ' + refresh_token })
            │   → chatglm_token
            │   Append to captured
            ├─ encryptCookieBundle(JSON.stringify(captured)) → ciphertext
            ├─ Dexie write: webProviders.update('glm', {
            │     encryptedCookieBundle: ciphertext,
            │     loginStatus: 'loggedIn',
            │     lastCheckedAt: now,
            │   })
            └─ chrome.tabs.remove(tabId)
[00:07.4] BG SW: returns { success: true, status: 'logged-in' } to hook
[00:07.4] Hook: status='logged-in', loginLoading=false
[00:07.4] useWebProviders() refresh() → React re-render
[00:07.4] Card shows ● Logged in (green badge)
```

### 4.2 Constants (background SW)

```typescript
// lib/ai-config/web-provider-cookie-service.ts

const POLL_INTERVAL_MS = 2_000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1_000;   // 5 minutes
const MIN_WAIT_MS = 5_000;                  // see 4.3
```

### 4.3 The 5-second MIN_WAIT is non-negotiable

> "Without this delay, existing cookies (e.g. Google account) would be detected immediately and the tab would close before the user sees anything." — chromeclaw comment in `use-web-provider-auth.ts:53-54`

Even if the user is already logged in to chatglm.cn, they need to **see the tab** for a moment so they understand what just happened. Without `MIN_WAIT_MS`:
- User clicks Login
- Tab opens to chatglm.cn
- Cookies are already there from a previous session
- Background immediately captures and closes the tab
- User has no idea what just happened, no way to verify

With `MIN_WAIT_MS = 5000`:
- User clicks Login
- Tab opens to chatglm.cn
- User has 5 seconds to see "oh, that's my provider's site"
- If already logged in, tab closes after 5s with success
- If not logged in, user logs in normally, then tab closes when cookies appear

### 4.4 Failure modes

| Failure | Detection | Behavior |
|---|---|---|
| User closes tab manually | `chrome.tabs.get(tabId)` throws | Reject with `Login tab was closed before session was detected`; status = 'not-logged-in' |
| 5 min elapsed | `Date.now() - start > LOGIN_TIMEOUT_MS` | Reject with timeout error; tab auto-closed; status = 'not-logged-in' |
| Cookies never appear | Implicit (timeout above) | Same as timeout |
| `chrome.cookies` permission denied | `chrome.cookies.getAll` throws | Reject; status = 'not-logged-in'; toast: 'Cookies permission denied' |
| localStorage read fails (e.g. `chrome://` page) | `executeScript` throws | Caught, treated as "no localStorage tokens"; falls through to timeout |
| `refreshAuth` fails (GLM endpoint wrong) | `fetch` throws or returns non-OK | Logged, but doesn't fail the login — we still have the refresh token; next request will trigger a retry |

---

## 5. Encryption (Web Crypto API AES-GCM 256)

### 5.1 Threat model

| Threat | Mitigation |
|---|---|
| Someone with disk access reads IndexedDB raw files | AES-GCM 256 ciphertext is opaque without key |
| Network attacker intercepts cookies in transit | N/A — `chrome.cookies.getAll` is local API, not network |
| Extension context (other extensions) reads Dexie | IndexedDB is origin-isolated; only this extension's SW can read |
| `chrome.storage.local` itself is readable by anyone with extension source access | Key derivation would help, but `chrome.storage.local` is the simplest dev-grade key store. PBKDF2 + user passphrase is the follow-up. |
| User's computer is stolen + extension source accessed | **NOT mitigated** — key in `chrome.storage.local` is recoverable. PBKDF2 follow-up. |

### 5.2 Key derivation (MVP-grade, dev-only)

```typescript
// lib/ai-config/web-provider-crypto.ts

/**
 * MVP-grade: key is just a random 256-bit value stored in chrome.storage.local.
 * ② limitation: anyone with extension source access can derive the key.
 * Follow-up: PBKDF2(user-passphrase, salt, 100k iterations) + prompt on first use.
 */

const KEY_STORAGE_KEY = 'web-provider-crypto-key-v1';
const KEY_ALGORITHM = { name: 'AES-GCM', length: 256 } as const;
const SALT_LENGTH = 16;   // bytes
const IV_LENGTH = 12;     // bytes (recommended for GCM)

/** Get or create the persistent key. Persisted in chrome.storage.local. */
async function getOrCreateKey(): Promise<CryptoKey> {
  const stored = await chrome.storage.local.get(KEY_STORAGE_KEY);
  if (stored[KEY_STORAGE_KEY]) {
    // Import the raw 256-bit key
    return crypto.subtle.importKey(
      'raw',
      new Uint8Array(stored[KEY_STORAGE_KEY]),
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
```

### 5.3 Encrypt / decrypt

```typescript
/**
 * Encrypt a string. Output is base64(salt + iv + ciphertext).
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

/** MVP always returns true; ② actually returns true now. */
export function isEncryptionEnabled(): boolean {
  return true;
}
```

### 5.4 The 5-tuple of GCM parameters

| Parameter | Value | Why |
|---|---|---|
| Algorithm | AES-GCM 256 | Authenticated encryption (integrity + confidentiality in one step) |
| IV length | 12 bytes (96 bits) | Recommended for GCM; 16 bytes also works but slower |
| Salt | 16 bytes | Used as `additionalData` (not for KDF here) — binds ciphertext to this key generation |
| additionalData | salt | Prevents swapping ciphertexts between different key rotations |
| Auth tag | 16 bytes (auto) | GCM includes 16-byte tag in ciphertext output |

### 5.5 Why not PBKDF2 in ②?

PBKDF2 requires a user passphrase, which means:
- UI prompt on first use ("enter passphrase to encrypt your sessions")
- Forgot passphrase = data loss (no recovery)
- Extra UX surface, extra tests, extra failure modes

MVP-grade `chrome.storage.local` is **good enough** for v1:
- ✅ Mitigates the common "raw IndexedDB inspection" threat
- ✅ No passphrase UX burden
- ✅ Works across browser restarts
- ❌ Doesn't mitigate extension source access (acceptable for v1)
- ❌ Doesn't mitigate stolen computer (acceptable for v1)

**Follow-up (post-⑤)**: PBKDF2 + optional user passphrase toggle in Advanced settings.

---

## 6. Status Machine (5 states)

### 6.1 Enum (replaces MVP's 4-state)

```typescript
// lib/types.ts (modified — extends LoginStatus)

export type LoginStatus =
  | 'unknown'        // initial: user has never checked
  | 'checking'       // in progress (transient, NOT persisted)
  | 'loggedIn'       // confirmed: encryptedCookieBundle is set, decryption succeeds
  | 'loggedOut'      // unconfirmed: no valid credentials (user never logged in, or expired)
  | 'expired';       // ⑤ — stored credential past expiresAt
```

Wait — `expired` is a ⑤ concern (401/403 re-login prompt). For ②, we have 4 effective states:

| State | Persisted? | When |
|---|---|---|
| `unknown` | Yes | MVP default; user has never checked |
| `checking` | No (transient) | While login flow is in progress |
| `loggedIn` | Yes | Decryption succeeded + (cookies still valid OR localStorage tokens still present) |
| `loggedOut` | Yes | No credentials, or stored credentials corrupt/failed decryption |

**Decision**: keep `expired` in the type union (forward-compat with ⑤), but ②'s code never sets it. MVP's Dexie schema already supports it (it's a string enum).

### 6.2 State transitions

```
                  ┌──────────┐
                  │ unknown  │ (MVP default, persisted)
                  └─────┬────┘
                        │ user clicks Login
                        ▼
                  ┌──────────┐
                  │ checking │ (transient, NOT persisted)
                  └─────┬────┘
              ┌─────────┼──────────┐
              │success  │timeout   │tab closed
              ▼         ▼          ▼
          ┌────────┐ ┌──────────┐ ┌──────────┐
          │loggedIn│ │ loggedOut│ │ loggedOut│
          └────────┘ └──────────┘ └──────────┘
              │         │              │
              │ user clicks "Logout"   │
              └─────────┴──────────────┘
                        ▼
                  ┌──────────┐
                  │loggedOut │ (persisted)
                  └──────────┘
```

### 6.3 What triggers a re-check (no auto-check ever)

| Trigger | Code path |
|---|---|
| User clicks "Login" button on a card | `useWebProviderWebLogin.login(presetId)` — full flow |
| User clicks "Re-check login" button on a card | `useWebProviderWebLogin.recheck(presetId)` — read stored + verify, no tab |
| `useWebProviders()` mounts | Resets to `'unknown'` (matches MVP behavior; never auto-checks) |
| `useWebProviders()` provider list changes | Resets to `'unknown'` for the new provider (never auto-checks) |
| Page reload | Persisted status is restored as-is (if `loggedIn` or `loggedOut`, show that) |

**Critical**: on mount, the hook does **not** attempt decryption or cookie check. It trusts the persisted status. This is faster, avoids surprise network calls, and matches chromeclaw's "user must click to verify" pattern.

---

## 7. UI Changes (1 button swap, 0 visual redesigns)

### 7.1 The only diff

The MVP's `WebProviderCard.tsx` had a single "Re-check login" button. ② adds a second "Login" button next to it. That's it. No card layout changes, no new icons, no new colors.

### 7.2 New card visual (annotated)

```
┌──────────────────────────────────────────────────────────┐
│ ● Logged in (green Badge)            ┌── Enabled ──●  Switch  │
│ GLM (Zhipu) — chatglm.cn             [Open website ↗]  Button  │
│ ────────────────────────────────────────────────────────│
│ Model ID:  [GLM-4.6                          ]  Input   │
│ Last checked: 2 minutes ago                              │
│                                                          │
│ Capabilities:                                            │
│ ☑ Tool calls    ☑ Reasoning       (two shadcn Switch)  │
│                                                          │
│ [ Login ]  [ Re-check login status ]   ← 2 buttons now  │
│      ↓                ↓                                  │
│  Opens new tab    Reads stored creds                     │
│  + polls 5 min    + verifies, no tab                     │
└──────────────────────────────────────────────────────────┘
```

### 7.3 New i18n strings (4 additions, all 3 locales)

```yaml
# locales/en.yml (additions to webProviders.fields and webProviders.messages)
webProviders:
  fields:
    login: "Login"
    loggingIn: "Logging in…"
    # ... existing fields ...
  messages:
    loginFailed: "Login failed. Please try again."
    loginTimedOut: "Login timed out after 5 minutes. Please try again."
    # ... existing messages ...
```

zh_CN / zh_TW: same structure, translated (登录 / 登入, 登录中 / 登入中, 登录失败 / 登入失敗, 登录超时 / 登入逾時).

### 7.4 What the SubSection import swap looks like

```typescript
// components/settings/sections/WebProvidersSubSection.tsx
// BEFORE (MVP):
import { useWebProviderSimulatedLogin } from '@/hooks/useWebProviderSimulatedLogin';
// AFTER (②):
import { useWebProviderWebLogin } from '@/hooks/useWebProviderWebLogin';
```

That's a 2-line change. The `useWebProviderSimulatedLogin.ts` file is **deleted** (no callers remain).

---

## 8. Hook: useWebProviderWebLogin

### 8.1 Public interface (MVP contract preserved)

```typescript
// hooks/useWebProviderWebLogin.ts

export interface WebLoginConfig {
  /** Called when login flow succeeds (cookies captured + encrypted + persisted). */
  onSuccess: (id: WebProvider['presetId']) => void;
  /** Called on any failure (timeout, tab closed, cookies insufficient, etc.). */
  onFailure: (id: WebProvider['presetId'], error: string) => void;
}

export interface WebLoginResult {
  /** Open new tab + poll for session cookies. 5s MIN_WAIT, 5min timeout. */
  login: (id: WebProvider['presetId']) => Promise<void>;
  /** Read stored credentials and verify they're still valid. No tab. */
  recheck: (id: WebProvider['presetId']) => Promise<void>;
  /** Which provider is currently in the login flow (one at a time). */
  checkingId: WebProvider['presetId'] | null;
  /** True while a login is in progress (for spinner on the Login button). */
  loginLoading: boolean;
}

export function useWebProviderWebLogin(config: WebLoginConfig): WebLoginResult;
```

### 8.2 Internal state machine

```typescript
export function useWebProviderWebLogin(config: WebLoginConfig): WebLoginResult {
  const [checkingId, setCheckingId] = useState<WebProvider['presetId'] | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const inFlightRef = useRef<WebProvider['presetId'] | null>(null);

  const login = useCallback(async (id: WebProvider['presetId']) => {
    if (inFlightRef.current) return; // ignore double-click
    inFlightRef.current = id;
    setCheckingId(id);
    setLoginLoading(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'WEB_PROVIDER_LOGIN',
        presetId: id,
      });
      if (response?.success) {
        config.onSuccess(id);
      } else {
        config.onFailure(id, response?.error ?? 'Login failed');
      }
    } catch (err) {
      config.onFailure(id, err instanceof Error ? err.message : 'Login failed');
    } finally {
      inFlightRef.current = null;
      setCheckingId(null);
      setLoginLoading(false);
    }
  }, [config]);

  const recheck = useCallback(async (id: WebProvider['presetId']) => {
    if (inFlightRef.current) return;
    inFlightRef.current = id;
    setCheckingId(id);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'WEB_PROVIDER_RECHECK',
        presetId: id,
      });
      if (response?.success) {
        config.onSuccess(id);
      } else {
        config.onFailure(id, response?.error ?? 'Recheck failed');
      }
    } catch (err) {
      config.onFailure(id, err instanceof Error ? err.message : 'Recheck failed');
    } finally {
      inFlightRef.current = null;
      setCheckingId(null);
    }
  }, [config]);

  return { login, recheck, checkingId, loginLoading };
}
```

### 8.3 Why a background SW message, not a direct call?

The hook is in the React tree (settings page UI), which runs in an **extension page** context. The hooks can't call `chrome.cookies` directly because:
- `chrome.cookies` is **only** available in the background service worker (or extension pages with `cookies` permission)
- `chrome.tabs.create` is also SW-only for our use case (cleaner tab management)
- `chrome.scripting.executeScript` is SW-only

By routing everything through the SW:
- All extension-API code lives in one place (`web-provider-cookie-service.ts`)
- Easy to test in isolation (mock `chrome.runtime.sendMessage`)
- Future ④ (network relay) reuses the same SW

---

## 9. Background Service: webProviderCookieService

### 9.1 File location and manifest

```typescript
// entrypoints/background/web-provider-cookie-service.ts (NEW)
// Registered as part of background SW entrypoint (wxt.config.ts already includes background.ts)
```

Manifest changes (in `wxt.config.ts` or `manifest.json`):
```json
{
  "permissions": ["cookies", "scripting", "storage"],
  "host_permissions": [
    "*://*.chatglm.cn/*",
    "*://*.kimi.moonshot.cn/*",
    "*://*.moonshot.cn/*",
    "*://chat.deepseek.com/*",
    "*://*.deepseek.com/*"
  ]
}
```

> The MVP already had `cookies` permission, so this is mostly additive (3 host domains, plus `scripting` for the localStorage fallback path).

### 9.2 Message handlers

```typescript
// entrypoints/background/web-provider-cookie-service.ts (simplified)

type WebProviderMessage =
  | { type: 'WEB_PROVIDER_LOGIN'; presetId: string }
  | { type: 'WEB_PROVIDER_RECHECK'; presetId: string };

const handlers: Record<WebProviderMessage['type'], (msg: any) => Promise<any>> = {
  WEB_PROVIDER_LOGIN: handleLogin,
  WEB_PROVIDER_RECHECK: handleRecheck,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type as WebProviderMessage['type']];
  if (!handler) return false;
  handler(msg).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: String(err) });
  });
  return true; // async response
});

async function handleLogin(msg: { presetId: string }): Promise<{ success: boolean; status?: LoginStatus; error?: string }> {
  const preset = WEB_PROVIDER_PRESETS.find(p => p.id === msg.presetId);
  if (!preset) return { success: false, error: 'Unknown preset' };

  const tab = await chrome.tabs.create({ url: preset.loginUrl, active: true });
  const tabId = tab.id!;
  const startTime = Date.now();

  try {
    const tokens = await pollForSession(tabId, preset, startTime);
    if (!tokens) {
      await safeRemoveTab(tabId);
      return { success: false, status: 'loggedOut', error: 'Login timed out or tab closed' };
    }

    // Refresh (GLM only) — best effort, failure doesn't fail the login
    if (preset.refreshUrl) {
      const extra = await tryRefreshAuth(preset, tokens, tabId);
      Object.assign(tokens, extra);
    }

    // Encrypt + persist
    const ciphertext = await encryptCookieBundle(JSON.stringify(tokens));
    const repo = getWebProviderRepository();
    await repo.setEncryptedCookieBundle(msg.presetId as any, ciphertext);
    await repo.setLoginStatus(msg.presetId as any, 'loggedIn');

    await safeRemoveTab(tabId);
    return { success: true, status: 'loggedIn' };
  } catch (err) {
    await safeRemoveTab(tabId);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleRecheck(msg: { presetId: string }): Promise<{ success: boolean; status: LoginStatus; error?: string }> {
  const repo = getWebProviderRepository();
  const provider = await repo.get(msg.presetId);
  if (!provider?.encryptedCookieBundle) {
    return { success: false, status: 'loggedOut', error: 'No stored credentials' };
  }
  try {
    const plaintext = await decryptCookieBundle(provider.encryptedCookieBundle);
    JSON.parse(plaintext); // validate it's still JSON
    return { success: true, status: 'loggedIn' };
  } catch (err) {
    return { success: false, status: 'loggedOut', error: 'Stored credentials corrupt' };
  }
}

// pollForSession, tryRefreshAuth, readLocalStorageFromTab, safeRemoveTab
// ... (full implementation, ~200 lines)
```

### 9.3 Why `executeScript` for localStorage but not for cookies?

`chrome.cookies.getAll({ domain })` already gives us **all** cookies (including HttpOnly) for a domain. We don't need a script to read them.

`localStorage` is **same-origin** scoped and not accessible via any chrome.* API. The only way to read another page's localStorage from an extension is `chrome.scripting.executeScript({ world: 'MAIN' })`.

---

## 10. Repository Additions

```typescript
// lib/ai-config/web-provider-store.ts (additions to existing class)

export class WebProviderRepository {
  // ... existing methods unchanged ...

  /**
   * Store the encrypted cookie bundle. Overwrites any previous value.
   * Use case: login flow succeeded.
   */
  async setEncryptedCookieBundle(
    presetId: WebProvider['presetId'],
    ciphertext: string,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      encryptedCookieBundle: ciphertext,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Clear the encrypted cookie bundle (e.g. user logged out).
   * Does NOT change loginStatus; the caller decides whether to set loggedOut.
   */
  async clearEncryptedCookieBundle(
    presetId: WebProvider['presetId'],
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      encryptedCookieBundle: null,
      updatedAt: new Date().toISOString(),
    });
  }
}
```

**No schema migration needed** — the `encryptedCookieBundle: string | null` field already exists in MVP's `WebProvider` type and Dexie schema (version 2).

---

## 11. Security Considerations

### 11.1 What ② protects against

| Threat | Mitigation | Tested? |
|---|---|---|
| Raw IndexedDB inspection (e.g. `chrome://settings/internals`) shows plaintext cookies | AES-GCM 256 ciphertext | ✅ Decryption test verifies ciphertext is not plaintext |
| Another extension reading our IndexedDB | Origin isolation (extension's storage is its own origin) | Not tested (out of scope) |
| Network sniffing during login | None needed (chrome.cookies is local) | N/A |
| Malicious preset with malicious `refreshUrl` | Limited to domains we host_permissions for | Code review |

### 11.2 What ② does NOT protect against

| Threat | Why | Follow-up |
|---|---|---|
| Stolen laptop + extension source access | Key is in `chrome.storage.local`, recoverable | PBKDF2 + user passphrase |
| Extension malicious update | Manifest is reviewed by Chrome Web Store | N/A |
| User accidentally uses Cebian on a shared computer | `Logout` button is added but not auto-triggered on browser close | TBD |
| chromeclaw-style "stored as plain text" leakage | We encrypt; they don't | N/A (we're better) |

### 11.3 Why we don't follow chromeclaw's "plain text" choice

chromeclaw stores cookies unencrypted in `chrome.storage.local` (`webCredentialsStorage`). Their rationale (implied from lack of encryption code): simplicity, no key management. We **deviate** because:
- Web Crypto API is built into the browser, no deps
- The performance cost is negligible (encrypting 1KB takes <1ms)
- The "key in chrome.storage.local" pattern is enough to defeat casual disk inspection
- PBKDF2 follow-up is a 2-line swap when we're ready

---

## 12. Test Plan (~30 tests)

### 12.1 New test files (4, 30 test cases total)

| # | File | Cases | Key coverage |
|---|---|---|---|
| 1 | `__tests__/lib/ai-config/web-provider-presets.test.ts` | 4 | All 3 presets have valid `cookieDomain`, `sessionIndicators.length >= 1`, `useLocalStorageFallback` for Kimi, `refreshUrl` only for GLM |
| 2 | `__tests__/lib/ai-config/web-provider-crypto.test.ts` | 8 | encrypt→decrypt round-trip, ciphertext is not plaintext, base64 format `salt(16)+iv(12)+ciphertext`, wrong key throws, missing key auto-creates, tampered ciphertext throws, empty string works, Unicode works |
| 3 | `__tests__/hooks/useWebProviderWebLogin.test.ts` | 12 | inFlight lock, login() sends message with correct type, recheck() sends RECHECK type, success → onSuccess, failure → onFailure, loginLoading toggles, checkingId transitions, double-click ignored, hook resets on unmount, no auto-check on mount |
| 4 | `__tests__/entrypoints/background/web-provider-cookie-service.test.ts` | 6 | handleLogin happy path (cookies → encrypt → persist → success), handleLogin timeout (no cookies in 5min → failure), handleRecheck with valid bundle (decrypt + success), handleRecheck with no bundle (failure), localStorage fallback when cookies empty, refreshAuth called only for GLM |

### 12.2 TDD red-green sample (crypto)

```typescript
// __tests__/lib/ai-config/web-provider-crypto.test.ts
import 'fake-indexeddb/auto';
import { encryptCookieBundle, decryptCookieBundle } from '@/lib/ai-config/web-provider-crypto';

describe('web-provider-crypto', () => {
  // Mock chrome.storage.local for key persistence
  let mockStorage: Record<string, any> = {};
  beforeEach(() => {
    mockStorage = {};
    (global as any).chrome = {
      storage: { local: { get: vi.fn(k => Promise.resolve(mockStorage)), set: vi.fn(o => { Object.assign(mockStorage, o); return Promise.resolve(); }) } },
    };
  });

  it('encrypt then decrypt returns original plaintext', async () => {
    const plaintext = JSON.stringify({ 'chatglm_token': 'abc123' });
    const ciphertext = await encryptCookieBundle(plaintext);
    const decrypted = await decryptCookieBundle(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('ciphertext is NOT plaintext (base64 of bytes, not the original string)', async () => {
    const plaintext = 'secret-cookie-value';
    const ciphertext = await encryptCookieBundle(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/); // base64
  });

  it('output has correct structure: 16B salt + 12B iv + ciphertext', async () => {
    const ciphertext = await encryptCookieBundle('x');
    const bytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    expect(bytes.length).toBeGreaterThanOrEqual(16 + 12 + 1); // minimal plaintext
  });

  it('decryption with tampered ciphertext throws', async () => {
    const ciphertext = await encryptCookieBundle('x');
    // Flip a bit in the middle (after salt+iv)
    const bytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptCookieBundle(tampered)).rejects.toThrow();
  });

  it('first call auto-creates and persists the key in chrome.storage.local', async () => {
    await encryptCookieBundle('x');
    expect(chrome.storage.local.set).toHaveBeenCalled();
    expect(Object.keys(mockStorage)).toContain('web-provider-crypto-key-v1');
    expect(mockStorage['web-provider-crypto-key-v1']).toHaveLength(32); // 256 bits
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
```

### 12.3 TDD red-green sample (background service)

```typescript
// __tests__/entrypoints/background/web-provider-cookie-service.test.ts
import { vi } from 'vitest';

describe('webProviderCookieService.handleLogin', () => {
  let mockCookies: any[];
  let mockTabs: any[];

  beforeEach(() => {
    mockCookies = [];
    mockTabs = [];
    (global as any).chrome = {
      cookies: { getAll: vi.fn(() => Promise.resolve(mockCookies)) },
      tabs: {
        create: vi.fn(opts => Promise.resolve({ id: mockTabs.length + 1 })),
        get: vi.fn(id => mockTabs.find(t => t.id === id) ? Promise.resolve({ id }) : Promise.reject(new Error('not found'))),
        remove: vi.fn(id => { mockTabs = mockTabs.filter(t => t.id !== id); return Promise.resolve(); }),
      },
      runtime: { onMessage: { addListener: vi.fn() } },
      storage: { local: { get: vi.fn(), set: vi.fn() } },
      scripting: { executeScript: vi.fn(() => Promise.resolve([{ result: {} }])) },
    };
  });

  it('happy path: cookies present → encrypt → persist → return success', async () => {
    mockCookies = [{ name: 'chatglm_refresh_token', value: 'rt-abc' }];
    // ... call handleLogin({ presetId: 'glm' })
    // ... assert: encrypt called, Dexie updated, tab removed, return { success: true, status: 'loggedIn' }
  });

  it('timeout: no cookies within 5min → return failure, tab removed', async () => {
    // ... use vi.useFakeTimers, advance by 5min+1ms
    // ... assert: tab removed, return { success: false, error: contains 'timed out' }
  });

  it('Kimi localStorage fallback: when cookies empty but localStorage has token', async () => {
    // ... mock cookies empty, mock executeScript returns { kimi-auth: 'ls-xyz' }
    // ... assert: success with source: 'localStorage'
  });

  it('GLM: refreshUrl is called to exchange refresh_token for access_token', async () => {
    // ... mock fetch to return { access_token: 'at-123' }
    // ... assert: stored bundle has both refresh_token and access_token
  });
});
```

---

## 13. ② Acceptance Criteria (12 checks)

The ② milestone is done only when **all 12 criteria** pass:

1. **Manifest permissions** are present: `cookies`, `scripting`, `storage` + 3 host domains
2. `useWebProviderSimulatedLogin.ts` is **deleted** (zero callers)
3. `useWebProviderWebLogin.ts` is **created** with the documented public interface
4. `lib/ai-config/web-provider-crypto.ts` exports **real** `encryptCookieBundle` and `decryptCookieBundle` (not throw "not implemented")
5. `lib/ai-config/web-provider-cookie-service.ts` is **created** with 2 message handlers (`WEB_PROVIDER_LOGIN`, `WEB_PROVIDER_RECHECK`)
6. WebProviderCard shows a **second "Login" button** next to "Re-check login status"
7. Clicking "Login" on a logged-out card **opens a new tab** to the provider's `loginUrl`
8. If user is already logged in, tab auto-closes within 5-7 seconds and status flips to "Logged in"
9. If user is not logged in, after they log in normally, tab auto-closes within 2 seconds and status flips to "Logged in"
10. Dexie `encryptedCookieBundle` field contains a **base64 string** (not null after successful login)
11. After page reload, the card still shows "Logged in" (decryption from stored bundle succeeds)
12. `pnpm run check` + `pnpm test` + `pnpm run build` are all green; all 30 new tests pass; 32 existing MVP tests still pass

### 13.1 Manual Chrome verification (12+ checks)

(Tests #7-11 above are manual, since they require a real browser session and a real visit to chatglm.cn / kimi.com / chat.deepseek.com.)

**Setup**:
- Build extension: `pnpm run build`
- Load unpacked in Chrome from `.output/chrome-mv3/`
- Open Settings → Providers → Web (Browser Session)
- For each of GLM, Kimi, DeepSeek:
  - Check #1: Card renders with both Login + Re-check buttons
  - Check #2: Click Login → new tab opens to provider URL
  - Check #3: If not logged in, log in normally → tab closes within 2s → status "Logged in"
  - Check #4: Click Re-check → no tab opens, status still "Logged in"
  - Check #5: Reload extension popup → status still "Logged in" (decryption round-trip)
  - Check #6: Click Logout (to be added in ② — not in MVP) → status "Not logged in", Dexie bundle is null

---

## 14. File Inventory

### 14.1 New files (5)

| File | Estimated lines | Purpose |
|---|---|---|
| `hooks/useWebProviderWebLogin.ts` | ~120 | Real login hook (replaces simulated) |
| `lib/ai-config/web-provider-crypto.ts` | ~150 | Real Web Crypto API AES-GCM 256 |
| `lib/ai-config/web-provider-cookie-service.ts` | ~250 | Background SW message handlers |
| `entrypoints/background.ts` (modified) | +10 | Register cookie service message listener |
| `__tests__/lib/ai-config/web-provider-crypto.test.ts` | ~150 | 8 crypto tests |
| `__tests__/lib/ai-config/web-provider-presets.test.ts` | ~80 | 4 preset tests |
| `__tests__/hooks/useWebProviderWebLogin.test.ts` | ~200 | 12 hook tests |
| `__tests__/entrypoints/background/web-provider-cookie-service.test.ts` | ~200 | 6 service tests |

### 14.2 Modified files (5)

| File | Change | Lines |
|---|---|---|
| `lib/ai-config/web-provider-presets.ts` | Add 4 fields to interface + populate for 3 presets | +25 |
| `lib/ai-config/web-provider-store.ts` | Add `setEncryptedCookieBundle`, `clearEncryptedCookieBundle` | +30 |
| `lib/types.ts` | Add `expired` to `LoginStatus` (5th value) | +1 |
| `components/settings/provider/WebProviderCard.tsx` | Add "Login" button + `loginLoading` prop | +15 |
| `components/settings/sections/WebProvidersSubSection.tsx` | Import swap, destructure `login` + `loginLoading` | +3 |
| `wxt.config.ts` (or `manifest.json`) | Add `scripting` + 3 host_permissions | +5 |
| `locales/{en,zh_CN,zh_TW}.yml` | 4 new strings (login, loggingIn, loginFailed, loginTimedOut) | +12 each (36 total) |

### 14.3 Deleted files (1)

| File | Why |
|---|---|
| `hooks/useWebProviderSimulatedLogin.ts` | No callers after import swap |
| `__tests__/hooks/useWebProviderSimulatedLogin.test.ts` | No hook to test |

**Net additions**: ~1,200 lines of new code, ~80 lines of modification, 1 hook + 1 test file deleted. **No Dexie schema migration needed** (already version 2 from MVP).

---

## 15. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 3 preset cookie names are guesses (Kimi/DeepSeek unverified) | **High** | High (no login = no feature) | User manually verifies in Chrome DevTools; if wrong, edit one line in `web-provider-presets.ts`. Document this in CLAUDE.md. |
| `chrome.cookies` permission rejected by Chrome Web Store for some reason | Low | High | Already in MVP manifest; just need to keep host_permissions minimal |
| `executeScript({ world: 'MAIN' })` blocked on some pages (chrome://, file://, webstore) | Medium | Low | localStorage fallback wraps in try/catch; if fails, treat as "no tokens" |
| Web Crypto API not available in test env (jsdom) | Low | Medium | Use Node 22's `globalThis.crypto.subtle` (Node 19+ supports it); `fake-indexeddb` already in MVP |
| Key in `chrome.storage.local` recoverable from extension source | Medium | Low (MVP) | Document in design; PBKDF2 follow-up |
| Refresh token (GLM) captured but access token exchange fails | Medium | Medium | Store the refresh token anyway; access token re-exchange at request time (④) |
| Tab close race condition (poll runs while tab is closing) | Low | Low | `try { chrome.tabs.remove } catch {}` everywhere |
| localStorage keys are wrong for Kimi | **High** | High | Documented as unverified; user self-calibrates |
| User already has 1.0 GB of IndexedDB data; encrypt adds 16+12 bytes per bundle | None | None | 3 providers × 32 bytes = 96 bytes. Trivial. |
| Hook fires on every render (not in useCallback) | Low | Low | useCallback wraps `login` and `recheck`; deps arrays are tight |

---

## 16. Open Questions

| # | Question | Resolution path |
|---|---|---|
| Q1 | What is the **exact** cookie name for chatglm.cn's session? | User opens Chrome → DevTools → Application → Cookies → chatglm.cn; copy the name. If it changes, edit `web-provider-presets.ts`. |
| Q2 | What is the **exact** cookie name for chat.deepseek.com? | Same as Q1. |
| Q3 | What is the **exact** localStorage key for kimi.com? | User opens Chrome → DevTools → Application → Local Storage → kimi.com; copy the key. |
| Q4 | Does GLM really need a `/api/v1/auth/refresh` endpoint with Bearer refresh_token? | chromeclaw confirms; if our URL is wrong, GLM login will succeed but later requests will fail (caught by ⑤). |
| Q5 | Should the "Login" button be **disabled** when `loginLoading` is true? | **Yes** (MVP already disables Re-check when isChecking; same pattern for Login). |
| Q6 | Should the "Logout" button be added in ② or ⑤? | **⑤** — ② is about capturing. Logging out is a separate concern. |
| Q7 | Should `encryptCookieBundle` accept arbitrary JSON or only strings? | **String only** — caller decides whether to JSON.stringify. Keeps the function pure. |
| Q8 | Should we encrypt the entire `WebProvider` row, or just `encryptedCookieBundle`? | **Just the bundle** — the rest (loginStatus, modelId, etc.) is not sensitive and benefits from being indexable. |

---

## 17. Out of Scope (deferred to ③④⑤)

- **③ Network relay** (1-2 days): background SW fetches the provider's API using stored cookies; streams response back to UI
- **④ Agent integration** (1-2 days): register WebProvider adapter in `lib/ai-config/agent.ts`; add `case 'web'` to `getModel()` factory
- **⑤ 401/403 re-login prompt** (0.5 day): detect auth failures, toast "Please re-login", trigger `login()` flow
- **⑤b PBKDF2 + user passphrase** (1 day): replace `chrome.storage.local` key with PBKDF2-derived key
- User-defined custom presets (user-added providers beyond 3 built-in)
- Cross-tab state synchronization (one tab's logout should not affect another's view)
- Dexie `liveQuery` reactive subscriptions
- E2E Playwright tests (only manual Chrome verification, like MVP)
- Visual regression tests
- "Logout" button (added in ⑤)

---

## 18. Decision Log (summary of ② design decisions)

| Decision | Rationale |
|---|---|
| `sessionIndicators: string[]` (array) instead of single `sessionCookieName` | chromeclaw's pattern; supports multiple session cookies per provider |
| 3-tier detection (cookies → localStorage → stored creds) | Kimi/GLM Intl use localStorage; chromeclaw handles both |
| 5-second `MIN_WAIT_MS` before checking cookies | Without it, tab closes before user sees it (chromeclaw comment) |
| 2-second `POLL_INTERVAL_MS`, 5-minute `LOGIN_TIMEOUT_MS` | chromeclaw's values; standard for "wait for user to log in" UX |
| Encrypt cookies at rest (AES-GCM 256) | Better than chromeclaw's plain text; dev-grade key in chrome.storage.local |
| Background SW message-based architecture (not direct hook → chrome API) | All extension APIs live in one place; future ④ reuses the SW |
| 5-state status machine (add `expired`) | Forward-compat with ⑤; ② only uses 4 of 5 |
| localStorage read via `executeScript({ world: 'MAIN' })` | Page's localStorage is not accessible from extension's isolated world |
| Hook never auto-checks on mount | Matches MVP; user must click to verify |
| Preset values are unverified (educated guesses) | chromeclaw confirms GLM; Kimi/DeepSeek cookie names are guesses; user self-calibrates |
| `encryptedCookieBundle` is base64(salt+iv+ciphertext) | Includes salt as AAD; binds ciphertext to this key generation |
| `Logout` button deferred to ⑤ | ② is about capture; logout is a separate concern |
| No Dexie schema migration | MVP already has `encryptedCookieBundle: string | null` in version 2 |

---

## 19. Six Production-Grade Enhancements (A1-A6)

This appendix documents the 6 enhancements user signed off to make ② definitively outperform chromeclaw. Each section covers: motivation, design, code shape, test additions, and risk.

### A1. UI Transparency — show captured cookie count + names

**Why**: chromeclaw is a black box. The user clicks Login, tab opens, tab closes, status changes — but the user has no way to verify *what got captured*. If the preset's `sessionIndicators` are wrong, the user has no signal.

**What we do**:
- After successful login, the SW returns not just `{ success: true }` but also `{ success: true, capturedCookieNames: string[], capturedTokenSources: ('cookie' | 'localStorage')[] }`
- The hook stores this in component-local state
- The card displays: `Captured 2 cookies: chatglm_token, chatglm_refresh_token` (or `Captured from localStorage: kimi-auth`)
- If the user sees `Captured 0 cookies`, they know the preset is wrong and they go to A2 to fix it

**Code shape** (`useWebProviderWebLogin.ts` return type):
```typescript
export interface WebLoginResult {
  // ... existing ...
  /** Most recent capture metadata, null if never logged in. Display in UI. */
  lastCaptureInfo: {
    cookieNames: string[];
    tokenSources: Array<'cookie' | 'localStorage'>;
    capturedAt: string;  // ISO 8601
  } | null;
}
```

**UI change** (`WebProviderCard.tsx`): one new line under "Last checked":
```tsx
{lastCaptureInfo && (
  <p className="text-xs text-muted-foreground">
    Captured {lastCaptureInfo.cookieNames.length} cookie(s):{' '}
    {lastCaptureInfo.cookieNames.slice(0, 3).join(', ')}
    {lastCaptureInfo.cookieNames.length > 3 && `, +${lastCaptureInfo.cookieNames.length - 3} more`}
  </p>
)}
```

**Tests added** (2):
- hook returns lastCaptureInfo after successful login
- hook clears lastCaptureInfo after logout

**Effort**: 1h implementation + 0.5h tests = 1.5h total.

---

### A2. Configurable Session Indicators (KEY ONE)

**Why** (most important section in this appendix): The 3 preset `sessionIndicators` arrays in `web-provider-presets.ts` are educated guesses. GLM is medium-confidence (chromeclaw confirms cookies exist), Kimi/DeepSeek are low-confidence. **Without A2, when the user finds Kimi's actual session indicator is `kimi-auth-token-v2` instead of `kimi-auth`, they must edit source code and rebuild the extension.** This kills the feature for any user who's not also a Cebian contributor.

**What we do**:
- Add `userOverrides: UserOverrides | null` field to `WebProvider` type (Dexie)
- `UserOverrides` is `{ cookieDomain?, sessionIndicators?, useLocalStorageFallback?, refreshUrl? }` — all optional, all override preset
- Add a "Configure session" expandable section in `WebProviderCard` with 4 form fields
- Add a `resolveEffectiveConfig(provider, preset)` function that merges: `effective = { ...preset, ...userOverrides }` (user wins)
- The cookie service uses `effective.sessionIndicators` not `preset.sessionIndicators` everywhere

**Type definition** (`lib/types.ts`):
```typescript
export interface WebProviderUserOverrides {
  cookieDomain?: string;
  sessionIndicators?: string[];   // replaces preset array entirely (not merge)
  useLocalStorageFallback?: boolean;
  refreshUrl?: string;
}

export interface WebProvider {
  // ... existing fields ...
  userOverrides: WebProviderUserOverrides | null;  // ⭐ NEW
}
```

**Resolver** (`lib/ai-config/web-provider-presets.ts`):
```typescript
export function resolveEffectiveConfig(
  provider: WebProvider,
  preset: WebProviderPreset,
): WebProviderPreset & { source: Record<keyof WebProviderUserOverrides, 'preset' | 'user'> } {
  const u = provider.userOverrides ?? {};
  return {
    ...preset,
    cookieDomain: u.cookieDomain ?? preset.cookieDomain,
    sessionIndicators: u.sessionIndicators ?? preset.sessionIndicators,
    useLocalStorageFallback: u.useLocalStorageFallback ?? preset.useLocalStorageFallback,
    refreshUrl: u.refreshUrl ?? preset.refreshUrl,
    source: {
      cookieDomain: u.cookieDomain ? 'user' : 'preset',
      sessionIndicators: u.sessionIndicators ? 'user' : 'preset',
      useLocalStorageFallback: u.useLocalStorageFallback !== undefined ? 'user' : 'preset',
      refreshUrl: u.refreshUrl ? 'user' : 'preset',
    },
  };
}
```

**UI** (`WebProviderCard.tsx` — new "Advanced" section, collapsible):
```tsx
<details className="text-sm">
  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
    Advanced: session detection config
  </summary>
  <div className="mt-2 space-y-2 pl-4">
    <Field label="Cookie domain" value={effective.cookieDomain} source={effective.source.cookieDomain} />
    <Field label="Session indicators (comma-separated)" value={effective.sessionIndicators.join(',')} source={effective.source.sessionIndicators} />
    <Field label="Use localStorage fallback" type="boolean" value={effective.useLocalStorageFallback} source={effective.source.useLocalStorageFallback} />
    <Field label="Refresh URL (GLM only)" value={effective.refreshUrl ?? ''} source={effective.source.refreshUrl} />
    <Button size="sm" variant="ghost" onClick={onResetToPreset}>Reset to preset default</Button>
  </div>
</details>
```

**Repository additions** (`web-provider-store.ts`):
```typescript
async setUserOverrides(presetId: string, overrides: WebProviderUserOverrides | null): Promise<void> {
  await this.db.webProviders.update(presetId, {
    userOverrides: overrides,
    updatedAt: new Date().toISOString(),
  });
}
```

**Tests added** (5):
- `resolveEffectiveConfig` returns preset values when no user overrides
- `resolveEffectiveConfig` returns user values when overrides present
- `resolveEffectiveConfig` source tracking is correct (each field shows 'preset' or 'user')
- `setUserOverrides` persists to Dexie
- Hook uses effective config, not preset, when making service calls (verified via mock)

**Effort**: 3-4h implementation + 1.5h tests = 4.5-5.5h total. **This is the most code-intensive of the 6 enhancements but also the highest-value.**

---

### A3. Active Tab Tracking — pause polling when tab is backgrounded

**Why**: 5 minutes × 2-second polling = 150 `chrome.cookies.getAll` calls. If the user switches to another tab (e.g. starts working in Google Docs while the login tab sits in the background), most of those calls are wasted. We can detect tab focus state and slow polling to 5-second interval when backgrounded.

**What we do**:
- Listen to `chrome.tabs.onActivated` and `chrome.windows.onFocusChanged` events
- Track `isTabFocused: boolean` per active login flow
- In the poll loop, branch: focused → 2s, backgrounded → 5s
- Also: if the tab is **closed by the user** (chrome.tabs.get throws), abort immediately (we already do this)
- If the tab is **moved to a different window**, still poll (the tab is still alive)

**Code shape** (`web-provider-cookie-service.ts`):
```typescript
const BACKGROUND_POLL_INTERVAL_MS = 5_000;  // 2.5x slower

let isTabFocused = true;
chrome.tabs.onActivated.addListener(({ tabId: activeId }) => {
  isTabFocused = activeId === tabId;
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) isTabFocused = false;
  else {
    chrome.tabs.get(tabId).then(t => {
      chrome.windows.get(t.windowId, w => isTabFocused = w.focused);
    });
  }
});

const poll = async () => {
  // ...
  const interval = isTabFocused ? POLL_INTERVAL_MS : BACKGROUND_POLL_INTERVAL_MS;
  pollTimer = setTimeout(poll, interval);
};
```

**Tests added** (2):
- Service uses 2s interval when tab is focused
- Service uses 5s interval when tab is backgrounded

**Effort**: 1-2h implementation + 0.5h tests = 1.5-2.5h total.

---

### A4. Login Attempt Audit Log

**Why**: chromeclaw failures are opaque. The user sees a toast saying "Login failed" and has no idea why. Was it timeout? Tab closed? Wrong cookie name? Wrong localStorage key? Refresh endpoint 502?

**What we do**:
- Add `loginAuditLog: AuditLogEntry[]` to `WebProvider` type, capped at 5 most recent entries
- Each entry: `{ timestamp, result, errorMessage?, source? }`
- `result` is one of: `'success' | 'timeout' | 'tab-closed' | 'no-cookies' | 'refresh-failed' | 'decryption-failed' | 'permission-denied'`
- `source` indicates whether cookies came from `'cookie' | 'localStorage' | 'stored'`
- The UI shows the most recent entry under the card status

**Type** (`lib/types.ts`):
```typescript
export type LoginAttemptResult =
  | 'success' | 'timeout' | 'tab-closed' | 'no-cookies'
  | 'refresh-failed' | 'decryption-failed' | 'permission-denied';

export interface LoginAuditEntry {
  timestamp: string;  // ISO 8601
  result: LoginAttemptResult;
  errorMessage?: string;
  source?: 'cookie' | 'localStorage' | 'stored';
  cookiesCaptured?: number;
}

export interface WebProvider {
  // ... existing ...
  loginAuditLog: LoginAuditEntry[];  // ⭐ NEW, max 5 entries, FIFO eviction
}
```

**Repository** (`web-provider-store.ts`):
```typescript
async appendAuditEntry(presetId: string, entry: LoginAuditEntry): Promise<void> {
  const existing = await this.db.webProviders.get(presetId);
  const log = existing?.loginAuditLog ?? [];
  log.unshift(entry);  // newest first
  while (log.length > 5) log.pop();
  await this.db.webProviders.update(presetId, { loginAuditLog: log, updatedAt: new Date().toISOString() });
}
```

**UI** (`WebProviderCard.tsx`):
```tsx
{provider.loginAuditLog[0] && (
  <p className="text-xs text-muted-foreground">
    Last attempt: {formatTime(provider.loginAuditLog[0].timestamp)} —{' '}
    <Badge variant={provider.loginAuditLog[0].result === 'success' ? 'default' : 'destructive'}>
      {provider.loginAuditLog[0].result}
    </Badge>
  </p>
)}
```

**Tests added** (3):
- `appendAuditEntry` writes entry to Dexie
- `appendAuditEntry` evicts oldest when count > 5
- `appendAuditEntry` is called by service on every login attempt (success or failure)

**Effort**: 2h implementation + 1h tests = 3h total.

---

### A5. RefreshAuth Retry with Exponential Backoff (GLM)

**Why**: GLM's `/api/v1/auth/refresh` endpoint occasionally returns 502 or times out (rate limiting, transient server issues). chromeclaw fails immediately on any non-200. We retry 3 times with 1s, 2s, 4s backoff, covering ~90% of transient blips.

**What we do**:
- In `web-provider-cookie-service.ts`, wrap the `tryRefreshAuth` call in a retry loop
- Backoff: 1s, 2s, 4s (3 total attempts)
- Log each attempt to the audit log
- If all 3 fail, write `'refresh-failed'` to audit log, but **continue with the login** (refresh token is still stored, can be re-tried at request time in ④)

**Code shape**:
```typescript
async function tryRefreshAuthWithRetry(
  refreshUrl: string,
  refreshToken: string,
  tabId: number,
  maxAttempts = 3,
): Promise<string | null> {
  const backoffs = [1000, 2000, 4000];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const token = await tryRefreshAuth(refreshUrl, refreshToken, tabId);
    if (token) return token;
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, backoffs[attempt - 1]));
    }
  }
  return null;
}
```

**Tests added** (2):
- RefreshAuth succeeds on first attempt → no retry
- RefreshAuth fails twice, succeeds on third → returns token
- RefreshAuth fails all 3 → returns null, audit log has 'refresh-failed'

**Effort**: 1h implementation + 0.5h tests = 1.5h total.

---

### A6. Detect Already-Open Tab — don't open a duplicate

**Why**: If the user already has `https://chatglm.cn` open in another tab, clicking Login should **focus that tab** rather than open a duplicate. chromeclaw always opens a new tab, which is confusing.

**What we do**:
- Before `chrome.tabs.create({ url: preset.loginUrl })`, query `chrome.tabs.query({ url: '<loginUrl-host>/*' })`
- If a matching tab exists:
  - `chrome.tabs.update(tab.id, { active: true })` to focus it
  - `chrome.windows.update(tab.windowId, { focused: true })` to bring the window forward
  - Use that tab's id for the poll loop (no new tab created)
- If no match, create new tab (existing behavior)

**Code shape**:
```typescript
async function openOrFocusLoginTab(loginUrl: string): Promise<number> {
  const url = new URL(loginUrl);
  const urlPattern = `*://${url.hostname}/*`;
  const existingTabs = await chrome.tabs.query({ url: urlPattern });
  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.tabs.update(tab.id!, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return tab.id!;
  }
  const tab = await chrome.tabs.create({ url: loginUrl, active: true });
  return tab.id!;
}
```

**Tests added** (2):
- Service focuses existing tab when one is open at the provider's host
- Service creates new tab when no existing tab is open

**Effort**: 1-2h implementation + 0.5h tests = 1.5-2.5h total.

---

### A1-A6 Summary

| ID | Effort (impl + tests) | Tests | Key new files / major changes |
|---|---|---|---|
| A1 | 1.5h | +2 | `useWebProviderWebLogin.ts` return type; `WebProviderCard.tsx` +5 lines |
| A2 | 4.5-5.5h | +5 | `lib/types.ts` (new field), `web-provider-presets.ts` (resolver), `WebProviderCard.tsx` (Advanced section), `web-provider-store.ts` (+1 method) |
| A3 | 1.5-2.5h | +2 | `web-provider-cookie-service.ts` (event listeners + interval branch) |
| A4 | 3h | +3 | `lib/types.ts` (LoginAuditEntry), `web-provider-store.ts` (+1 method), `WebProviderCard.tsx` (+10 lines) |
| A5 | 1.5h | +3 | `web-provider-cookie-service.ts` (retry wrapper) |
| A6 | 1.5-2.5h | +2 | `web-provider-cookie-service.ts` (openOrFocusLoginTab) |
| **Total** | **13.5-16.5h** | **+17 tests** | ~6 files modified, 0 new files |

Combined with original ② effort (12-15h), **total ② effort = 25.5-31.5h ≈ 5-7 days**.

### A1-A6 Acceptance Criteria (added to §13)

In addition to the original 12 criteria:

13. **A1**: After successful login, the card displays `Captured N cookie(s): name1, name2, ...` and this matches what Chrome DevTools shows for the provider
14. **A1**: After logout, the captured-cookies line disappears
15. **A2**: The card has a collapsible "Advanced: session detection config" section
16. **A2**: User can edit `Cookie domain`, `Session indicators`, `Use localStorage fallback`, `Refresh URL` and changes persist across reload
17. **A2**: A "Reset to preset default" button clears all overrides and reverts to preset values
18. **A2**: If user overrides `sessionIndicators` for Kimi to the actual correct value, login succeeds (manual check)
19. **A3**: With DevTools open and the login tab focused, polling logs show 2-second intervals
20. **A3**: When the user switches to another window for 30 seconds, polling logs show 5-second intervals
21. **A4**: Each card shows `Last attempt: X minutes ago — [success/timeout/etc.]`
22. **A4**: The audit log retains exactly 5 entries (FIFO eviction verified)
23. **A5**: With GLM, if the refresh endpoint returns 502 twice then 200, the login succeeds with `chatglm_token` captured
24. **A6**: With chatglm.cn already open in tab A, clicking Login on the GLM card focuses tab A instead of opening tab B

**Total ② acceptance criteria: 24 (12 original + 12 enhancement).**

### A1-A6 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A2's "Advanced" UI adds 100+ lines of form code | Medium | Low | Use plain `<input>` and `<Switch>` like MVP; no new shadcn components |
| A4's audit log grows unbounded if not capped | Low | Low | Repository's `appendAuditEntry` enforces max-5 FIFO |
| A3's `chrome.windows.onFocusChanged` fires very frequently | Low | Low | Throttle: only check focus when our specific tab is in the affected window |
| A5's retry loop blocks the polling flow | Low | Low | Total max wait: 1+2+4 = 7s, well within MIN_WAIT_MS (5s) + first poll |
| A6's `chrome.tabs.query({ url })` is slow on users with many tabs | Low | Low | 1 query at start of login; not in poll loop |
| User overrides sessionIndicators with garbage values | Medium | Low | Login will simply fail with "no cookies detected"; user can see this in A4 audit log |
| Reset-to-preset button accidentally clicked | Low | Low | Confirmation dialog: "Reset to preset defaults? Your overrides will be lost." |

---

## 20. Appendix A: chromeclaw code references (read-only)

For deep dives during implementation, the following chromeclaw files are the primary references:

- `chromeclaw-research/chrome-extension/src/background/web-providers/auth.ts` (225 lines) — `checkWebAuth`, `initiateWebLogin`, `getWebCredential`, `storeWebCredential`, `clearWebCredential`, `testWebConnection`
- `chromeclaw-research/packages/shared/lib/hooks/use-web-provider-auth.ts` (190 lines) — `useWebProviderAuth` hook with `status`, `loginLoading`, `error`, `login`, `logout`
- `chromeclaw-research/docs/web-zero-token.md` — design rationale

We are **inspired by** these patterns, **not forking** the code. Cebian's repo structure, Dexie schema, hook style, and TDD conventions are different.

---

## 21. Appendix B: preset default values rationale

| Provider | `cookieDomain` | `sessionIndicators` | `useLocalStorageFallback` | `refreshUrl` | Confidence |
|---|---|---|---|---|---|
| GLM | `chatglm.cn` | `['chatglm_refresh_token', 'chatglm_token']` | `false` | `https://chatglm.cn/api/v1/auth/refresh` (assumed) | Medium (chromeclaw confirms HttpOnly cookies exist) |
| Kimi | `kimi.moonshot.cn` | `['kimi-auth']` (guess) | `true` | (none) | Low (chromeclaw: localStorage fallback is the path; exact key unknown) |
| DeepSeek | `chat.deepseek.com` | `['sessionid']` (guess, Django-style) | `false` | (none) | Low (educated guess) |

All three providers **must be manually verified** in Chrome DevTools before ② is useful. **A2 (configurable session indicators) is the escape hatch** — when the preset is wrong, the user edits the value in Settings → Advanced section, no source code change required.

The "first run" experience for the user will be:
1. Click Login on GLM card
2. Tab opens to chatglm.cn
3. User is already logged in (Google account or email)
4. Tab should close within 5-7s with "Logged in" status, audit log shows `success`, card shows `Captured 2 cookies: chatglm_token, chatglm_refresh_token`
5. If not, user expands "Advanced" section, edits `sessionIndicators` based on what they see in DevTools, tries again
6. Audit log shows the failure and the user can see exactly what went wrong (timeout? tab-closed? no-cookies?)

This is **production-grade UX** — the user is never stuck wondering "why isn't this working?"

---

**End of design document. Total: ~1100 lines (was 720 + 380 enhancements).**
