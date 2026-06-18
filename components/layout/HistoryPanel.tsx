import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { ArrowLeft, Trash2, MessageSquare, Search, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AGENT_PORT_NAME, type ClientMessage, type ServerMessage, type SessionMeta } from '@/lib/protocol';
import { showConfirm } from '@/lib/dialog';
import { t } from '@/lib/i18n';

const PAGE_SIZE = 50;

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t('common.time.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('common.time.minutesAgo', [minutes]);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.time.hoursAgo', [hours]);
  const days = Math.floor(hours / 24);
  if (days < 30) return t('common.time.daysAgo', [days]);
  const months = Math.floor(days / 30);
  if (months < 12) return t('common.time.monthsAgo', [months]);
  return t('common.time.yearsAgo', [Math.floor(months / 12)]);
}

interface SessionItemProps {
  session: SessionMeta;
  onSelect: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}

const SessionItem = memo(function SessionItem({ session, onSelect, onDelete }: SessionItemProps) {
  return (
    <div
      key={session.id}
      role="button"
      tabIndex={0}
      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted/50 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onSelect(session.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(session.id); } }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {session.isRunning && (
            <span
              role="img"
              aria-label={t('common.session.running')}
              title={t('common.session.running')}
              className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
            />
          )}
          <div className="text-sm font-medium truncate min-w-0">
            {session.title}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          {session.model && <span>{session.model}</span>}
          <span>·</span>
          <span>{t('common.session.messageCount', session.messageCount)}</span>
          <span>·</span>
          <span>{formatRelativeTime(session.updatedAt)}</span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
        onClick={(e) => onDelete(e, session.id)}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
});

export function HistoryPanel({ open, onClose, onSelectSession, onDeleteSession }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.model.toLowerCase().includes(q)
    );
  }, [sessions, query]);

  const visibleSessions = useMemo(() =>
    filteredSessions.slice(0, displayCount),
  [filteredSessions, displayCount]);

  const hasMore = visibleSessions.length < filteredSessions.length;

  // Reset search & pagination when panel closes
  useEffect(() => {
    if (!open) {
      setQuery('');
      setDisplayCount(PAGE_SIZE);
    }
  }, [open]);

  // Load via the background port so we can include live `isRunning` state
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const port = chrome.runtime.connect({ name: AGENT_PORT_NAME });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setLoading(false);
      try { port.disconnect(); } catch { /* already disconnected */ }
    };
    const onMessage = (msg: ServerMessage) => {
      if (msg.type === 'session_list_result') {
        setSessions(msg.sessions);
        finish();
      } else if (msg.type === 'error') {
        console.warn('[history] session_list error:', msg.error);
        finish();
      }
    };
    port.onMessage.addListener(onMessage);
    port.postMessage({ type: 'session_list' } satisfies ClientMessage);
    const timeout = setTimeout(() => {
      console.warn('[history] session_list timed out');
      finish();
    }, 5000);
    return () => {
      clearTimeout(timeout);
      port.onMessage.removeListener(onMessage);
      try { port.disconnect(); } catch { /* already disconnected */ }
      setLoading(false);
    };
  }, [open]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!open || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setDisplayCount((prev) => prev + PAGE_SIZE);
        }
      },
      { root: null, rootMargin: '100px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, hasMore, visibleSessions.length]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    const ok = await showConfirm({
      title: t('common.session.deleteConfirmTitle'),
      description: t('common.session.deleteConfirmDescription', [session.title]),
      destructive: true,
      confirmText: t('common.delete'),
    });
    if (!ok) return;
    try {
      setSessions(prev => prev.filter(s => s.id !== id));
      onDeleteSession?.(id);
      const port = chrome.runtime.connect({ name: AGENT_PORT_NAME });
      const onMessage = (msg: ServerMessage) => {
        if (msg.type === 'session_deleted' && msg.sessionId === id) {
          port.onMessage.removeListener(onMessage);
          port.disconnect();
        }
      };
      port.onMessage.addListener(onMessage);
      port.postMessage({ type: 'session_delete', sessionId: id } satisfies ClientMessage);
      setTimeout(() => {
        port.onMessage.removeListener(onMessage);
        try { port.disconnect(); } catch { /* already disconnected */ }
      }, 5000);
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [sessions, onDeleteSession]);

  return (
    <div
      className={`absolute inset-0 bg-background z-50 flex flex-col transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label={t('common.back')}>
          <ArrowLeft className="size-5" />
        </Button>
        <span className="font-semibold">{t('common.history')}</span>
      </div>

      {/* Search */}
      <div className="px-5 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.searchPlaceholder')}
            className="pl-9 pr-8 h-8 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('common.cancel')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-5 py-3 space-y-1">
          {loading && (
            <div className="text-center text-sm text-muted-foreground py-12">
              {t('common.loading')}
            </div>
          )}

          {!loading && filteredSessions.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <MessageSquare className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {query ? t('common.noMatch') : t('common.empty.history')}
              </p>
            </div>
          )}

          {!loading && visibleSessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              onSelect={onSelectSession}
              onDelete={handleDelete}
            />
          ))}

          {/* Sentinel for infinite scroll */}
          {hasMore && (
            <div ref={sentinelRef} className="flex items-center justify-center py-3 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
