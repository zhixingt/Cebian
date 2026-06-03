# Web (Browser Session) Provider — Settings UI MVP

- **Status**: Draft (pending user review)
- **Date**: 2026-06-03
- **Author**: brainstorm session between user and Sisyphus
- **Project**: Cebian (fork: `zhixingt/Cebian`, upstream: `maotoumao/Cebian`)
- **Scope**: MVP for **Settings UI only** — mocked login, no real cookie extraction, no network relay, no agent integration
- **Reference impl (read-only inspiration, not forking)**: `algopian/chromeclaw`

---

## 1. Background & Motivation

Cebian currently supports LLM providers that require the user to provide an API key (OpenAI, Anthropic, Google, custom OpenAI-compatible endpoints). A growing category of providers offer free web UIs that **already use the user's logged-in browser session** to authorize API calls — examples include chatglm.cn, kimi.com, chat.deepseek.com. Users who have logged in to those sites in Chrome should be able to reuse that auth state inside Cebian without provisioning separate API keys.

This MVP delivers the **Settings UI shell** for a new provider category, "Web (Browser Session)". It contains **no real cookie or network code**. All login state is simulated. Subsequent milestones (②–⑤) will swap the simulation for real implementations without touching this UI.

### Why this MVP scope?

- Runs end-to-end through OpenSpec → TDD → commit → release pipeline, validating the workflow
- Validates the data shape and component contract that real cookie/network/agent layers will plug into
- 1-2 day implementation surface, low risk for a zero-base contributor
- All future milestones (②–⑤) layer on top without modifying UI, hook, or repository code

### Non-goals (explicit)

The following are **out of scope for this MVP** and reserved for follow-up milestones:

- ② Real `chrome.cookies.getAll()` extraction (cookie reading, HttpOnly handling)
- ③ Real encrypted IndexedDB bundle storage (AES-GCM via Web Crypto API)
- ④ Cross-origin network relay via background service worker
- ⑤ pi-agent-core integration (WebProvider as a model kind)
- Real 401/403 detection and re-login prompt
- User-defined custom presets (user-added providers beyond the 3 built-in)
- Cross-tab state synchronization
- Dexie `liveQuery` reactive subscriptions
- Visual regression tests, E2E browser tests

---

## 2. Architecture (4 layers)

```
┌──────────────────────────────────────────────────────────┐
│  Layer 1: UI 表现层（React 组件）                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ ProvidersSection（现有）                              │ │
│  │   └── <WebProvidersSubSection>  ← 新增（容器）       │ │
│  │         ├── <WebProviderCard /> × N  ← 新增（卡片）  │ │
│  │         └── <EmptyWebProvidersState />  ← 新增（仅 Dexie 错误时显示） │ │
│  └─────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│  Layer 2: 状态管理层（React Hooks）                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ useWebProviders()          ← 新增（CRUD + 持久化）   │ │
│  │ useWebProviderSimulatedLogin()  ← 新增（mock 流程）  │ │
│  └─────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│  Layer 3: 数据访问层（Dexie 仓储）                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ WebProviderRepository  ← 新增（CRUD + 加密字段预留）│ │
│  │   ↑                                                    │ │
│  │   │ 通过 Dexie 4 + Web Crypto API                    │ │
│  │   ↓                                                    │ │
│  │ lib/db.ts（已有，扩展 table）                          │ │
│  └─────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│  Layer 4: 数据/配置源                                      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ ① web-provider-presets.ts   ← 新增（3 预设常量）    │ │
│  │ ② Dexie IndexedDB              ← 已有 + 扩展         │ │
│  │ ③ 未来：chrome.cookies API     ← 预留接口（MVP 不接） │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 2.1 Data flow (user action → state change)

```
User clicks "Re-check login"
        │
        ▼
WebProviderCard calls useWebProviderSimulatedLogin.recheck(presetId)
        │
        ▼
Hook sets local state: status = "checking"
        │
        ▼
setTimeout 1-2 seconds → random success/failure
        │
        ├─ Success → Hook calls WebProviderRepository.setLoginStatus(id, "loggedIn")
        │                │
        │                ▼
        │             Dexie writes IndexedDB
        │                │
        │                ▼
        │             useWebProviders refresh() → React re-render
        │                → card shows ● Logged in
        │
        └─ Failure → local state shows "Not logged in" + error toast
                       (no Dexie write, original status preserved)
