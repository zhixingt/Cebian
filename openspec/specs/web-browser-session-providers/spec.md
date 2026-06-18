# web-browser-session-providers Specification

## Purpose

定义 Cebian 扩展中 "Web (Browser Session)" 这一全新 provider 类别的行为契约。该类别允许用户复用其已在浏览器中登录的 Web AI 服务（GLM、Kimi、DeepSeek）的会话状态，无需配置 API Key 即可在侧边栏中使用对应模型。本文档覆盖 Settings UI 展示、持久化存储、模拟登录检测、国际化及 Dexie 迁移等全部 MVP 范围的功能需求。
## Requirements
### Requirement: Settings UI displays three built-in web provider presets

The system SHALL display three preset cards (GLM, Kimi, DeepSeek) under a new "Web (Browser Session)" sub-section within the Providers settings page. Each card SHALL be rendered using the `WebProviderCard` component with the corresponding `WebProviderPreset` metadata (display name, login URL, default model ID, default capability flags).

#### Scenario: First-time settings open
- **WHEN** a user opens the Settings page for the first time after this feature ships
- **THEN** the Providers section displays a "Web (Browser Session)" sub-section containing exactly three cards: GLM (chatglm.cn), Kimi (kimi.com), and DeepSeek (chat.deepseek.com)

#### Scenario: Existing user upgrades
- **WHEN** a user with existing Cebian data upgrades the extension
- **THEN** the three preset rows are auto-seeded in Dexie on first mount of the sub-section, and the existing chat history and other data are unchanged

### Requirement: Each preset card exposes seven interaction controls

The system SHALL render, for each preset card, exactly the following seven user-facing controls: (1) an enable/disable toggle, (2) a login status indicator badge, (3) a re-check login button, (4) a Model ID text input, (5) a tool-calls capability toggle, (6) a reasoning capability toggle, and (7) an external link to the preset's official website.

#### Scenario: All seven controls are visible
- **WHEN** a user views any preset card
- **THEN** all seven controls are visible and reachable without scrolling horizontally

#### Scenario: User toggles enable
- **WHEN** a user clicks the enable/disable toggle
- **THEN** the toggle's visual state changes immediately AND the new state is written to Dexie within 1 second

#### Scenario: User edits Model ID
- **WHEN** a user modifies the Model ID input field
- **THEN** the new value is committed to Dexie on input change (debounced via React's normal change event)

### Requirement: Re-check button runs a simulated login flow

The system SHALL, when a user clicks the re-check button, run a simulated login check that takes between 1 and 2 seconds, then transitions the preset's login status to either `loggedIn` (with 70% probability) or `loggedOut` (with 30% probability), and write the result to Dexie.

#### Scenario: Successful simulated login
- **WHEN** a user clicks re-check and the simulator's outcome is success
- **THEN** within 2 seconds the card displays a green "Logged in" badge AND the Dexie `loginStatus` field equals `loggedIn` AND `lastCheckedAt` is updated to the current ISO 8601 timestamp

#### Scenario: Failed simulated login
- **WHEN** a user clicks re-check and the simulator's outcome is failure
- **THEN** within 2 seconds the card displays a red "Not logged in" badge AND the Dexie `loginStatus` field equals `loggedOut` AND a transient error toast appears

#### Scenario: Concurrent re-check attempts are deduplicated
- **WHEN** a user clicks re-check while a previous re-check is still in flight
- **THEN** the second click is ignored and the original flow continues without interruption

### Requirement: Transient checking state is not persisted

The system SHALL NOT persist the `checking` login status to Dexie. The `checking` value is a transient display state that lives only in the React component's `useState` while a re-check is in progress.

#### Scenario: Page refresh during check
- **WHEN** a user clicks re-check, then refreshes the page while the 1-2 second check is still running
- **THEN** on page reload, the card returns to its previous persisted status (`loggedIn` / `loggedOut` / `unknown`) and does NOT show a "Checking…" state

### Requirement: All persisted state survives page refresh

The system SHALL persist all user-editable state (enable toggle, login status, Model ID, both capability toggles, last checked timestamp) to Dexie on every change, and SHALL restore that state on subsequent page loads.

#### Scenario: Refresh after enable toggle
- **WHEN** a user toggles a preset from enabled to disabled, then refreshes the page
- **THEN** the preset card displays the toggle in the disabled position after refresh

#### Scenario: Refresh after Model ID edit
- **WHEN** a user changes the Model ID for a preset, then refreshes the page
- **THEN** the input field shows the edited value after refresh

### Requirement: Encrypted cookie bundle field is reserved but never populated in MVP

The system SHALL declare an `encryptedCookieBundle: string | null` field on the `WebProvider` type and SHALL always write `null` to this field in the MVP. The field is reserved for milestone ② (real cookie storage) and MUST NOT be used for any other purpose in this change.

#### Scenario: New row is seeded
- **WHEN** the repository seeds a new row for a preset
- **THEN** the `encryptedCookieBundle` field equals `null`

#### Scenario: Repository method never populates the field
- **WHEN** any `setEnabled` / `setLoginStatus` / `setModelId` / `setCapability` method is called
- **THEN** the `encryptedCookieBundle` field remains `null` (the methods never set this field)

### Requirement: Internationalization covers three locales with full parity

The system SHALL render all user-visible text in the Web (Browser Session) sub-section using i18n keys defined in `en.yml`, `zh_CN.yml`, and `zh_TW.yml`. The project's i18n lint script MUST pass, enforcing (a) all top-level keys match the allow-list, (b) full key parity across the three locales, and (c) no hard-coded Chinese characters in the source.

#### Scenario: Switching locale updates all text
- **WHEN** a user switches the extension's display language between English, Simplified Chinese, and Traditional Chinese
- **THEN** every visible string in the Web (Browser Session) sub-section updates to the corresponding locale's translation with no fallback to English

#### Scenario: Pre-commit hook blocks incomplete translations
- **WHEN** a developer adds a new i18n key to `en.yml` but forgets to add it to `zh_CN.yml` and `zh_TW.yml`
- **THEN** the i18n lint script fails on `pnpm run check` and the pre-commit hook blocks the commit

### Requirement: Dexie schema migration is strictly additive

The system SHALL add a new `webProviders` table to Dexie's `version(2).stores(...)` block, re-declaring all existing tables in that block. The migration MUST be additive — no existing tables are renamed, removed, or have their primary keys changed. Existing user data MUST be preserved across the upgrade.

#### Scenario: Existing user upgrades
- **WHEN** a user with existing chats, messages, skills, and OAuth tokens upgrades to a build with this change
- **THEN** all existing data remains intact after the Dexie migration, and the new `webProviders` table starts empty (rows are auto-seeded on first list)

#### Scenario: New installation
- **WHEN** a user installs the extension for the first time on a build with this change
- **THEN** Dexie creates the database with the `webProviders` table and the migration runs cleanly with no errors

### Requirement: No regression in existing provider categories

The system MUST NOT modify the behavior, rendering, or persistence of any existing API Key or OAuth provider card. The new sub-section is appended at the end of `ProvidersSection` without altering the existing components.

#### Scenario: API Key cards still editable
- **WHEN** a user opens the existing API Key provider cards in the same settings page
- **THEN** they remain editable exactly as before, with their existing validation, persistence, and i18n intact

#### Scenario: OAuth provider cards still functional
- **WHEN** a user opens the existing OAuth provider cards (e.g., GitHub Copilot)
- **THEN** the OAuth flow remains functional and all existing settings are preserved

