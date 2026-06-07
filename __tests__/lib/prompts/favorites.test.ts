import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveFavorites } from '@/lib/prompts/favorites';
import * as scanner from '@/lib/ai-config/scanner';
import type { PromptMeta } from '@/lib/ai-config/scanner';

const makePrompt = (fileName: string, name = fileName.replace('.md', '')): PromptMeta => ({
  fileName,
  name,
  description: '',
  filePath: `/prompts/${fileName}`,
});

describe('resolveFavorites', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns [] when favorites is empty', async () => {
    const out = await resolveFavorites([]);
    expect(out).toEqual([]);
  });

  it('returns the prompts in the order of the favorites list', async () => {
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([
      makePrompt('a.md', 'alpha'),
      makePrompt('b.md', 'beta'),
      makePrompt('c.md', 'gamma'),
    ]);
    const out = await resolveFavorites(['b.md', 'a.md', 'c.md']);
    expect(out.map((p) => p.fileName)).toEqual(['b.md', 'a.md', 'c.md']);
  });

  it('marks missing files as broken with undefined meta', async () => {
    vi.spyOn(scanner, 'scanPrompts').mockResolvedValue([makePrompt('a.md')]);
    const out = await resolveFavorites(['a.md', 'missing.md']);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ fileName: 'a.md', broken: false });
    expect(out[1]).toMatchObject({ fileName: 'missing.md', broken: true, meta: undefined });
  });
});