```

### 2.2 Key architectural principles

| Principle | Implementation |
|---|---|
| Extensible presets | `web-provider-presets.ts` exports `Preset[]`; UI is config-driven; adding a preset = appending to the array |
| Encryption reservation | Dexie schema reserves `encryptedCookieBundle: string \| null`; MVP always writes `null` |
| Zero intrusion | `ProvidersSection.tsx` only appends `<WebProvidersSubSection>` at the end; existing API Key/OAuth cards untouched |
| Pluggable login (no rebuild for ②) | Swap `useWebProviderSimulatedLogin` internals for `useWebProviderRealLogin`; UI is unaffected |
| i18n-friendly | All user-visible strings go through `i18n.t()`; 3 locale keys added in one batch |
| Type-safe | `WebProvider` defined in `lib/types.ts`, derived from preset; card props are strict |

---

## 3. Data Model & Dexie Schema

### 3.1 Type definitions (`lib/types.ts` additions)

```typescript
/**
 * A "web AI provider" complete configuration.
 * Persisted in Dexie (IndexedDB). MVP only uses loginStatus / enabled /
 * modelId / capabilities. The `encryptedCookieBundle` field is reserved
 * for ②; MVP always writes null.
 */
export type LoginStatus =
  | 'unknown'      // initial: user has never checked
  | 'checking'     // in progress (transient, NOT persisted)
  | 'loggedIn'     // confirmed (mock write)
  | 'loggedOut';   // unconfirmed (mock write)

export interface WebProvider {
  /** Preset id, matches preset.id (GLM / Kimi / DeepSeek) */
  presetId: 'glm' | 'kimi' | 'deepseek';

  /** Whether the user has enabled this provider (UI card switch) */
  enabled: boolean;

  /** Login status ('checking' is filtered out before persistence) */
  loginStatus: Exclude<LoginStatus, 'checking'>;

  /** User-editable Model ID (default copied from preset) */
  modelId: string;

  /** Whether the provider supports tool use / function calling */
  supportsToolCalls: boolean;

  /** Whether the provider supports reasoning / chain-of-thought */
  supportsReasoning: boolean;

  /** Last check time (ISO 8601), for "X minutes ago" display */
  lastCheckedAt: string | null;

  /** ⭐ RESERVED for ②: encrypted cookie bundle, MVP always null */
  encryptedCookieBundle: string | null;

  /** Metadata: creation and last-modification time */
  createdAt: string;
  updatedAt: string;
}
```

### 3.2 Preset definition (`lib/ai-config/web-provider-presets.ts`)

```typescript
import type { WebProvider } from '../types';

export interface WebProviderPreset {
  /** Unique id (matches WebProvider.presetId) */
  id: WebProvider['presetId'];

  /** Display name (i18n key, resolved at render time) */
  displayNameKey: string;

  /** Short description (i18n key) */
  descriptionKey: string;

  /** Official website URL (target of the "Open" button) */
  loginUrl: string;

  /** Default Model ID */
  defaultModelId: string;

  /** Recommended capability flags (user can override) */
  defaultSupportsToolCalls: boolean;
  defaultSupportsReasoning: boolean;
}

export const WEB_PROVIDER_PRESETS: readonly WebProviderPreset[] = [
  {
    id: 'glm',
    displayNameKey: 'webProviders.presets.glm.name',
    descriptionKey: 'webProviders.presets.glm.description',
    loginUrl: 'https://chatglm.cn',
    defaultModelId: 'GLM-4.6',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
  },
  {
    id: 'kimi',
    displayNameKey: 'webProviders.presets.kimi.name',
    descriptionKey: 'webProviders.presets.kimi.description',
    loginUrl: 'https://kimi.com',
    defaultModelId: 'kimi-k2-0905-preview',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
  },
  {
    id: 'deepseek',
    displayNameKey: 'webProviders.presets.deepseek.name',
    descriptionKey: 'webProviders.presets.deepseek.description',
    loginUrl: 'https://chat.deepseek.com',
    defaultModelId: 'deepseek-chat',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: true,
  },
] as const;
```

### 3.3 Dexie schema extension (`lib/db.ts`)

The existing `CebianDB` is extended with a `webProviders` table. The schema string only lists indexed fields; `encryptedCookieBundle` is a regular document field, not indexed.

```typescript
import Dexie, { type Table } from 'dexie';
import type { WebProvider } from './types';

class CebianDB extends Dexie {
  // ... existing tables (chats, messages, etc.) unchanged

  webProviders!: Table<WebProvider, string>;  // primary key = presetId

