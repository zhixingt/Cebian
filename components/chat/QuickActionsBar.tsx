import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStorageItem } from '@/hooks/useStorageItem';
import { favoritePrompts } from '@/lib/storage';
import { resolveFavorites, type ResolvedFavorite } from '@/lib/prompts/favorites';
import type { PromptMeta } from '@/lib/ai-config/scanner';
import { t } from '@/lib/i18n';

/** 快速工具 ID */
export type QuickToolId = 'read-page' | 'screenshot-analyze' | 'operate-page' | 'fill-form' | 'watch-page';

interface QuickActionsBarProps {
  /** Called when a non-broken favorite is clicked. */
  onTrigger: (prompt: PromptMeta) => void;
}

export function QuickActionsBar({ onTrigger }: QuickActionsBarProps) {
  const [favorites] = useStorageItem(favoritePrompts, []);
  const [resolved, setResolved] = useState<ResolvedFavorite[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveFavorites(favorites).then((r) => {
      if (!cancelled) setResolved(r);
    });
    return () => {
      cancelled = true;
    };
  }, [favorites]);

  // Track scroll position to show/hide arrow buttons
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState, resolved]);

  // ── Wheel horizontal scroll ──────────────────────────────────────
  const doScroll = useCallback((deltaY: number) => {
    const el = scrollRef.current;
    if (!el) return false;
    if (el.scrollWidth <= el.clientWidth) return false;
    el.scrollBy({ left: deltaY, behavior: 'auto' });
    return true;
  }, []);

  const handleReactWheel = useCallback((e: React.WheelEvent) => {
    if (!e.deltaY) return;
    if (doScroll(e.deltaY)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [doScroll]);

  useEffect(() => {
    const onDocWheel = (e: WheelEvent) => {
      if (!wrapperRef.current) return;
      if (!e.deltaY) return;
      if (!wrapperRef.current.contains(e.target as Node)) return;
      if (doScroll(e.deltaY)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('wheel', onDocWheel, { capture: true, passive: false });
    return () => {
      document.removeEventListener('wheel', onDocWheel, { capture: true });
    };
  }, [doScroll]);

  const scrollByAmount = useCallback((amount: number) => {
    scrollRef.current?.scrollBy({ left: amount, behavior: 'smooth' });
  }, []);

  if (resolved.length === 0) return null;

  return (
    <div data-testid="quick-actions-bar" className="px-4 pt-2 pb-1 bg-background">
      {/* Favorite prompt capsules (scrollable, full width) */}
        <div ref={wrapperRef} className="relative" onWheel={handleReactWheel}>
          {/* Left scroll arrow */}
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollByAmount(-120)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 size-6 rounded-full bg-background/90 border border-border shadow-sm flex items-center justify-center hover:bg-accent transition-colors"
              aria-label={t('chat.quickActions.scrollLeft')}
            >
              <ChevronLeft size={14} />
            </button>
          )}

          <div
            ref={scrollRef}
            role="toolbar"
            aria-label={t('chat.quickActions.label')}
            className="flex gap-1.5 overflow-x-auto scrollbar-none items-center"
            onWheel={handleReactWheel}
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

          {/* Right scroll arrow */}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollByAmount(120)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 size-6 rounded-full bg-background/90 border border-border shadow-sm flex items-center justify-center hover:bg-accent transition-colors"
              aria-label={t('chat.quickActions.scrollRight')}
            >
              <ChevronRight size={14} />
            </button>
          )}
        </div>
    </div>
  );
}
