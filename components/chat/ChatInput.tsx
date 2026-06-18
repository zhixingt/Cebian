import { useState, useRef, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react';
import { Send, Square, MousePointer2, Camera, Paperclip, Smartphone, Crosshair, FileText, X, FileType, Film, Play, Pencil, BookOpen, Scissors, MousePointerClick, FileInput, Eye, Loader2 } from 'lucide-react';
import { showDialog } from '@/lib/dialog';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ModelSelector } from '@/components/chat/ModelSelector';
import { ThinkingLevelSelector } from '@/components/chat/ThinkingLevelSelector';
import { RecordButton } from '@/components/chat/RecordButton';
import { useStorageItem } from '@/hooks/useStorageItem';
import { activeModel, thinkingLevel, providerCredentials, customProviders as customProvidersStorage, type ThinkingLevel } from '@/lib/storage';
import { getModel } from '@earendil-works/pi-ai';
import { isCustomProvider, findCustomModel } from '@/lib/custom-models';
import { startElementPicker, cancelElementPicker } from '@/lib/element-picker';
import { scanPrompts, type PromptMeta } from '@/lib/ai-config/scanner';
import { makeTriggerSlashPrompt } from '@/lib/chat/trigger-slash-prompt';
import {
  MAX_ATTACHMENT_COUNT, MAX_IMAGE_SIZE, MAX_TEXT_FILE_SIZE,
  RECORDING_MIME,
  isImageFile, isTextFile, formatFileSize,
  isExtractableFile, extractTextFromFile,
  ACCEPT_EXTENSIONS,
  type Attachment,
} from '@/lib/attachments';
import { recordingToAttachment } from '@/lib/recorder/to-attachment';
import { sessionToSequence } from '@/lib/recorder/session-to-sequence';
import type { RecordedSession } from '@/lib/recorder/types';
import type { SequenceStep } from '@/lib/recorder/session-to-sequence';
import { recorderChannel } from '@/lib/recorder/sidepanel-channel';
import { RecordingEditor } from '@/components/chat/RecordingEditor';
import { useRecorder } from '@/hooks/useRecorder';
import { useWebProviders } from '@/hooks/useWebProviders';
import { useMobileEmulation } from '@/hooks/useMobileEmulation';
import { downloadFile, formatDuration, formatCharCount } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { PromptDispatchResult } from '@/hooks/useBackgroundAgent';
import type { QuickToolId } from '@/components/chat/QuickActionsBar';

/** 页面操作快速工具定义（与 QuickActionsBar 原先的一致） */
const QUICK_TOOLS = [
  { id: 'read-page' as QuickToolId, icon: BookOpen, labelKey: 'chat.quickActions.toolReadPage' },
  { id: 'screenshot-analyze' as QuickToolId, icon: Scissors, labelKey: 'chat.quickActions.toolScreenshotAnalyze' },
  { id: 'operate-page' as QuickToolId, icon: MousePointerClick, labelKey: 'chat.quickActions.toolOperatePage' },
  { id: 'fill-form' as QuickToolId, icon: FileInput, labelKey: 'chat.quickActions.toolFillForm' },
  { id: 'watch-page' as QuickToolId, icon: Eye, labelKey: 'chat.quickActions.toolWatchPage' },
] as const;

interface ChatInputProps {
  onSend: (
    message: string,
    attachments: Attachment[] | undefined,
    expectedSessionId: string | null,
  ) => Promise<PromptDispatchResult>;
  onOpenSettings?: () => void;
  isAgentRunning?: boolean;
  onCancel?: () => void;
  /** User-message texts already sent in this session, oldest first. */
  userHistory?: string[];
  /** Conversation id; changing it resets history navigation state. */
  sessionId?: string | null;
  /** Called when a page-operation quick tool button is clicked. */
  onQuickTool?: (toolId: QuickToolId) => void;
  /** Whether page watcher is currently active (for watch-page button state). */
  isWatching?: boolean;
}

/**
 * Imperative handle exposed via `forwardRef`. The chat page uses this to
 * trigger a prompt from the QuickActionsBar without re-mounting the composer
 * or mirroring `value` state in the parent.
 */
export interface ChatInputHandle {
  /**
   * Resolve the prompt at the given filename via the same `triggerSlashPrompt`
   * factory the slash menu uses, and write the resolved text into the
   * composer. Returns when the text is in the textarea.
   */
  handleQuickAction: (fileName: string) => Promise<void>;
}

// ─── ReplayButton：打开录制编辑器 ───