  constructor() {
    super('CebianDB');

    // ... existing version(N) blocks unchanged

    this.version(2).stores({
      // ... existing stores preserved
      webProviders: 'presetId, enabled, updatedAt',
    });
  }
}
```

**Migration safety**: Dexie's `version(N)` system is additive; new version blocks never modify old ones. Existing users' data is preserved.

### 3.4 Encryption reservation (`lib/ai-config/web-provider-crypto.ts`)

This file is **placeholder only in MVP**. It defines the future public surface so callsite code can compile and tests can assert "not implemented in MVP" semantics. ② will fill in real implementations without changing any call site.

```typescript
const NOT_IMPLEMENTED = 'web-provider-crypto: not implemented in MVP';

export async function encryptCookieBundle(_bundle: string): Promise<string> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function decryptCookieBundle(_ciphertext: string): Promise<string> {
  throw new Error(NOT_IMPLEMENTED);
}

/** MVP always returns false. ② will check user toggle in Advanced settings. */
export function isEncryptionEnabled(): boolean {
  return false;
}
```

### 3.5 Repository (`lib/ai-config/web-provider-store.ts`)

```typescript
import type { CebianDB } from '../db';
import type { WebProvider, LoginStatus } from '../types';
import { WEB_PROVIDER_PRESETS } from './web-provider-presets';
import { getDb } from '../db';  // ESM top-level import; project uses "type": "module"

export class WebProviderRepository {
  constructor(private db: CebianDB) {}

  async list(): Promise<WebProvider[]> {
    const existing = await this.db.webProviders.toArray();
    const existingIds = new Set(existing.map(p => p.presetId));
    const missing = WEB_PROVIDER_PRESETS
      .filter(p => !existingIds.has(p.id))
      .map(p => this.createFromPreset(p));
    if (missing.length > 0) {
      await this.db.webProviders.bulkAdd(missing);
    }
    return this.db.webProviders.orderBy('updatedAt').reverse().toArray();
  }

  async get(presetId: string): Promise<WebProvider | undefined> {
    return this.db.webProviders.get(presetId);
  }

  async setEnabled(presetId: string, enabled: boolean): Promise<void> {
    await this.db.webProviders.update(presetId, {
      enabled,
      updatedAt: new Date().toISOString(),
    });
  }

