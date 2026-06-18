/**
 * Type-level regression: WebProvider['presetId'] is a string-literal union
 * matching the keys of WEB_PROVIDER_PRESETS. When a new preset is added to
 * web-provider-presets.ts, this test fails at the type level, forcing the
 * author to think about whether the narrow type union needs updating.
 *
 * This test has no runtime assertions — it exists purely to break the
 * compile when the union becomes wider than the preset list (or vice versa).
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { WebProvider } from '@/lib/types';
import { WEB_PROVIDER_PRESETS } from '@/lib/ai-config/web-provider-presets';

describe('WebProvider.presetId type union', () => {
  it('matches the keys of WEB_PROVIDER_PRESETS exactly', () => {
    // Extract the keys of the presets array (read-only tuple → union of literals)
    type PresetIds = (typeof WEB_PROVIDER_PRESETS)[number]['id'];

    // The union must be EXACTLY equal to the WebProvider['presetId'] type.
    // If a new preset is added, this fails → update the narrow type.
    // If a preset is removed, this also fails → update the narrow type.
    expectTypeOf<WebProvider['presetId']>().toEqualTypeOf<PresetIds>();
  });
});
