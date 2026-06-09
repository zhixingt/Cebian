import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useStorageItem } from '@/hooks/useStorageItem';
import { favoritePrompts } from '@/lib/storage';
import { resolveFavorites, type ResolvedFavorite } from '@/lib/prompts/favorites';
import type { PromptMeta } from '@/lib/ai-config/scanner';
import { t } from '@/lib/i18n';

interface QuickActionsBarProps {
  /** Called when a non-broken favorite is clicked. */
  onTrigger: (prompt: PromptMeta) => void;
}

export function QuickActionsBar({ onTrigger }: QuickActionsBarProps) {
  const [favorites] = useStorageItem(favoritePrompts, []);
  const [resolved, setResolved] = useState<ResolvedFavorite[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    resolveFavorites(favorites).then((r) => {
      if (!cancelled) setResolved(r);
    });
    return () => {
      cancelled = true;
    };
  }, [favorites]);

  /**
   * Redirect vertical mouse-wheel events to horizontal scroll so the user
   * can browse the pill bar without a visible scrollbar.
   */
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    // Only intercept when there is horizontal overflow to scroll.
    if (el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.scrollBy({ left: e.deltaY, behavior: 'auto' });
  };

  if (resolved.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      data-testid="quick-actions-bar"
      onWheel={handleWheel}
      className="px-4 pt-2 pb-1 flex gap-1.5 overflow-x-auto scrollbar-none border-t border-border bg-background"
    >
      {resolved.map((r) => {
        if (r.broken || !r.meta) {
          return (
            <button
              key={r.fileName}
              type="button"
              aria-disabled="true"
              aria-label={r.fileName}
              title={t('chat.quickActions.broken')}
              className="shrink-0 inline-flex items-center px-2 h-7 rounded-full border border-border text-xs text-muted-foreground opacity-60 cursor-not-allowed"
              onClick={() => toast.warning(t('chat.quickActions.brokenClick'))}
            >
              <span className="max-w-32 truncate">{r.fileName}</span>
            </button>
          );
        }
        return (
          <button
            key={r.fileName}
            type="button"
            onClick={() => onTrigger(r.meta!)}
            title={r.meta!.name}
            className="shrink-0 inline-flex items-center px-2 h-7 rounded-full border border-border bg-card hover:bg-accent text-xs"
          >
            <span className="max-w-32 truncate">{r.meta!.name}</span>
          </button>
        );
      })}
    </div>
  );
}
