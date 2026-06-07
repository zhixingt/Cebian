# Plan: ⑨.4 — Real model selection for Web (Browser Session) Provider

> **For agentic workers:** Pick this up when the user is ready. The user picked option "D" from the 2026-06-08 UI redesign (see commit `1d4bc24`). They want the Model ID field to actually control which model responds — currently it's a no-op cosmetic field.

## Goal

Make the Model ID field in the Web Provider settings actually select which GLM model chatglm.cn uses to respond. Currently:
- The field is displayed in Cebian's model selector
- The value is stored as `provider.modelId` and used as the activeModel identifier
- **The actual HTTP request to chatglm.cn is hardcoded to GLM-4.6's assistant_id** — the Model ID has zero effect on which model responds

## Current state (root cause)

File: `lib/ai-config/web-provider-content-fetch-glm.ts:74`
```ts
const GLM_ASSISTANT_ID = '65940acff94777010aa6b796';  // hardcoded GLM-4.6
```

File: `lib/ai-config/web-provider-content-fetch-glm.ts:275-292` (the request body)
```ts
const glmBody = JSON.stringify({
  assistant_id: GLM_ASSISTANT_ID,  // ← hardcoded
  conversation_id: existingChatId,
  project_id: '',
  chat_type: 'user_chat',
  meta_data: { /* ... */ },
  messages: [{ role: 'user', content: [{ type: 'text', text: glmPrompt }] }],
  // ⚠️ NO model field at all
});
```

**chatglm.cn architecture**: each model (GLM-4.6, GLM-5.1, GLM-4-Flash, Z1, etc.) has its own internal `assistant_id`. There's no "model" string parameter — you pass the right `assistant_id` and the backend routes accordingly.

