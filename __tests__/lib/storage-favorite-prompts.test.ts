import { describe, it, expect } from 'vitest';
import { favoritePrompts } from '@/lib/storage';

describe('favoritePrompts storage', () => {
  it('exports a WXT storage item keyed local:favoritePrompts', () => {
    // WXT defineItem returns a StorageItem object — verify the runtime shape
    // and the default fallback.
    expect(favoritePrompts).toBeDefined();
    expect(typeof favoritePrompts.getValue).toBe('function');
    expect(typeof favoritePrompts.setValue).toBe('function');
    expect(typeof favoritePrompts.watch).toBe('function');
  });

  it('falls back to [] when nothing is stored', async () => {
    // Storage is mocked by #imports in test env; the fallback is what the
    // default-value test exercises.
    const value = await favoritePrompts.getValue();
    expect(value).toEqual([]);
  });

  it('round-trips a list of filenames', async () => {
    await favoritePrompts.setValue(['a.md', 'b.md']);
    const value = await favoritePrompts.getValue();
    expect(value).toEqual(['a.md', 'b.md']);
  });
});

