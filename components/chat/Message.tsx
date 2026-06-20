import {
  Bot,
  ChevronRight,
  Lightbulb,
  CircleHelp,
  CheckCircle,
  Send,
  Crosshair,
  FileText,
  Film,
  Copy,
  Trash2,
  Pencil,
} from 'lucide-react';
import { useState, useEffect, useRef, useMemo, type ReactNode, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MarkdownRenderer } from '@/components/common/MarkdownRenderer';
import { MessageMetaRow, type MessageMetaProps } from '@/components/chat/MessageMetaRow';
import { extractUserText, extractUserAttachments } from '@/lib/message-helpers';
import { showDialog } from '@/lib/dialog';
import { RECORDING_MIME } from '@/lib/attachments';
import { t } from '@/lib/i18n';
import { downloadFile, formatDuration, formatCharCount } from '@/lib/utils';
import { copyText as copyToClipboard } from '@/lib/clipboard';
import type { Message } from '@earendil-works/pi-ai';

/* ─── Message Actions (hover copy + edit + delete) ─── */
function MessageActions({
  onCopy,
  onEdit,
  onDelete,
}: {
  onCopy?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      {onCopy && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          aria-label={t('common.copy')}
        >
          <Copy className="size-3" />
        </Button>
      )}
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={t('common.edit')}
        >
          <Pencil className="size-3" />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={t('common.delete')}
        >
          <Trash2 className="size-3" />
        </Button>
      )}
    </div>
  );
}

