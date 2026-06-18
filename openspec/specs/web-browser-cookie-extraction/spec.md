# web-browser-cookie-extraction Specification

## Purpose
TBD - created by archiving change web-browser-cookie-extraction. Update Purpose after archive.
## Requirements
### Requirement: Cookie Detection via sessionIndicators

The system MUST detect a logged-in session for a web provider by calling
`chrome.cookies.getAll({ domain: preset.cookieDomain })` and checking whether
ANY cookie name in `preset.sessionIndicators[]` is present.

#### Scenario: GLM detection via refresh_token cookie
Given preset `cookieDomain: 'chatglm.cn'` and `sessionIndicators: ['chatglm_refresh_token', 'chatglm_token']`
When `chrome.cookies.getAll({ domain: 'chatglm.cn' })` returns a cookie named `chatglm_refresh_token`
Then the system MUST mark the provider as having a session

#### Scenario: localStorage fallback (Kimi)
Given preset `useLocalStorageFallback: true` and no matching cookies
When `chrome.scripting.executeScript({ world: 'MAIN' })` returns a non-empty value for any `sessionIndicators` key
Then the system MUST mark the provider as having a session from localStorage

### Requirement: Login Flow Polling

The system MUST open a new tab to `preset.loginUrl` and poll for session
cookies every 2 seconds for up to 5 minutes, with a 5-second initial wait.

#### Scenario: 5-second MIN_WAIT
Given a user clicks "Login" on a card
When the system opens a new tab to the provider's loginUrl
Then the system MUST wait at least 5 seconds before checking cookies
To prevent the tab from closing before the user sees it

#### Scenario: 2-second polling
Given the 5-second MIN_WAIT has elapsed
When the system polls `chrome.cookies.getAll`
Then the system MUST wait 2 seconds before the next poll

#### Scenario: 5-minute timeout
Given 5 minutes have elapsed since login started
When the system has not detected a session
Then the system MUST abort, remove the tab, and return a timeout error

### Requirement: Encrypted Cookie Storage

The system MUST encrypt the captured cookies using AES-GCM 256 (Web Crypto API)
before storing them in Dexie's `encryptedCookieBundle` field.

#### Scenario: Round-trip encryption
Given captured cookies in JSON
When the system encrypts and stores them
Then decrypting the stored bundle MUST return the original JSON

#### Scenario: Tampered ciphertext rejected
Given a stored bundle with modified bytes
When the system attempts to decrypt
Then the system MUST throw a decryption error

### Requirement: Configurable Session Indicators (A2)

The system MUST allow users to override preset values for
`cookieDomain`, `sessionIndicators`, `useLocalStorageFallback`, and
`refreshUrl` per provider via the Settings UI.

#### Scenario: User overrides sessionIndicators
Given a user edits `sessionIndicators` for Kimi from `['kimi-auth']` to `['kimi-auth-v2']`
When the user saves and clicks Login
Then the system MUST use `['kimi-auth-v2']` for detection (not the preset default)

#### Scenario: Reset to preset
Given a user has user overrides for a provider
When the user clicks "Reset to preset default"
Then the system MUST clear the overrides and revert to the preset values

### Requirement: Login Audit Log (A4)

The system MUST maintain a per-provider audit log of the last 5 login
attempts, with timestamp, result, and optional error message.

#### Scenario: Audit entry on success
Given a successful login
When the system completes the login flow
Then the system MUST append `{ timestamp, result: 'success', source, cookiesCaptured }` to `loginAuditLog`

#### Scenario: FIFO eviction at 5
Given a provider with 5 existing audit entries
When a 6th attempt is made
Then the oldest entry MUST be removed (FIFO)

### Requirement: Active Tab Tracking (A3)

The system MUST detect when the login tab is in the background and slow
the polling interval from 2s to 5s.

#### Scenario: Background polling throttling
Given the login tab is in a non-focused window
When the system polls cookies
Then the system MUST use a 5-second interval instead of 2-second

### Requirement: RefreshAuth Retry (A5)

The system MUST retry the `refreshAuth` call (GLM only) up to 3 times
with exponential backoff (1s, 2s, 4s) before giving up.

#### Scenario: Retry on transient failure
Given the refreshAuth call fails twice with non-200 status
When the third attempt is made
Then the system MUST use the third attempt's result

### Requirement: Detect Already-Open Tab (A6)

The system MUST check `chrome.tabs.query` for an existing tab at the
provider's host before opening a new one.

#### Scenario: Reuse existing tab
Given a tab is already open at `https://chatglm.cn`
When the user clicks Login on the GLM card
Then the system MUST focus the existing tab instead of opening a new one

