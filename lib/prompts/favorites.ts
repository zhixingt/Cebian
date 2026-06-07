import { scanPrompts, type PromptMeta } from '@/lib/ai-config/scanner';

export interface ResolvedFavorite {
  /** Filename, the stable key. Always present. */
  fileName: string;
  /** Resolved prompt metadata; `undefined` when the file is missing. */
  meta: PromptMeta | undefined;
  /** True when the file is no longer present on disk. */
  broken: boolean;
}

/**
 * Resolve a list of favorite filenames into ordered prompt metadata.
 *
 * Preserves the order of `favorites` (so manual drag-to-reorder in settings
 * is reflected). Files that no longer exist on disk are returned with
 * `meta: undefined, broken: true` so the UI can render a placeholder instead
 * of dropping them silently.
 */
export async function resolveFavorites(favorites: string[]): Promise<ResolvedFavorite[]> {
  if (favorites.length === 0) return [];
  const all = await scanPrompts();
  const byName = new Map(all.map((p) => [p.fileName, p]));
  return favorites.map((fileName) => {
    const meta = byName.get(fileName);
    return { fileName, meta, broken: !meta };
  });
}