  async setLoginStatus(
    presetId: string,
    status: Exclude<LoginStatus, 'checking'>,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      loginStatus: status,
      lastCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async setModelId(presetId: string, modelId: string): Promise<void> {
    await this.db.webProviders.update(presetId, {
      modelId,
      updatedAt: new Date().toISOString(),
    });
  }

  async setCapability(
    presetId: string,
    capability: 'supportsToolCalls' | 'supportsReasoning',
    value: boolean,
  ): Promise<void> {
    await this.db.webProviders.update(presetId, {
      [capability]: value,
      updatedAt: new Date().toISOString(),
    });
  }

  private createFromPreset(preset: typeof WEB_PROVIDER_PRESETS[number]): WebProvider {
    const now = new Date().toISOString();
    return {
      presetId: preset.id,
      enabled: true,
      loginStatus: 'unknown',
      modelId: preset.defaultModelId,
      supportsToolCalls: preset.defaultSupportsToolCalls,
      supportsReasoning: preset.defaultSupportsReasoning,
      lastCheckedAt: null,
      encryptedCookieBundle: null,
      createdAt: now,
      updatedAt: now,
    };
  }
}

/** Singleton accessor; matches the style of existing getDb() in lib/db.ts. */
let _instance: WebProviderRepository | null = null;
export function getWebProviderRepository(): WebProviderRepository {
  if (!_instance) {
    // getDb is imported at top of file (ESM); no circular dep concern
    _instance = new WebProviderRepository(getDb());
  }
  return _instance;
}
```

---

## 4. UI Components

### 4.1 Component tree

```
ProvidersSection (existing, no body modifications)
└── <WebProvidersSubSection>          ← new (container)
    ├── <SectionHeader />             ← new (title + help copy, shadcn Card primitives)
    └── {providers.map(p =>
          <WebProviderCard            ← new (one card per provider)
            key={p.presetId}
            provider={p}
            preset={preset}
            isChecking={checkingId === p.presetId}
            onEnabledChange={...}
            onModelIdChange={...}
            onCapabilityChange={...}
            onRecheck={...}
          />
        )}
```

### 4.2 WebProviderCard visual layout

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
│ [   Re-check login status   ]   Button (variant=outline) │
│       changes to "Checking…" for 1-2s, disabled          │
└──────────────────────────────────────────────────────────┘
```

### 4.3 Props interface

```typescript
import type { WebProvider } from '@/lib/types';
import type { WebProviderPreset } from '@/lib/ai-config/web-provider-presets';

export interface WebProviderCardProps {
  /** Persisted state from Dexie (display data source) */
  provider: WebProvider;

  /** Preset metadata (display name, URL, default capabilities) */
  preset: WebProviderPreset;

  /** Whether this card is in transient "checking" state */
  isChecking: boolean;

  /** 4 events; component is fully controlled */
  onEnabledChange: (enabled: boolean) => void;
  onModelIdChange: (modelId: string) => void;
  onCapabilityChange: (
    capability: 'supportsToolCalls' | 'supportsReasoning',
    value: boolean,
  ) => void;
  onRecheck: () => void;
}
```

### 4.4 Reused shadcn components

| Component | Use | Source |
|---|---|---|
| `<Card>` | Card shell | `components/ui/card` (existing) |
| `<Switch>` | Enable / capability toggles | `components/ui/switch` (existing) |
| `<Input>` | Model ID edit | `components/ui/input` (existing) |
| `<Button>` | Re-check, open website | `components/ui/button` (existing) |
| `<Badge>` | Login status indicator | `components/ui/badge` (existing) |
| `<Skeleton>` | Loading placeholder | `components/ui/skeleton` (existing) |
| sonner | Toast for errors | already used in project |
| lucide-react | Status dots, external-link icon | already a dep |

**Zero new primitive components** — all UI is assembled from existing shadcn primitives.

### 4.5 WebProvidersSubSection container

```typescript
export function WebProvidersSubSection() {
  const { providers, update, isLoading, error } = useWebProviders();
  const { recheck, checkingId } = useWebProviderSimulatedLogin({
    onSuccess: (id) => update.setLoginStatus(id, 'loggedIn'),
    onFailure: (id) => update.setLoginStatus(id, 'loggedOut'),
  });

  if (isLoading) return <SectionSkeleton />;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={i18n.t('webProviders.sectionTitle')}
        description={i18n.t('webProviders.sectionDescription')}
      />
      {providers.map(provider => {
        const preset = WEB_PROVIDER_PRESETS.find(p => p.id === provider.presetId);
        if (!preset) return null;
        return (
          <WebProviderCard
            key={provider.presetId}
            provider={provider}
            preset={preset}
            isChecking={checkingId === provider.presetId}
            onEnabledChange={(v) => update.setEnabled(provider.presetId, v)}
            onModelIdChange={(v) => update.setModelId(provider.presetId, v)}
            onCapabilityChange={(cap, v) =>
              update.setCapability(provider.presetId, cap, v)
            }
            onRecheck={() => recheck(provider.presetId)}
          />
        );
      })}
    </section>
  );
}
```

### 4.6 Mounting in ProvidersSection (minimal change)

Append to the existing `ProvidersSection.tsx`:

```typescript
import { WebProvidersSubSection } from './WebProvidersSubSection';

// ... existing JSX ...
<WebProvidersSubSection />
// ...
```

**Two lines added, zero existing lines modified.** API Key, OAuth, and all other cards are untouched.

### 4.7 Visual states

| Scenario | Display |
|---|---|
| Dexie loading | 3 `<Skeleton>` card placeholders |
| All 3 presets disabled | Cards remain visible with all switches off |
| Preset list empty | Cannot happen (auto-seed on first `list()`) |
| `chrome.cookies` not supported | Not applicable in MVP |

---

## 5. State Management

### 5.1 Two cooperating hooks (decoupled)

```
useWebProviders()
  Role: bridges UI ↔ WebProviderRepository
  Source: Dexie (IndexedDB)
  Exposes: providers[], isLoading, error, update.{setEnabled, setLoginStatus, setModelId, setCapability}

useWebProviderSimulatedLogin({ onSuccess, onFailure })
  Role: mocks the "re-check login" flow (1-2s delay + 70% success rate)
  Exposes: recheck(presetId), checkingId
  Does NOT touch Dexie directly — calls back to let useWebProviders write
```

**Why decoupled**: each hook is independently unit-testable. ② replaces `useWebProviderSimulatedLogin` with `useWebProviderRealLogin`; `useWebProviders` is not touched.

### 5.2 useWebProviders

```typescript
export interface UseWebProvidersResult {
  providers: WebProvider[];
  isLoading: boolean;
  error: Error | null;
  update: {
    setEnabled: (id: WebProvider['presetId'], enabled: boolean) => Promise<void>;
    setLoginStatus: (id: WebProvider['presetId'], status: Exclude<LoginStatus, 'checking'>) => Promise<void>;
    setModelId: (id: WebProvider['presetId'], modelId: string) => Promise<void>;
    setCapability: (id: WebProvider['presetId'], cap: 'supportsToolCalls' | 'supportsReasoning', value: boolean) => Promise<void>;
  };
}

export function useWebProviders(): UseWebProvidersResult {
  const [providers, setProviders] = useState<WebProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const repo = getWebProviderRepository();

  const refresh = useCallback(async () => {
    try {
      const list = await repo.list();
      setProviders(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [repo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      await refresh();
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  // 4 update methods: write Dexie → refresh; on error setError
  // (omitted here for brevity; see implementation file)

  return { providers, isLoading, error, update: { setEnabled, setLoginStatus, setModelId, setCapability } };
}
```

**Key choices**: write-then-refresh (single source of truth in Dexie); cancelled flag for unmount safety; error state is set on every write failure and surfaced via sonner.

### 5.3 useWebProviderSimulatedLogin

```typescript
export interface SimulatedLoginConfig {
  onSuccess: (id: WebProvider['presetId']) => void;
  onFailure: (id: WebProvider['presetId']) => void;
}

export interface SimulatedLoginResult {
  recheck: (id: WebProvider['presetId']) => void;
  checkingId: WebProvider['presetId'] | null;
}

/**
 * Mocks "re-check login status" for the MVP.
 *   - 1-2 second random delay (looks like a real network call)
 *   - 70% probability of success → calls onSuccess
 *   - 30% probability of failure → calls onFailure
 *   - Only one provider can be "checking" at a time (subsequent recheck ignored)
 *
 * ② will replace this hook's internals with real chrome.cookies.getAll
 *    + cookie validation + 401/403 handling. Callers are unaffected.
 */
export function useWebProviderSimulatedLogin(
  config: SimulatedLoginConfig,
): SimulatedLoginResult {
  const [checkingId, setCheckingId] = useState<WebProvider['presetId'] | null>(null);
  const inFlightRef = useRef<WebProvider['presetId'] | null>(null);

  const recheck = useCallback((id: WebProvider['presetId']) => {
    if (inFlightRef.current !== null) return;  // ignore double-click
    inFlightRef.current = id;
    setCheckingId(id);

    const delay = 1000 + Math.random() * 1000;
    setTimeout(() => {
      const success = Math.random() < 0.7;
      try {
        success ? config.onSuccess(id) : config.onFailure(id);
      } finally {
        inFlightRef.current = null;
        setCheckingId(null);
      }
    }, delay);
  }, [config]);

  return { recheck, checkingId };
}
```

**Key choices**: `useRef` for in-flight (synchronous, no re-render); hardcoded 70% (deterministic for tests via `vi.spyOn(Math, 'random')`); transient by design (not persisted).

### 5.4 Dexie sync strategy

**MVP**: simple "write-then-refresh" pattern. 3 rows, < 1ms full table read. `Dexie.liveQuery` is not adopted; it adds complexity not warranted at this scale.

### 5.5 Error handling matrix

| Error | User-visible behavior | Implementation |
|---|---|---|
| Initial Dexie read fails | Red toast: "Failed to load web providers" | `setError` + sonner |
| Dexie write fails (rare, e.g. disk full) | Toast with error, UI not rolled back (3 rows, acceptable) | `setError` + sonner |
| Page reload during "checking" | Transient state lost, returns to previous | By design |
| IndexedDB disabled | Toast: "Please enable IndexedDB" | `setError` + sonner |
| Duplicate presetId in `bulkAdd` | `ConstraintError` thrown | Repository surfaces via `setError` |

All errors route through sonner; no inline error banners in MVP.

### 5.6 Decision log (state management)

| Decision | Rationale |
|---|---|
| Two hooks decoupled via callbacks | Independent testability; ② swaps one without touching the other |
| Write-then-refresh, no optimistic update | Single source of truth (Dexie); 3 rows make perf a non-issue |
| `inFlightRef` via `useRef` | Synchronous lock, no re-render storm |
| 70% success hardcoded | Best demo UX; mockable in tests for determinism |
| 'checking' is transient only | By design — refresh should not restore a stale "checking" state |
| No `Dexie.liveQuery` in MVP | Complexity unwarranted at this row count |
| All errors → sonner | Project already uses it; no new deps |

---

## 6. Internationalization (i18n)

### 6.1 Top-level key

Add `webProviders` to the top-level key allow-list in `scripts/lint-i18n.mjs`:

```javascript
const ALLOWED_TOP_KEYS = new Set([
  'extName', 'extDescription', 'actionTitle',
  'common', 'chat', 'settings', 'provider', 'tools', 'vfs', 'dialogs', 'errors', 'agent',
  'webProviders',  // ⭐ added
]);
```

Failure to update the lint script means pre-commit hook blocks every commit. This is intentional.

### 6.2 Locale additions (en, zh_CN, zh_TW)

The three locale files are extended with one new top-level namespace. English baseline:

```yaml
webProviders:
  sectionTitle: "Web (Browser Session)"
  sectionDescription: "Reuse your browser's login state. No API key required."
  presets:
    glm:
      name: "GLM (Zhipu)"
      description: "ChatGLM web version"
    kimi:
      name: "Kimi (Moonshot)"
      description: "Moonshot AI web version"
    deepseek:
      name: "DeepSeek"
      description: "DeepSeek web version"
  fields:
    enabled: "Enabled"
    modelIdLabel: "Model ID"
    modelIdHelp: "Default is the recommended model. Edit only if you know what you're doing."
    capabilities: "Capabilities"
    toolCalls: "Tool calls"
    reasoning: "Reasoning"
    recheck: "Re-check login status"
    checking: "Checking…"
    openWebsite: "Open website"
  status:
    loggedIn: "Logged in"
    loggedOut: "Not logged in"
    neverChecked: "Never checked"
  messages:
    loadFailed: "Failed to load web providers. Please reopen the settings page."
    recheckFailed: "Login check failed. Please make sure you're signed in to the website."
```

`zh_CN.yml` and `zh_TW.yml` get the same structure with full translations. zh_TW uses traditional characters and Taiwan-specific terms (登录→登入, 设置→設定, etc.) and fullwidth punctuation per locale convention.

### 6.3 What is NOT internationalized

| Field | Reason | Lives in |
|---|---|---|
| `presetId: 'glm' \| 'kimi' \| 'deepseek'` | Internal enum, never rendered | `lib/types.ts` |
| `loginUrl: 'https://chatglm.cn'` | URL is a technical value | `web-provider-presets.ts` |
| `defaultModelId: 'GLM-4.6'` | Vendor-official identifier, do not translate | `web-provider-presets.ts` |
| Boolean `enabled: true` etc. | Not user-visible text | Dexie |
| Enum values `'checking'`, `'loggedIn'`, etc. | Internal state machine | `lib/types.ts` |
| `Error` objects | Surfaced via i18n **key**, not raw message | i18n `messages.*` |

### 6.4 Time copy: reuse `common.time.*`

The "X minutes ago" pattern for `lastCheckedAt` reuses the existing `common.time.*` keys (`justNow`, `minutesAgo`, etc.) — **not duplicated** under `webProviders.timing.*`.

### 6.5 Interpolation convention

Chrome i18n standard: `$1`, `$2`, `$3` positional. Call as `i18n.t('key', [arg1, arg2])`. The project does not use ICU MessageFormat; the lint script does not support it. ES6 template strings (`${var}`) in YAML are not a translation mechanism and must not be used.

### 6.6 Plurals

Not used in `webProviders.*` for MVP. If needed in the future, follow the existing `common.session.messageCount: { 0, 1, n }` three-key variant pattern.

### 6.7 Parity verification

`pnpm run check` runs `scripts/lint-i18n.mjs`, which enforces:
1. Top-level keys match the allow-list (so missing `webProviders` is caught)
2. Full key parity across `en.yml`, `zh_CN.yml`, `zh_TW.yml`
3. No hard-coded Chinese characters in `components/`, `entrypoints/`, `lib/`

A parity bug therefore cannot reach `master` — pre-commit hook blocks it.

---

## 7. Test-Driven Development Plan

### 7.1 Test files (5 new files, 31 test cases total)

| # | File | Cases | Key coverage |
|---|---|---|---|
| 1 | `__tests__/lib/ai-config/web-provider-store.test.ts` | 10 | Repository CRUD, Dexie persistence, auto-seed, encryptedCookieBundle always null |
| 2 | `__tests__/hooks/useWebProviders.test.ts` | 8 | Initial load, 4 update paths, error capture, unmount safety |
| 3 | `__tests__/hooks/useWebProviderSimulatedLogin.test.ts` | 6 | checkingId transitions, 1-2s delay, 70% success, double-click ignored |
| 4 | `__tests__/lib/ai-config/web-provider-crypto.test.ts` | 3 | encrypt/decrypt throw `not implemented`, `isEncryptionEnabled` returns false |
| 5 | `__tests__/components/settings/provider/WebProviderCard.test.tsx` | 4 | Controlled rendering, 4 event callbacks, isChecking state |

### 7.2 TDD red-green sample

```typescript
// __tests__/lib/ai-config/web-provider-store.test.ts
import 'fake-indexeddb/auto';
import { getDb } from '@/lib/db';
import { getWebProviderRepository } from '@/lib/ai-config/web-provider-store';

describe('WebProviderRepository', () => {
  beforeEach(async () => {
    await getDb().delete();
    await getDb().open();
  });

  it('list() seeds 3 presets on empty DB', async () => {
    const providers = await getWebProviderRepository().list();
    expect(providers).toHaveLength(3);
    expect(providers.map(p => p.presetId).sort()).toEqual(['deepseek', 'glm', 'kimi']);
  });

  it('all seeded providers have encryptedCookieBundle === null', async () => {
    const providers = await getWebProviderRepository().list();
    expect(providers.every(p => p.encryptedCookieBundle === null)).toBe(true);
  });

  it('setEnabled persists across reload', async () => {
    await getWebProviderRepository().setEnabled('glm', false);
    const reloaded = await getDb().webProviders.get('glm');
    expect(reloaded?.enabled).toBe(false);
  });
});
```

```typescript
// __tests__/hooks/useWebProviderSimulatedLogin.test.ts
import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useWebProviderSimulatedLogin } from '@/hooks/useWebProviderSimulatedLogin';

describe('useWebProviderSimulatedLogin', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('only one recheck at a time is allowed', () => {
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({ onSuccess: vi.fn(), onFailure: vi.fn() }),
    );
    act(() => result.current.recheck('glm'));
    expect(result.current.checkingId).toBe('glm');
    act(() => result.current.recheck('kimi'));  // ignored
    expect(result.current.checkingId).toBe('glm');
  });

  it('70% success rate — mock Math.random', () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useWebProviderSimulatedLogin({ onSuccess, onFailure }),
    );
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)   // delay 1.5s
      .mockReturnValueOnce(0.3);  // success (< 0.7)
    act(() => result.current.recheck('glm'));
    act(() => vi.advanceTimersByTime(1500));
    expect(onSuccess).toHaveBeenCalledWith('glm');
    expect(onFailure).not.toHaveBeenCalled();
  });
});
```

### 7.3 Test stack

| Tool | Status | Use |
|---|---|---|
| `vitest` | verify (likely present with WXT) | Hook + unit test runner |
| `@testing-library/react` | verify (may need to install) | Render hooks and components |
| `fake-indexeddb` | install | Required for Dexie tests |
| `jsdom` | bundled with vitest | DOM simulation |

**First implementation step**: run `pnpm test` to discover existing test config. If absent, install the stack following WXT's official vitest setup.

---

## 8. MVP Acceptance Criteria

The MVP is **done** only when **all 12 criteria** are met:

1. 3 preset cards visible in the settings page under `Providers`
2. Each card shows 7 fields/interactions: display name, enable toggle, login status, re-check button, Model ID, Tool calls toggle, Reasoning toggle
3. Clicking "Re-check login" enters a 1-2 second "Checking…" state
4. Success path: `useWebProviders.setLoginStatus(id, 'loggedIn')` writes to Dexie
5. Failure path: `useWebProviders.setLoginStatus(id, 'loggedOut')` writes to Dexie + error toast
6. After page refresh, all state (enabled, login, Model ID, both capability switches) persists
7. Toggling the enable switch reflects immediately in the UI
8. All 3 locales (en, zh_CN, zh_TW) render correctly with no fallback
9. `pnpm run check` is fully green (TS zero errors, i18n lint zero warnings)
10. All 31 new unit tests pass
11. No regression in existing functionality (API Key, OAuth, Skills, Chat, other Settings sections)
12. `pnpm run dev` builds the extension and it loads in Chrome

---

## 9. Future Milestones (Out of Scope, Reserved)

The following milestones layer on top of this MVP without modifying UI, hook, or repository code:

### ② Cookie extraction (target: 1-2 days)
- New file: `lib/ai-config/web-provider-cookie-extractor.ts`
- Implements real `chrome.cookies.getAll()` + HttpOnly handling
- Fills in `lib/ai-config/web-provider-crypto.ts` (Web Crypto API, AES-GCM 256)
- Replaces `useWebProviderSimulatedLogin` with `useWebProviderRealLogin`
- UI: 0 changes

### ③ Encrypted storage (target: 1 day)
- Repository method `setEncryptedCookieBundle(id, ciphertext)`
- Web Crypto AES-GCM 256 implementation
- UI: 0 changes

### ④ Network relay (target: 1-2 days)
- New file: `entrypoints/background/web-provider-relay.ts`
- Cross-origin fetch + streaming response handling
- UI: 0 changes

### ⑤ Agent integration (target: 1-2 days)
- Register WebProvider adapter in `lib/ai-config/agent.ts`
- Add `case 'web'` to `getModel()` in pi-agent-core factory
- Map `supportsToolCalls` / `supportsReasoning` flags
- UI: 0 changes

### ⑤b 401/403 re-login prompt (target: 0.5 day)
- Detect auth failures in repository
- Toast notification prompting user to re-check
- UI: 0 changes

**Promise**: each of ②–⑤ ships with all MVP tests still green. Zero regression.

---

## 10. File Inventory

### 10.1 New files (10)

| File | Estimated lines | Purpose |
|---|---|---|
| `lib/types.ts` (modification) | +30 | `WebProvider`, `LoginStatus` types |
| `lib/ai-config/web-provider-presets.ts` | +80 | 3 built-in presets |
| `lib/ai-config/web-provider-store.ts` | +120 | Dexie repository |
| `lib/ai-config/web-provider-crypto.ts` | +40 | Encryption placeholder |
| `hooks/useWebProviders.ts` | +150 | CRUD + persistence hook |
| `hooks/useWebProviderSimulatedLogin.ts` | +60 | Mock login flow |
| `components/settings/provider/WebProviderCard.tsx` | +180 | One card per provider |
| `components/settings/sections/WebProvidersSubSection.tsx` | +80 | Container |
| `components/settings/provider/EmptyWebProvidersState.tsx` | +30 | Empty state (defensive) |
| `__tests__/lib/ai-config/web-provider-store.test.ts` | +150 | Repository tests |
| `__tests__/hooks/useWebProviders.test.ts` | +120 | Hook tests |
| `__tests__/hooks/useWebProviderSimulatedLogin.test.ts` | +100 | Login mock tests |
| `__tests__/lib/ai-config/web-provider-crypto.test.ts` | +30 | Crypto placeholder tests |
| `__tests__/components/settings/provider/WebProviderCard.test.tsx` | +100 | Component tests |

### 10.2 Modified files (4)

| File | Change | Lines |
|---|---|---|
| `lib/db.ts` | Add `webProviders` table to version 2 | +5 |
| `components/settings/sections/ProvidersSection.tsx` | Append `<WebProvidersSubSection />` | +2 |
| `scripts/lint-i18n.mjs` | Add `webProviders` to `ALLOWED_TOP_KEYS` | +1 |
| `locales/en.yml` | New `webProviders` namespace | +25 |
| `locales/zh_CN.yml` | New `webProviders` namespace (CN) | +25 |
| `locales/zh_TW.yml` | New `webProviders` namespace (TW) | +25 |

**Net additions**: ~1,300 lines of new code, 80 lines of modification. No deletions.

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dexie schema migration breaks existing data | Low | High | Strictly additive `version(2)`; never modify old version blocks |
| i18n parity bugs slip through | Low | Medium | Lint script enforces parity; pre-commit blocks |
| shadcn components missing variants | Low | Low | Confirmed all 6 components exist in `components/ui/` |
| `fake-indexeddb` doesn't work in current Node | Low | Medium | Verify in TDD step 1; fallback to mock Dexie wrapper |
| Existing tests break from new imports | Low | Medium | New code only added; no existing modules modified |
| Recheck spam bypasses in-flight lock | Low | Low | `useRef` lock + state-level guard |

---

## 12. Open Questions

None at the time of writing. All design questions raised during brainstorming have been resolved. The implementation plan (`writing-plans` skill output) will surface any new sub-decisions as they arise during TDD.