/* ─── User Message ─── */
export function UserMessageBubble({
  msg,
  children,
  onCopy,
  onEdit,
  onDelete,
}: {
  msg?: Message;
  children?: ReactNode;
  onCopy?: () => void;
  onEdit?: (newText: string) => void;
  onDelete?: () => void;
}) {
  const text = msg ? extractUserText(msg) : null;
  const attachments = useMemo(() => (msg ? extractUserAttachments(msg) : null), [msg]);
  const hasAttachments =
    attachments &&
    (attachments.images.length > 0 ||
      attachments.elements.length > 0 ||
      attachments.files.length > 0 ||
      attachments.recordings.length > 0);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleEditSubmit = () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === text) {
      setIsEditing(false);
      return;
    }
    onEdit?.(trimmed);
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditText(text ?? '');
    }
  };

  return (
    <div className="self-end max-w-[95%] group">
      <div className="flex items-start gap-1 justify-end">
        {!isEditing && (
          <MessageActions
            onCopy={onCopy ?? (text ? () => copyToClipboard(text) : undefined)}
            onEdit={
              onEdit
                ? () => {
                    setEditText(text ?? '');
                    setIsEditing(true);
                  }
                : undefined
            }
            onDelete={onDelete}
          />
        )}
        {isEditing ? (
          <div className="flex flex-col gap-1.5 w-full min-w-[200px]">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className="bg-card border border-border px-4 py-3 rounded-2xl text-[0.9rem] leading-relaxed w-full ml-auto whitespace-pre-wrap break-all resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 min-h-[60px]"
              rows={1}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setIsEditing(false);
                  setEditText(text ?? '');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs"
                disabled={!editText.trim() || editText.trim() === text}
                onClick={handleEditSubmit}
              >
                <Send className="size-3 mr-1" />
                {t('common.send')}
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="bg-card border border-border px-4 py-3 rounded-2xl text-[0.9rem] leading-relaxed w-fit ml-auto whitespace-pre-wrap break-all text-justify"
            style={{ textAlignLast: 'left' }}
          >
            {text ?? children}
          </div>
        )}
      </div>

      {hasAttachments && (
        <div className="flex gap-1.5 flex-wrap items-center justify-end mt-1.5 px-1">
          {attachments.images.map((img, i) => (
            <Badge
              key={`img-${i}`}
              variant="outline"
              className="shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-0.5 pr-1 text-purple-400 border-purple-400/20 bg-purple-400/5"
            >
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={t('chat.attachments.imageAlt')}
                className="h-3.5 w-auto rounded-sm object-cover cursor-pointer"
                onClick={() =>
                  showDialog('image-preview', {
                    src: `data:${img.mimeType};base64,${img.data}`,
                  })
                }
              />
              {t('chat.attachments.image')}
            </Badge>
          ))}
          {attachments.elements.map((el, i) => (
            <Badge
              key={`el-${i}`}
              variant="outline"
              className="shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-1 pr-1 text-info border-info/20 bg-info/5"
            >
              <Crosshair className="size-2.5 shrink-0" />
              <span className="truncate max-w-24">{el.selector}</span>
            </Badge>
          ))}
          {attachments.files.map((f, i) => (
            <Badge
              key={`file-${i}`}
              variant="outline"
              className="shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-1 pr-1 text-emerald-400 border-emerald-400/20 bg-emerald-400/5"
            >
              <FileText className="size-2.5 shrink-0" />
              <span className="truncate max-w-24">{f.name}</span>
            </Badge>
          ))}
          {attachments.recordings.map((r, i) => (
            <Badge
              key={`rec-${i}`}
              variant="outline"
              className="shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-1 pr-1 text-amber-400 border-amber-400/20 bg-amber-400/5 cursor-pointer hover:bg-amber-400/10"
              title={`${t('chat.attachments.recordingDownload')}\n${t('chat.attachments.recordingHover', [String(r.eventCount), formatCharCount(r.json.length)])}`}
              onClick={() => downloadFile(r.name, r.json, RECORDING_MIME)}
            >
              <Film className="size-2.5 shrink-0" />
              <span className="truncate max-w-40">
                {r.name} ·{' '}
                {t('chat.attachments.recordingMeta', [
                  String(r.eventCount),
                  formatDuration(r.durationMs),
                ])}
                {r.truncated ? ` · ${t('chat.attachments.recordingTruncated')}` : ''}
              </span>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Agent Message ─── */
export function AgentMessage({
  children,
  isStreaming,
  showHeader = true,
  meta,
  copyText,
  onRetry,
  onDelete,
}: {
  children?: ReactNode;
  isStreaming?: boolean;
  showHeader?: boolean;
  /** Meta is rendered as soon as `!isStreaming`; the copy button inside the
   * row is gated on `copyText` (skipped for pure tool-call turns). */
  meta?: Omit<MessageMetaProps, 'text' | 'onRetry'>;
  copyText?: string;
  /** When provided, a retry button is shown in the meta row. Caller decides
   *  eligibility (last turn-closing assistant, agent idle). */
  onRetry?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={`self-start w-full group ${showHeader ? '' : '-mt-1'}`}>
      {showHeader && (
        <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground font-medium">
          <Bot className="size-3.5 text-primary" />
          Cebian Agent
        </div>
      )}
      <div className="flex items-start gap-1">
        <div className="text-[0.9rem] leading-relaxed space-y-3 flex-1 min-w-0">
          {children}
          {isStreaming && (
            <span
              aria-hidden
              className="inline-block w-2 h-4.5 bg-primary animate-pulse rounded-sm align-text-bottom ml-0.5"
            />
          )}
        </div>
        {!isStreaming && (
          <MessageActions
            onCopy={copyText ? () => copyToClipboard(copyText) : undefined}
            onDelete={onDelete}
          />
        )}
      </div>
      {!isStreaming && (meta || copyText || onRetry) && (
        <MessageMetaRow {...(meta ?? {})} text={copyText} onRetry={onRetry} />
      )}
    </div>
  );
}

/* ─── Collapsible Container (auto-fold long messages) ─── */
function CollapsibleContainer({
  children,
  maxLines = 5,
}: {
  children: ReactNode;
  maxLines?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const lineHeight = Number.isFinite(lh) ? lh : el.clientHeight / maxLines;
      if (!lineHeight) return;
      setNeedsCollapse(el.scrollHeight > lineHeight * maxLines + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, maxLines]);

  return (
    <div>
      <div
        ref={contentRef}
        className={isExpanded ? '' : 'overflow-hidden'}
        style={isExpanded ? undefined : { maxHeight: `${maxLines * 1.6}em` }}
      >
        {children}
      </div>
      {needsCollapse && (
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="mt-1 text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
        >
          {isExpanded ? (
            <>
              {t('chat.collapse')} <ChevronRight className="size-3 -rotate-90" />
            </>
          ) : (
            <>
              {t('chat.expand')} <ChevronRight className="size-3 rotate-90" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

/* ─── Agent Text Block (Markdown) ─── */
export function AgentTextBlock({ content }: { content: string }) {
  return (
    <CollapsibleContainer>
      <MarkdownRenderer content={content} />
    </CollapsibleContainer>
  );
}

/* ─── Thinking Block (renders pi-ai ThinkingContent) ─── */
export function ThinkingBlock({ content, isLive }: { content: string; isLive?: boolean }) {
  const [manualOpen, setManualOpen] = useState(false);
  const wasLive = useRef(false);

  // Auto-collapse when transitioning from live to done
  useEffect(() => {
    if (wasLive.current && !isLive) {
      setManualOpen(false);
    }
    wasLive.current = !!isLive;
  }, [isLive]);

  const isOpen = isLive || manualOpen;

  return (
    <div className="border border-border rounded-lg overflow-hidden text-xs bg-card/30">
      <button
        onClick={() => !isLive && setManualOpen(!manualOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-muted-foreground font-mono text-[0.75rem] hover:text-foreground hover:bg-card/40 transition-colors"
      >
        <ChevronRight
          className={`size-2.5 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        />
        <Lightbulb className="size-3 text-primary" />
        {isLive ? t('chat.thinkingBlock.live') : t('chat.thinkingBlock.label')}
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div
          className={`overflow-hidden transition-opacity duration-200 ease-in-out ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        >
          <div className="px-3 py-3 border-t border-dashed border-border text-muted-foreground font-mono text-[0.75rem] leading-relaxed bg-card/50">
            <MarkdownRenderer content={content} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Ask User Block (interactive tool UI) ─── */
export function AskUserBlock({
  question,
  options,
  allowFreeText = true,
  answered,
  onSelect,
}: {
  question: string;
  options?: { label: string; description?: string }[];
  allowFreeText?: boolean;
  answered?: boolean;
  onSelect?: (text: string) => void;
}) {
  const [freeText, setFreeText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFreeTextSubmit = () => {
    if (!freeText.trim()) return;
    onSelect?.(freeText.trim());
    setFreeText('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFreeTextSubmit();
    }
  };

  return (
    <div
      className={`relative mt-3 p-3.5 border border-primary/20 bg-primary/5 rounded-lg ${answered ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <div className="flex items-center gap-2 text-primary font-medium text-[0.85rem] mb-1.5">
        <CircleHelp className="size-4.5 shrink-0" />
        {question}
      </div>

      {/* Option buttons */}
      {(() => {
        // Defensive: model may stream partial JSON or return wrong type (string / object).
        // Only render when options is a real array of objects with a label.
        const safeOptions = Array.isArray(options)
          ? options.filter(
              (o): o is { label: string; description?: string } =>
                !!o &&
                typeof o === 'object' &&
                typeof (o as { label?: unknown }).label === 'string',
            )
          : [];
        if (safeOptions.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-2 mt-2.5">
            {safeOptions.map((opt, i) => (
              <Button
                key={`${i}-${opt.label}`}
                variant="outline"
                size="sm"
                className="text-xs h-7"
                disabled={!onSelect}
                onClick={() => onSelect?.(opt.label)}
                title={opt.description}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        );
      })()}

      {/* Free text input */}
      {allowFreeText && onSelect && (
        <div className="flex items-end gap-1.5 mt-2.5">
          <textarea
            ref={textareaRef}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.askUser.placeholder')}
            rows={1}
            className="flex-1 resize-none bg-background border border-border rounded-md px-2.5 py-1.5 text-xs leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleFreeTextSubmit}
            disabled={!freeText.trim()}
            className="shrink-0"
          >
            <Send className="size-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Execution Success ─── */
export function ExecutionResult({
  message,
  actions,
}: {
  message: string;
  actions?: { label: string; primary?: boolean; onClick?: () => void }[];
}) {
  return (
    <>
      <p className="text-success text-[0.85rem] flex items-center gap-1.5 mt-3">
        <CheckCircle className="size-3.5" />
        {message}
      </p>
      {actions && actions.length > 0 && (
        <div className="flex gap-2 mt-2">
          {actions.map((a) => (
            <Button
              key={a.label}
              variant={a.primary ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-7"
              onClick={a.onClick}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
