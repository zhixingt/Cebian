/**
 * Validator for `activeModel` storage values, kept in its own module so
 * unit tests can import it without pulling in WXT's `storage.defineItem`
 * (which isn't available in the vitest environment).
 *
 * Used by:
 *   - the `migrate` hook on `activeModel.defineItem` in `lib/storage.ts`
 *     (clears stale/malformed entries on install / schema bump)
 *   - the runtime guard in `entrypoints/background/agent-manager.ts`
 *     (self-heal: when resolveSelectedWebModel returns null)
 *
 * Stale values are any of:
 *   - non-null value with `modelId` that starts with `web:` but the segment
 *     after `web:` is not a current `WEB_PROVIDER_PRESETS[].id`
 *   - non-null value that's not an object (e.g. `{}` or a string)
 *   - non-null value with empty `provider` or `modelId`
 */
import { WEB_PROVIDER_PRESETS } from './web-provider-presets';

export function isValidActiveModel(
  value: unknown,
): value is { provider: string; modelId: string } {
  if (!value || typeof value !== 'object') return false;
  const v = value as { provider?: unknown; modelId?: unknown };
  if (typeof v.provider !== 'string' || v.provider.length === 0) return false;
  if (typeof v.modelId !== 'string' || v.modelId.length === 0) return false;
  // For web: prefixed models, require the preset id to be registered.
  if (v.provider === 'web' && v.modelId.startsWith('web:')) {
    const rest = v.modelId.slice(4);
    const colonIdx = rest.indexOf(':');
    if (colonIdx <= 0) return false;
    const presetId = rest.slice(0, colonIdx);
    const valid = WEB_PROVIDER_PRESETS.some((p) => p.id === presetId);
    return valid;
  }
  // For other provider prefixes (anthropic, openai, etc.), trust the
  // shape check above. The pi-ai Model registry will resolve at runtime.
  return true;
}