function ReplayButton({ disabled, attachments, onOpenEditor }: {
  disabled?: boolean;
  attachments: Attachment[];
  onOpenEditor: (recording: Attachment) => void;
}) {
  // 找到最近的录制附件
  const lastRecording = useMemo(() => {
    for (let i = attachments.length - 1; i >= 0; i--) {
      if (attachments[i].type === 'recording') return attachments[i];
    }
    return null;
  }, [attachments]);

  const hasRecording = lastRecording !== null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => lastRecording && onOpenEditor(lastRecording)}
            disabled={disabled || !hasRecording}
            aria-label={hasRecording ? t('chat.recorder.editAndReplay') : t('chat.recorder.none')}
          >
            <Play className="size-3.5" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {hasRecording ? t('chat.recorder.editAndReplay') : t('chat.recorder.none')}
      </TooltipContent>
    </Tooltip>
  );
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { onSend, onOpenSettings, isAgentRunning, onCancel, userHistory, sessionId, onQuickTool, isWatching },
  ref,
) {
  const [value, setValue] = useState('');
  const [showSlash, setShowSlash] = useState(false);
  const [prompts, setPrompts] = useState<PromptMeta[]>([]);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Mirror of `attachments` for synchronous reads after an await. The
  // recorder's `subscribeSession` callback fires synchronously when the
  // BG delivers a session, but React state isn't flushed by the time
  // `await recorder.stop()` resumes — so we keep this ref so handleSend
  // can read the post-stop attachment list without waiting for a render.
  const attachmentsRef = useRef<Attachment[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  // History navigation: null = editing the current draft; otherwise points
  // into `userHistory`. `draft` stashes whatever the user had typed before
  // entering history mode so we can restore it on ↓-past-end.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const { isActiveTabMobile, toggle: toggleMobile } = useMobileEmulation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(sessionId ?? null);
  sessionIdRef.current = sessionId ?? null;

  const [currentModel, setCurrentModel] = useStorageItem(activeModel, null);
  const [currentThinkingLevel, setCurrentThinkingLevel] = useStorageItem(thinkingLevel, 'medium');
const [providers] = useStorageItem(providerCredentials, {});
const [customProviderList] = useStorageItem(customProvidersStorage, []);
// ③+④: feed Web (Browser Session) providers into the model selector
const { providers: webProvidersList } = useWebProviders();

  const isReasoningModel = useMemo(() => {
    if (!currentModel) return false;

    if (isCustomProvider(currentModel.provider)) {
      return findCustomModel(customProviderList, currentModel.provider, currentModel.modelId)?.reasoning ?? false;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- modelId is dynamic, pi-ai expects string literal
      return (getModel as any)(currentModel.provider, currentModel.modelId)?.reasoning ?? false;
    } catch {
      return false;
    }
  }, [currentModel, customProviderList]);

  // 当前模型是否支持图片（多模态/VLM）输入。统一读 pi-ai Model.input 是否包含 'image'：
  // 自定义模型的 input 由 toModel 根据 image 字段生成，内置模型由 getModel 提供。
  const supportsImage = useMemo(() => {
    if (!currentModel) return false;

    if (isCustomProvider(currentModel.provider)) {
      return findCustomModel(customProviderList, currentModel.provider, currentModel.modelId)?.input?.includes('image') ?? false;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- modelId is dynamic, pi-ai expects string literal
      return (getModel as any)(currentModel.provider, currentModel.modelId)?.input?.includes('image') ?? false;
    } catch {
      return false;
    }
  }, [currentModel, customProviderList]);

  // 异步图片生产者（截图 await、FileReader.onload）可能在用户切换到纯文本
  // 模型之后才回调，用 ref 同步读取最新的 supportsImage，避免迟到的图片被追加。
  const supportsImageRef = useRef(supportsImage);
  supportsImageRef.current = supportsImage;

  // 切换到不支持图片的模型时，自动剥离已有的图片附件（保留文件附件），
  // 避免把图片发给纯文本模型导致请求异常。
  useEffect(() => {
    if (supportsImage) return;
    setAttachments((prev) => {
      if (!prev.some((a) => a.type === 'image')) return prev;
      toast.info(t('chat.composer.imageStripped'));
      return prev.filter((a) => a.type !== 'image');
    });
  }, [supportsImage]);

  const handleModelSelect = useCallback((provider: string, modelId: string) => {
    setCurrentModel({ provider, modelId });
  }, [setCurrentModel]);

  const handleThinkingSelect = (level: ThinkingLevel) => {
    setCurrentThinkingLevel(level);
  };

  // ── Page-operation quick tools (moved from QuickActionsBar) ──
  const [pendingTool, setPendingTool] = useState<QuickToolId | null>(null);
  const handleToolClick = useCallback(
    (toolId: QuickToolId) => {
      if (pendingTool) return;
      if (toolId === 'watch-page') {
        onQuickTool?.(toolId);
        return;
      }
      setPendingTool(toolId);
      onQuickTool?.(toolId);
      setTimeout(() => setPendingTool(null), 2000);
    },
    [onQuickTool, pendingTool],
  );

  // Auto-resize textarea. When the value is empty (initial mount, after
  // send) we clear the inline height entirely and let CSS `min-h-11 /
  // max-h-37.5` drive sizing. This avoids a first-paint race in the
  // sidepanel where `scrollHeight` is read before fonts / Tailwind / the
  // first layout pass have stabilized — in that window the textarea is
  // measured against browser defaults and can report a height >= 150,
  // which then gets clamped to 150px and frozen as inline style until the
  // user types the first character.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!value) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, [value]);

  // Cancel picker on unmount
  useEffect(() => {
    return () => { cancelElementPicker(); };
  }, []);

  // Cancel picker on Esc key (sidepanel has focus, not the page)
  useEffect(() => {
    if (!isPicking) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelElementPicker();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isPicking]);

  const canSend = value.trim().length > 0;

  // Recorder integration. The captured session lands in attachments via
  // the channel subscription below — NOT via `recorder.stop()`'s return
  // value. handleSend just needs to await stop() so any in-flight session
  // delivery completes before we read attachments.
  const recorder = useRecorder();
  // Guard the short dispatch window: recorder finalization plus prompt
  // delivery / one fast reconnect retry. Once the prompt is dispatched,
  // the composer becomes editable again while the agent replies.
  const isDispatchingRef = useRef(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRecording, setEditorRecording] = useState<Attachment | null>(null);

  // Keep the ref in sync with state so any post-await reader sees the
  // most-recent attachments without depending on a re-render.
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Subscribe to recorder sessions delivered by the background. Fires for
  // every finished recording (manual stop button, send-time auto-stop,
  // cap-trigger), so this is the single sink for recording attachments.
  //
  // We compute the next list from `attachmentsRef.current` and write
  // BOTH the ref and the state SYNCHRONOUSLY — NOT inside a
  // `setAttachments(prev => ...)` updater. React 18 defers the updater's
  // execution until the next flush, but `useRecorder.stop()`'s await
  // resumption is a microtask scheduled at the same publishSession call,
  // so by the time handleSend reads `attachmentsRef.current` the updater
  // hasn't run yet. Writing the ref outside the updater ensures handleSend
  // sees the new chip before dispatching `onSend`.
  useEffect(() => {
    return recorderChannel.subscribeSession((session) => {
      console.log('[recorder] session finalized', {
        eventCount: session.events.length,
        durationMs: session.durationMs,
        truncated: session.truncated,
        windowId: session.windowId,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        session,
      });
      const current = attachmentsRef.current;
      if (current.length >= MAX_ATTACHMENT_COUNT) {
        toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
        return;
      }
      const next = [...current, recordingToAttachment(session)];
      attachmentsRef.current = next;
      setAttachments(next);
    });
  }, []);

  const handleSend = async () => {
    if (!canSend) return;
    if (isDispatchingRef.current) return;
    if (!currentModel) {
      toast.error(t('chat.composer.needModel'), {
        action: onOpenSettings ? { label: t('chat.composer.goToSettings'), onClick: onOpenSettings } : undefined,
      });
      return;
    }

    // Snapshot the text BEFORE any await so a fast follow-up edit doesn't
    // leak into the outgoing message.
    const text = value.trim();
    const dispatchSessionId = sessionIdRef.current;

    isDispatchingRef.current = true;
    setIsDispatching(true);

    try {
      if (recorder.isOwner) {
        // Pre-flight cap check: refuse to send if attachments are already
        // full — otherwise the about-to-be-delivered recording would be
        // silently dropped by the session subscription's overflow guard.
        if (attachmentsRef.current.length >= MAX_ATTACHMENT_COUNT) {
          toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
          return;
        }
        // Wait for the BG to finalize. The session is delivered (and
        // appended to `attachmentsRef`) synchronously by the channel
        // subscription above before this await resolves.
        await recorder.stop();
      }
      if (sessionIdRef.current !== dispatchSessionId) return;

      const outgoing = attachmentsRef.current;
      const result = await onSend(text, outgoing.length > 0 ? outgoing : undefined, dispatchSessionId);
      if (result.status !== 'dispatched') return;
      if (sessionIdRef.current !== dispatchSessionId) return;

      setValue('');
      setAttachments([]);
      attachmentsRef.current = [];
      setShowSlash(false);
      setHistoryIndex(null);
      setDraft('');
    } finally {
      isDispatchingRef.current = false;
      setIsDispatching(false);
    }
  };

  // Reset history navigation when switching sessions.
  useEffect(() => {
    setHistoryIndex(null);
    setDraft('');
  }, [sessionId]);

  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't intercept anything while the IME is composing (e.g. Chinese pinyin).
    if (e.nativeEvent.isComposing) return;

    // Slash menu keyboard navigation. Only active while the menu is actually
    // rendered with at least one selectable item — when it's hidden (no
    // match) all keys fall through to the default textarea behaviour
    // (history nav, send, etc.).
    if (isSlashMenuVisible && filteredPrompts.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedPromptIndex((i) => (i + 1) % filteredPrompts.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedPromptIndex((i) => (i - 1 + filteredPrompts.length) % filteredPrompts.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const target = filteredPrompts[selectedPromptIndex] ?? filteredPrompts[0];
        if (target) handlePromptSelect(target);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlash(false);
        return;
      }
    }

    // ↑ / ↓ navigate previously sent user messages, but only when the caret
    // is at the absolute start (↑) or end (↓) of the textarea, so multi-line
    // editing is never disturbed. The slash command menu (when visible)
    // reserves these keys for its own use; once it's hidden — including the
    // "no match" case — history navigation resumes.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isSlashMenuVisible && userHistory && userHistory.length > 0) {
      const ta = textareaRef.current;
      if (ta) {
        // After history navigation, place the caret to keep further presses
        // ergonomic: ↑ leaves caret at start so the next ↑ keeps walking back;
        // ↓ leaves caret at end so the next ↓ keeps walking forward (and
        // typing continues from where the user is most likely to edit).
        const moveCursor = (where: 'start' | 'end') => {
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            const pos = where === 'end' ? el.value.length : 0;
            el.setSelectionRange(pos, pos);
          });
        };

        if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
          if (historyIndex === null) {
            e.preventDefault();
            setDraft(ta.value);
            const last = userHistory.length - 1;
            setHistoryIndex(last);
            setValue(userHistory[last]);
            moveCursor('start');
            return;
          }
          if (historyIndex > 0) {
            e.preventDefault();
            const next = historyIndex - 1;
            setHistoryIndex(next);
            setValue(userHistory[next]);
            moveCursor('start');
            return;
          }
          // Already at oldest entry — fall through.
        }

        if (
          e.key === 'ArrowDown'
          && historyIndex !== null
          && ta.selectionStart === ta.value.length
          && ta.selectionEnd === ta.value.length
        ) {
          e.preventDefault();
          if (historyIndex < userHistory.length - 1) {
            const next = historyIndex + 1;
            setHistoryIndex(next);
            setValue(userHistory[next]);
          } else {
            setHistoryIndex(null);
            setValue(draft);
          }
          moveCursor('end');
          return;
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isAgentRunning && !isDispatching) handleSend();
    }
  };

  const handleInput = (val: string) => {
    setValue(val);
    setShowSlash(val.startsWith('/'));
    // Manual edits exit history mode — the new content becomes the draft.
    if (historyIndex !== null) setHistoryIndex(null);
  };

  // Scan prompts when slash menu opens
  useEffect(() => {
    if (!showSlash) return;
    scanPrompts().then(setPrompts).catch(() => setPrompts([]));
  }, [showSlash]);

  // Filter prompts by typed search (after '/')
  const slashFilter = value.startsWith('/') ? value.slice(1).toLowerCase() : '';
  const filteredPrompts = slashFilter
    ? prompts.filter((p) => p.name.toLowerCase().includes(slashFilter) || p.description.toLowerCase().includes(slashFilter))
    : prompts;

  // Menu hides when the user has typed a search term that matches nothing —
  // in that case Enter falls through to send the literal `/xxx` text.
  // When the search is empty we keep the menu open even if there are no
  // prompts at all, so the user sees the "no prompts yet" empty state.
  const isSlashMenuVisible = showSlash && (slashFilter === '' || filteredPrompts.length > 0);

  // Clamp the highlighted index whenever the visible list changes.
  useEffect(() => {
    if (filteredPrompts.length === 0) {
      setSelectedPromptIndex(0);
      return;
    }
    setSelectedPromptIndex((i) => Math.min(Math.max(i, 0), filteredPrompts.length - 1));
  }, [filteredPrompts.length]);

  // Reset highlight to the top whenever the menu (re)opens.
  useEffect(() => {
    if (isSlashMenuVisible) setSelectedPromptIndex(0);
  }, [isSlashMenuVisible]);

  // Keep the highlighted item in view when navigating with the keyboard.
  useEffect(() => {
    if (!isSlashMenuVisible) return;
    const el = slashMenuRef.current?.querySelector<HTMLElement>(`[data-prompt-index="${selectedPromptIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedPromptIndex, isSlashMenuVisible]);

  // Build a stable trigger instance once per mount. `toast` is the
  // module-scope sonner import; `setValue` / `setShowSlash` / the
  // textarea ref are stable for the component's lifetime — the closure
  // captures them once and reuses the same vfs / template chain for
  // every prompt the user picks.
  const triggerSlashPrompt = useMemo(
    () =>
      makeTriggerSlashPrompt({
        toast,
        onLoaded: (text) => {
          setValue(text);
          setShowSlash(false);
          textareaRef.current?.focus();
        },
      }),
    [],
  );

  // Handle prompt selection from slash menu. The factory does the heavy
  // lifting (vfs read → parseFrontmatter → gatherTemplateVars →
  // replaceTemplateVars); we keep the dispatching-guard around it so
  // concurrent handleSend / handlePromptSelect calls don't double-write
  // the textarea.
  const handlePromptSelect = async (prompt: PromptMeta) => {
    if (isDispatchingRef.current) return;
    await triggerSlashPrompt(prompt);
    if (isDispatchingRef.current) return;
  };

  // Quick Actions Bar trigger — called by the parent via ref. Looks up the
  // prompt by filename and runs it through the same factory the slash menu
  // uses, so behavior is identical regardless of how the user picked the
  // prompt. Re-uses the dispatching guard for symmetry with the slash path.
  const handleQuickAction = useCallback(
    async (fileName: string) => {
      if (isDispatchingRef.current) return;
      const all = await scanPrompts();
      const prompt = all.find((p) => p.fileName === fileName);
      if (!prompt) return;
      await triggerSlashPrompt(prompt);
    },
    [triggerSlashPrompt],
  );

  useImperativeHandle(ref, () => ({ handleQuickAction }), [handleQuickAction]);

  const handlePickElement = async () => {
    if (isDispatchingRef.current) return;
    if (isPicking) {
      cancelElementPicker();
      return;
    }
    setIsPicking(true);
    try {
      const result = await startElementPicker();
      if (isDispatchingRef.current) return;
      switch (result.status) {
        case 'ok': {
          const att = result.attachment;
          // Deduplicate: same selector + same frameId
          const isDuplicate = attachments.some(
            (a) => a.type === 'element' && a.selector === att.selector && a.frameId === att.frameId,
          );
          if (isDuplicate) {
            toast.info(t('chat.composer.elementAdded'));
          } else if (attachments.length >= MAX_ATTACHMENT_COUNT) {
            toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
          } else {
            setAttachments((prev) => [...prev, att]);
          }
          break;
        }
        case 'cancelled':
          break;
        case 'error':
          if (result.reason === 'unsupported-page') {
            toast.warning(t('chat.composer.elementPickUnsupported'));
          } else if (result.reason === 'navigation') {
            toast.warning(t('chat.composer.elementPickNavigated'));
          } else {
            toast.error(t('chat.composer.elementPickFailed'));
            if (result.message) console.error('[Element Picker]', result.message);
          }
          break;
      }
    } catch (err) {
      toast.error(t('chat.composer.elementPickFailed'));
      console.error('[Element Picker]', err);
    } finally {
      setIsPicking(false);
      textareaRef.current?.focus();
    }
  };

  const handleScreenshot = async () => {
    if (isDispatchingRef.current) return;
    // 纯文本模型不支持截图（图片）输入，按钮也会被禁用，这里再兜底一次。
    if (!supportsImage) {
      toast.warning(t('chat.composer.modelNoImage'));
      return;
    }
    if (attachments.length >= MAX_ATTACHMENT_COUNT) {
      toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
      return;
    }
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 85 });
      if (isDispatchingRef.current) return;
      if (!supportsImageRef.current) return;
      const base64 = dataUrl.split(',', 2)[1] ?? '';
      setAttachments((prev) => [
        ...prev,
        { type: 'image', source: 'screenshot', data: base64, mimeType: 'image/jpeg' },
      ]);
    } catch (err) {
      toast.error(t('chat.composer.screenshotFailed'));
      console.error('[Screenshot]', err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isDispatchingRef.current) {
      e.target.value = '';
      return;
    }
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = MAX_ATTACHMENT_COUNT - attachments.length;
    if (remaining <= 0) {
      toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
      e.target.value = '';
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      toast.warning(t('chat.composer.truncatedFiles', [remaining]));
    }

    for (const file of filesToProcess) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      console.log('[upload] processing file:', file.name, 'size:', file.size, 'type:', file.type, 'ext:', ext);

      // Legacy .doc is not extractable in browser — prompt conversion
      if (ext === '.doc') {
        toast.info(t('chat.upload.docConvertHint'));
        continue;
      }

      try {
        if (isImageFile(file)) {
          // 当前模型不支持多模态时，跳过图片文件（文本文件仍照常处理）。
          if (!supportsImage) {
            toast.warning(t('chat.composer.modelNoImage'));
            continue;
          }
          if (file.size > MAX_IMAGE_SIZE) {
            toast.error(t('chat.composer.fileTooLarge', [file.name, formatFileSize(MAX_IMAGE_SIZE)]));
            continue;
          }
          const reader = new FileReader();
          reader.onload = () => {
            if (isDispatchingRef.current) return;
            if (!supportsImageRef.current) return;
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',', 2)[1] ?? '';
            const mimeType = file.type || 'image/png';
            setAttachments((prev) => {
              if (prev.length >= MAX_ATTACHMENT_COUNT) return prev;
              return [...prev, { type: 'image', source: 'upload', data: base64, mimeType, name: file.name }];
            });
          };
          reader.onerror = () => toast.error(t('chat.composer.readFileFailed', [file.name]));
          reader.readAsDataURL(file);
        } else if (isExtractableFile(file.name)) {
          // PDF / DOCX / XLSX — extract plain text in browser
          if (file.size > MAX_TEXT_FILE_SIZE * 10) {
            toast.error(t('chat.composer.fileTooLarge', [file.name, formatFileSize(MAX_TEXT_FILE_SIZE * 10)]));
            continue;
          }
          console.log('[upload] extracting text from', file.name);
          const extracted = await extractTextFromFile(file);
          console.log('[upload] extracted result for', file.name, ':', extracted ? `length=${extracted.length}` : 'null');
          if (extracted != null) {
            setAttachments((prev) => {
              if (prev.length >= MAX_ATTACHMENT_COUNT) return prev;
              return [...prev, { type: 'file', content: extracted, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size }];
            });
          } else {
            toast.error(t('chat.composer.readFileFailed', [file.name]));
          }
        } else if (isTextFile(file.name)) {
          if (file.size > MAX_TEXT_FILE_SIZE) {
            toast.error(t('chat.composer.fileTooLarge', [file.name, formatFileSize(MAX_TEXT_FILE_SIZE)]));
            continue;
          }
          const reader = new FileReader();
          reader.onload = () => {
            if (isDispatchingRef.current) return;
            setAttachments((prev) => {
              if (prev.length >= MAX_ATTACHMENT_COUNT) return prev;
              return [...prev, { type: 'file', content: reader.result as string, name: file.name, mimeType: file.type || 'text/plain', size: file.size }];
            });
          };
          reader.onerror = () => toast.error(t('chat.composer.readFileFailed', [file.name]));
          reader.readAsText(file);
        } else {
          toast.error(t('chat.composer.unsupportedFileType', [file.name]));
        }
      } catch (err) {
        console.error('[upload] unexpected error processing', file.name, err);
        toast.error(t('chat.composer.readFileFailed', [file.name]));
      }
    }

    // Reset input so the same file can be selected again
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isDispatchingRef.current) return;
    // 纯文本模型不接受粘贴的图片，直接放行默认粘贴行为。
    if (!supportsImage) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const imageFiles: File[] = [];
    let hasPlainText = false;
    for (const item of Array.from(items)) {
      if (item.kind === 'string' && item.type === 'text/plain') {
        hasPlainText = true;
      } else if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }

    if (imageFiles.length === 0) return;
    // Suppress default paste unless there's a real text/plain payload —
    // many screenshot tools also put text/html (filename / <img>) which we don't want in the textarea.
    if (!hasPlainText) e.preventDefault();

    const remaining = MAX_ATTACHMENT_COUNT - attachments.length;
    if (remaining <= 0) {
      toast.warning(t('chat.composer.maxAttachments', [MAX_ATTACHMENT_COUNT]));
      return;
    }

    const filesToProcess = imageFiles.slice(0, remaining);
    if (imageFiles.length > remaining) {
      toast.warning(t('chat.composer.truncatedFiles', [remaining]));
    }

    for (const file of filesToProcess) {
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(t('chat.composer.fileTooLarge', [file.name || 'image', formatFileSize(MAX_IMAGE_SIZE)]));
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (isDispatchingRef.current) return;
        if (!supportsImageRef.current) return;
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',', 2)[1] ?? '';
        const mimeType = file.type || 'image/png';
        setAttachments((prev) => {
          if (prev.some((a) => a.type === 'image' && a.data === base64)) {
            // When the user pasted text, the image is likely a side-effect of selecting
            // rich content — silently skip instead of nagging.
            if (!hasPlainText) toast.info(t('chat.composer.imageAlreadyAdded'));
            return prev;
          }
          if (prev.length >= MAX_ATTACHMENT_COUNT) return prev;
          return [...prev, { type: 'image', source: 'paste', data: base64, mimeType, name: file.name || undefined }];
        });
      };
      reader.onerror = () => toast.error(t('chat.composer.readFileFailed', [file.name || 'image']));
      reader.readAsDataURL(file);
    }
  };

  const removeAttachment = (index: number) => {
    if (isDispatchingRef.current) return;
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <>
    <footer className="px-4 py-4 bg-background relative">
      {/* Slash menu — dynamic VFS prompts */}
      {isSlashMenuVisible && (
        <div
          ref={slashMenuRef}
          className="absolute bottom-full left-4 right-4 mb-3 bg-popover border border-border rounded-lg shadow-xl z-50 animate-in slide-in-from-bottom-1 fade-in duration-150 max-h-60 overflow-y-auto"
        >
          {filteredPrompts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3 px-2.5">
              {t('chat.composer.noPrompts')}
            </p>
          ) : (
            <div className="py-1">
              {filteredPrompts.map((p, idx) => {
                const selected = idx === selectedPromptIndex;
                return (
                  <button
                    key={p.fileName}
                    data-prompt-index={idx}
                    disabled={isDispatching}
                    onClick={() => handlePromptSelect(p)}
                    onMouseMove={() => { if (!isDispatching) setSelectedPromptIndex(idx); }}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${selected ? 'bg-accent' : 'hover:bg-accent/50'}`}
                  >
                    <FileType className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">/{p.name}</p>
                      {p.description && (
                        <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="border border-border rounded-xl bg-card focus-within:border-border/80 focus-within:ring-2 focus-within:ring-primary/25 focus-within:ring-offset-1 focus-within:ring-offset-background transition-all">
        {/* Top row: tools + attachments */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-2 border-b border-border/40">
          {/* Tool icons */}
          <Button
            variant="ghost"
            size="icon-xs"
            title={isPicking ? t('chat.composer.cancelPick') : t('chat.composer.pickElement')}
            aria-label={isPicking ? t('chat.composer.cancelPick') : t('chat.composer.pickElement')}
            onClick={handlePickElement}
            disabled={isDispatching}
            className={isPicking ? 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary' : ''}
          >
            <MousePointer2 className="size-3.5" />
          </Button>
          <RecordButton disabled={isDispatching} />
          <ReplayButton disabled={isDispatching} attachments={attachments} onOpenEditor={(rec) => { setEditorRecording(rec); setEditorOpen(true); }} />
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                // span 包裹：按钮 disabled 时本身不接收指针事件，靠外层 span 触发 tooltip。
                className="inline-flex"
              >
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleScreenshot}
                  disabled={isDispatching || !supportsImage}
                  aria-label={supportsImage ? t('chat.composer.screenshot') : t('chat.composer.modelNoImage')}
                >
                  <Camera className="size-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {supportsImage ? t('chat.composer.screenshot') : t('chat.composer.modelNoImage')}
            </TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-xs" title={t('chat.composer.uploadFile')} aria-label={t('chat.composer.uploadFile')} onClick={() => fileInputRef.current?.click()} disabled={isDispatching}>
            <Paperclip className="size-3.5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={`${supportsImage ? 'image/*,' : ''}${Array.from(ACCEPT_EXTENSIONS).join(',')}`}
            className="hidden"
            disabled={isDispatching}
            onChange={handleFileUpload}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            title={t('chat.composer.mobileMode')}
            aria-label={t('chat.composer.mobileMode')}
            className={isActiveTabMobile ? 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary' : ''}
            onClick={toggleMobile}
            disabled={isDispatching}
          >
            <Smartphone className="size-3.5" />
          </Button>

          {/* Divider + Page-operation quick tools (merged from QuickActionsBar) */}
          {onQuickTool && (
            <>
              <Separator orientation="vertical" className="h-4! mx-1 bg-border" />
              {QUICK_TOOLS.map((tool) => {
                const Icon = tool.icon;
                const active = tool.id === 'watch-page' && isWatching;
                const isPending = pendingTool === tool.id;
                return (
                  <Tooltip key={tool.id}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex relative">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          data-quick-tool={tool.id}
                          disabled={!!pendingTool || isDispatching}
                          onClick={() => handleToolClick(tool.id)}
                          className={[
                            'relative',
                            active && 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary',
                            isPending && 'opacity-60 scale-95',
                            !!pendingTool && !isPending && 'opacity-40 cursor-not-allowed',
                          ].join(' ')}
                          aria-label={t(tool.labelKey)}
                        >
                          {isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Icon className="size-3.5" />
                          )}
                        </Button>
                        {active && (
                          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-400 animate-pulse" />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {active ? t('chat.quickActions.toolWatchPageStop') : t(tool.labelKey)}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </>
          )}

          {attachments.length > 0 && (
            <>
              <Separator orientation="vertical" className="h-4! mx-1 bg-border" />

              {/* Attachment chips */}
              <div className="flex gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none items-center">
                {attachments.map((att, i) => (
                  att.type === 'image' ? (
                    // Image attachment: thumbnail + label badge
                    <Badge
                      key={i}
                      variant="outline"
                      className="shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-0.5 pr-0.5 text-purple-400 border-purple-400/20 bg-purple-400/5 group"
                    >
                      <img
                        src={`data:${att.mimeType};base64,${att.data}`}
                        alt={att.name || t('chat.attachments.screenshot')}
                        className="h-3.5 w-5 rounded-sm object-cover cursor-pointer"
                        onClick={() => showDialog('image-preview', {
                          src: `data:${att.mimeType};base64,${att.data}`,
                          alt: att.name || t('chat.attachments.screenshot'),
                        })}
                      />
                      <span className="truncate max-w-24">
                        {att.name || (att.source === 'screenshot' ? t('chat.attachments.screenshot') : t('chat.attachments.image'))}
                      </span>
                      <button
                        className="opacity-60 hover:opacity-100 p-0.5 rounded-sm hover:bg-foreground/10 cursor-pointer"
                        disabled={isDispatching}
                        onClick={() => removeAttachment(i)}
                        aria-label={t('chat.attachments.delete')}
                      >
                        <X className="size-2.5" />
                      </button>
                    </Badge>
                  ) : att.type === 'recording' ? (
                    // Recording attachment: amber chip mirroring Message.tsx;
                    // chip body downloads the JSON, X removes from the list.
                    <Badge
                      key={i}
                      variant="outline"
                      className="shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-1 pr-0.5 text-amber-400 border-amber-400/20 bg-amber-400/5 hover:bg-amber-400/10"
                      title={`${t('chat.attachments.recordingDownload')}\n${t('chat.attachments.recordingHover', [String(att.eventCount), formatCharCount(att.json.length)])}`}
                    >
                      <button
                        className="flex items-center gap-1 cursor-pointer"
                        onClick={() => downloadFile(att.name, att.json, RECORDING_MIME)}
                      >
                        <Film className="size-2.5 shrink-0" />
                        <span className="truncate max-w-40">
                          {att.name} · {t('chat.attachments.recordingMeta', [String(att.eventCount), formatDuration(att.durationMs)])}
                        </span>
                      </button>
                      <button
                        className="opacity-60 hover:opacity-100 p-0.5 rounded-sm hover:bg-foreground/10 cursor-pointer"
                        disabled={isDispatching}
                        onClick={() => {
                          setEditorRecording(att);
                          setEditorOpen(true);
                        }}
                        aria-label={t('chat.recorder.editAndReplay')}
                      >
                        <Pencil className="size-2.5" />
                      </button>
                      <button
                        className="opacity-60 hover:opacity-100 p-0.5 rounded-sm hover:bg-foreground/10 cursor-pointer"
                        disabled={isDispatching}
                        onClick={() => removeAttachment(i)}
                        aria-label={t('chat.attachments.delete')}
                      >
                        <X className="size-2.5" />
                      </button>
                    </Badge>
                  ) : (
                    // Element / file attachment: badge chip
                    <Badge
                      key={i}
                      variant="outline"
                      className={`shrink-0 text-[0.65rem] font-mono gap-1 h-5 rounded pl-1 pr-0.5 ${
                        att.type === 'element'
                          ? 'text-info border-info/20 bg-info/5'
                          : 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5'
                      }`}
                    >
                      {att.type === 'element' && <Crosshair className="size-2.5 shrink-0" />}
                      {att.type === 'file' && <FileText className="size-2.5 shrink-0" />}

                      <span className="truncate max-w-24">
                        {att.type === 'element' && att.selector}
                        {att.type === 'file' && att.name}
                      </span>

                      <button
                        className="opacity-60 hover:opacity-100 p-0.5 rounded-sm hover:bg-foreground/10 cursor-pointer"
                        disabled={isDispatching}
                        onClick={() => removeAttachment(i)}
                        aria-label={t('chat.attachments.delete')}
                      >
                        <X className="size-2.5" />
                      </button>
                    </Badge>
                  )
                ))}
              </div>
            </>
          )}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          data-chat-input
          rows={1}
          value={value}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('chat.composer.placeholder')}
          disabled={isDispatching}
          className="w-full bg-transparent border-none outline-none resize-none text-foreground text-[0.85rem] px-3 py-2 min-h-11 max-h-37.5 leading-relaxed placeholder:text-muted-foreground/50"
        />

        {/* Bottom row: actions */}
        <div className="flex items-center justify-between px-2 pb-1.5">
          <div className={`flex items-center gap-0.5 ${isDispatching ? 'pointer-events-none opacity-60' : ''}`}>
            <ModelSelector
              activeModel={currentModel}
              configuredProviders={providers}
              customProviders={customProviderList}
              webProviders={webProvidersList}
              onSelect={handleModelSelect}
              onOpenSettings={onOpenSettings ?? (() => {})}
            />
            {isReasoningModel && (
              <ThinkingLevelSelector
                level={currentThinkingLevel}
                onSelect={handleThinkingSelect}
              />
            )}
          </div>

          <div className="flex items-center gap-1">
            {isAgentRunning ? (
              <Button
                variant="destructive"
                size="icon-xs"
                onClick={() => onCancel?.()}
                className="hover:shadow-xs"
              >
                <Square className="size-3" fill="currentColor" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleSend}
                disabled={!canSend || isDispatching}
                aria-label={t('common.send')}
                className="bg-foreground text-background hover:bg-primary hover:text-primary-foreground hover:shadow-xs disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Send className="size-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </footer>

    <RecordingEditor
      open={editorOpen}
      onOpenChange={setEditorOpen}
      recording={editorRecording}
      onReplay={(steps) => {
        if (steps.length === 0) return;
        const stepsJson = JSON.stringify(steps, null, 2);
        const prompt = t('chat.recorder.replayPrompt', [stepsJson]);
        void onSend(prompt, undefined, null);
      }}
    />
    </>
  );
});