**Symptom (user reported 2026-06-08)**: log into chatglm.cn, model selector shows "GLM-5.1" (the new default). Type a message in Cebian → response comes from GLM-4.6 (because that's what `GLM_ASSISTANT_ID` maps to). Changing the Model ID field in settings has no effect.

## Proposed approach (4 phases)

### Phase 1: Data model refactor

**Add a `models` array to the GLM preset** in `lib/ai-config/web-provider-presets.ts`:

```ts
export interface WebProviderModel {
  /** Display name shown in the model selector (e.g., "GLM-5.1") */
  label: string;
  /** Stable ID used as the activeModel key (e.g., "glm-5.1") */
  id: string;
  /** chatglm.cn's internal assistant_id (e.g., "65940acff94777010aa6b796") */
  assistantId: string;
  /** Whether this model supports tool/function calling */
  supportsToolCalls: boolean;
}

export interface WebProviderPreset {
  // ... existing fields
  /** Available models for this provider. Ordered by recommended first. */
  models: readonly WebProviderModel[];
  /** Default model id when the user has no preference. */
  defaultModelId: string;
}

export const WEB_PROVIDER_PRESETS: readonly WebProviderPreset[] = [
  {
    id: 'glm',
    // ... existing fields
    models: [
      {
        id: 'glm-5.1',
        label: 'GLM-5.1',
        assistantId: '<TBD — user to provide via DevTools>',
        supportsToolCalls: true,
      },
      {
        id: 'glm-4.6',
        label: 'GLM-4.6',
        assistantId: '65940acff94777010aa6b796',  // known
        supportsToolCalls: true,
      },
    ],
    defaultModelId: 'glm-5.1',  // 2026-06-08: was glm-4.6, now reflects reality
  },
] as const;
```

**Remove** the old `defaultSupportsToolCalls` / `defaultSupportsReasoning` fields from the preset (replaced by per-model fields).

### Phase 2: Pure resolution helper (TDD-friendly)

**New file** `lib/ai-config/web-provider-model-resolver.ts`:

```ts
import type { WebProviderPreset, WebProviderModel } from './web-provider-presets';
import type { WebProvider } from '../types';

export interface ResolvedModel {
  id: string;
  label: string;
  assistantId: string;
  supportsToolCalls: boolean;
}

/**
 * Resolve which model + assistantId to use for a chat request.
 *
 * Resolution order:
 *   1. provider.modelId if it matches a known model in the preset
 *   2. preset.defaultModelId as fallback
 *   3. First entry in preset.models (last-resort)
 *
 * Returns the resolved model with the assistantId ready to use.
 * Throws if the preset has no models configured (caller bug).
 */
export function resolveWebProviderModel(
  provider: WebProvider,
  preset: WebProviderPreset,
): ResolvedModel;

/**
 * Find a model entry in a preset by id. Returns undefined if not found.
 */
export function findModel(
  preset: WebProviderPreset,
  modelId: string,
): WebProviderModel | undefined;
```

This is the unit that gets TDD'd thoroughly. The test fixtures need to cover:
- Known model id → returns that model
- Unknown model id + has default → returns default
- Unknown model id + no default → returns first model
- Preset with empty models array → throws (clear error)

### Phase 3: Wire into content-fetch-glm

File: `lib/ai-config/web-provider-content-fetch-glm.ts`

Changes:
1. Remove the hardcoded `const GLM_ASSISTANT_ID = '65940acff94777010aa6b796';`
2. Accept `modelId` in the `ContentFetchRequest` (already passed via `request.modelId` from `web-provider-stream.ts:336`)
3. Look up the assistantId via the new resolver
4. Use the resolved assistantId in the request body

The new request body:
```ts
const glmBody = JSON.stringify({
  assistant_id: resolvedModel.assistantId,  // ← dynamic now
  conversation_id: existingChatId,
  project_id: '',
  chat_type: 'user_chat',
  meta_data: { /* ... */ },
  messages: [{ role: 'user', content: [{ type: 'text', text: glmPrompt }] }],
});
```

### Phase 4: UI — replace free-text Model ID with a dropdown

File: `components/settings/provider/WebProviderCard.tsx`

Replace:
```tsx
<Input value={provider.modelId} onChange={...} />
```

With:
```tsx
<Select value={provider.modelId} onValueChange={onModelIdChange}>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    {effective.models.map(m => (
      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

The `modelIdLabel` i18n key changes from "Model ID" to "Model" (cleaner now that it's a selector, not an input).

Update `getAvailableWebModels` in `lib/ai-config/web-provider-models.ts` to iterate `preset.models` instead of a single modelId.

## Key files to touch

| File | Change |
|---|---|
| `lib/ai-config/web-provider-presets.ts` | Add `WebProviderModel` type; add `models` array to GLM preset; update `defaultModelId` to `glm-5.1`; remove `defaultSupportsToolCalls/Reasoning` |
| `lib/ai-config/web-provider-model-resolver.ts` (NEW) | Pure helpers: `resolveWebProviderModel`, `findModel` |
| `lib/ai-config/web-provider-content-fetch-glm.ts` | Remove hardcoded `GLM_ASSISTANT_ID`; use resolver |
| `lib/ai-config/web-provider-models.ts` | Iterate `preset.models` in `getAvailableWebModels` |
| `components/settings/provider/WebProviderCard.tsx` | Replace Input with Select; update label |
| `locales/{en,zh_CN,zh_TW}.yml` | Update `modelIdLabel` to "Model"; remove unused keys |
| `__tests__/lib/ai-config/web-provider-model-resolver.test.ts` (NEW) | TDD tests for resolver |
| `__tests__/components/settings/provider/WebProviderCard.test.tsx` | Update to assert dropdown |
| `__tests__/lib/ai-config/web-provider-content-fetch-glm.test.ts` | Update to assert dynamic assistantId |

## Tests (TDD)

### Unit (resolver)
- `findModel(preset, 'glm-5.1')` → returns GLM-5.1 entry
- `findModel(preset, 'glm-99')` → undefined
- `resolveWebProviderModel(provider, preset)` with `provider.modelId='glm-5.1'` → returns GLM-5.1 model with its assistantId
- Same call with `provider.modelId='unknown'` → returns preset.defaultModelId
- Same call with `provider.modelId='unknown'` and no default → returns first model
- Empty preset.models → throws with clear message
- Per-model `supportsToolCalls` correctly propagates (this changes the agent behavior per model)

### Integration (content-fetch-glm)
- HTTP request body contains `assistant_id: <resolved assistantId>`, NOT the hardcoded one
- Different `request.modelId` produces different `assistant_id` in the request
- Unknown model falls back gracefully (no crash)

### UI (WebProviderCard)
- Renders a `<Select>` (not `<Input>`) for model selection
- Select options match `preset.models` exactly
- Selecting a different option calls `onModelIdChange(<newId>)`

## What the user needs to provide (BLOCKER)

**GLM-5.1's `assistant_id`** (chatglm.cn's internal ID). The current known value is GLM-4.6's: `65940acff94777010aa6b796`.

How to get it:
1. Log into chatglm.cn in Chrome
2. Open DevTools → Network tab
3. Select "GLM-5.1" in the model dropdown
4. Send a message
5. In Network, find `/chatglm/backend-api/assistant/stream`
6. Look at Request Payload → `assistant_id` field
7. Copy the value

Alternative: ask chatglm.cn / use their API docs if they publish model→assistant_id mappings.

**Without this value, the plan can still be implemented (all 4 phases) but the GLM-5.1 entry will have a placeholder assistantId, and selecting GLM-5.1 in the dropdown will fail at request time with a 4xx error from chatglm.cn.**

## Risks

| Risk | Mitigation |
|---|---|
| chatglm.cn's assistant_id changes without notice (model deprecation, re-pathing) | Centralize in the preset; a single edit re-points. The session watcher's 401 detection will catch it and surface to user |
| User has GLM-5.1 assistantId wrong (typo, stale) | TDD test: invalid assistantId from preset → clear error in toast, not silent fail |
| Switching models mid-conversation breaks the conversation_id (each model has its own conversation) | Document this; either reset conversation_id on model change, or warn user |
| chatglm.cn adds new models that we don't know about | Preset models list grows; user can request addition |
| Build-time i18n strict-types break when removing fields (defaultSupportsToolCalls) | Remove from BOTH interface AND every consumer; grep before commit |

## Non-goals (explicitly NOT in this plan)

- ❌ Fetching the model list dynamically from chatglm.cn (the user can update the preset when chatglm.cn ships new models)
- ❌ Per-message model override via API (the settings page is the only place to change it)
- ❌ Auto-detect current model from chatglm.cn's UI on login (nice-to-have, separate plan)
- ❌ Removing the `useLocalStorageFallback` toggle (that was a separate concern; this plan is about model selection)
- ❌ Reasoning toggle (GLM still doesn't expose reasoning to users)

## Effort estimate

- **1-2 days of focused work**, mostly TDD
- Blocked on **GLM-5.1's assistant_id** from the user (5 minutes of their time to grab it via DevTools)
- Once unblocked, the implementation flows linearly

## Rollback

Revert the commit. The only schema change is:
- `WebProviderPreset.models` array (new field)
- `WebProviderModel` interface (new type)

Both are additive — old code (without these fields) wouldn't be in the same version. The only consumer is the resolver + fetch-glm, which would be reverted together.

## Related

- 2026-06-08: User chose option D in the UI redesign plan (see plan doc `2026-06-08-web-provider-ui-redesign.md` if it exists)
- Known limitation: the `useWebProviderWebLogin.ts` auto-selects the default model after login; will continue to work (just picks `glm-5.1` instead of `glm-4.6`)
- 2026-06-04: T1 DevTools research found GLM-4.6's assistant_id; need fresh research for current models
