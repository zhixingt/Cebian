import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SquarePen, ArrowDown } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChatInput, type ChatInputHandle } from '@/components/chat/ChatInput';
import { QuickActionsBar, type QuickToolId } from '@/components/chat/QuickActionsBar';
import {
  UserMessageBubble,
  AgentMessage,
} from '@/components/chat/Message';
import { AssistantMessageItem } from '@/components/chat/AssistantMessageItem';
import { ToolResultBubble } from '@/components/chat/ToolResultBubble';
import type { Message, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import {
  getAssistantText,
  extractUserText,
  buildToolResultIndex,
  buildTurnMetaMap,
} from '@/lib/message-helpers';
import { uiToolRegistry } from '@/lib/tools/ui-registry';
import { useBackgroundAgent } from '@/hooks/useBackgroundAgent';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { useStorageItem } from '@/hooks/useStorageItem';
import { activeModel, lastSessionId } from '@/lib/storage';
import type { Attachment } from '@/lib/attachments';
import type { SessionRecord } from '@/lib/db';
import { t } from '@/lib/i18n';
import { startPageWatcher, stopPageWatcher } from '@/lib/page-watcher';
import { toast } from 'sonner';

// ─── ChatPage ───

export function ChatPage({ onOpenSettings, onTitleChange }: {
  onOpenSettings?: () => void;
  onTitleChange?: (title: string) => void;
}) {
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const isNewChat = !routeSessionId || routeSessionId === 'new';
  const navigate = useNavigate();

  // Only read activeModel for UI display (is a model selected?)
  const [currentModel] = useStorageItem(activeModel, null);

  // 页面监控状态
  const [isWatching, setIsWatching] = useState(false);
  const [pageChangeAlert, setPageChangeAlert] = useState<{ count: number } | null>(null);

  // ─── Agent port (all agent/session logic via background) ───
  const {
    state,
    pendingTools,
    send,
    cancel,
    retry,
    subscribe: portSubscribe,
    unsubscribe: portUnsubscribe,
    deleteMessage,
    resolveTool,
  } = useBackgroundAgent({
    onSessionCreated: useCallback((sessionId: string, title: string) => {
      onTitleChange?.(title);
      navigate(`/chat/${sessionId}`, { replace: true });
    }, [navigate, onTitleChange]),
    onSessionLoaded: useCallback((session: SessionRecord | null) => {
      if (!session) {
        navigate('/chat/new', { replace: true });
      }
    }, [navigate]),
    // 2026-06-07: forward onOpenSettings so the web_provider_needs_relogin
    // flow (handleWebProviderNeedsRelogin → callbacks.onOpenSettings) can
    // actually navigate to /settings. Without this the optional-chaining
    // in useBackgroundAgent.ts:255 silently no-ops, and the user just sees
    // a toast without any visible navigation.
    onOpenSettings,
  });

  const { messages, isAgentRunning, sessionId: activeSessionId, sessionTitle, lastError } = state;

  // Mirror activeSessionId into a ref so the subscribe-effect can read the
  // latest value WITHOUT re-running when activeSessionId changes. Putting
  // activeSessionId in the effect's deps would cause an extra run between
  // session_created (which sets state.sessionId) and navigate (which sets
  // routeSessionId) — at that point isNewChat is still true, so the effect
  // would hit portUnsubscribe() and wipe the optimistic user message.
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;

  // When an interactive tool (e.g. ask_user) is pending, the agent is blocked
  // waiting for user input — treat as "not running" so the input is usable.
  // Sending a message during this state triggers steer + cancelAll in the
  // background agent manager automatically.
  const effectiveRunning = isAgentRunning && pendingTools.size === 0;

  // Subscribe to existing session or unsubscribe for new chat.
  //
  // Skip the subscribe IPC when the hook already considers this id active
  // (`activeSessionId === routeSessionId`). That's the case right after
  // sending the first message in a new chat: session_created set
  // state.sessionId to the new id, and the BG port's subscribedSession was
  // already pinned by the 'prompt' handler — we're implicitly subscribed.
  // A redundant 'subscribe' here would race with the in-flight
  // getOrCreateAgent: BG would fall through to a DB load of the just-written
  // empty row and reply with session_loaded{messages:[]}, clobbering the
  // optimistic user message and briefly flashing the welcome screen.
  useEffect(() => {
    if (isNewChat) {
      portUnsubscribe();
      return;
    }
    if (routeSessionId && routeSessionId !== activeSessionIdRef.current) {
      portSubscribe(routeSessionId);
    }
  }, [routeSessionId, isNewChat, portSubscribe, portUnsubscribe]);

  // Sync session title to parent
  useEffect(() => {
    onTitleChange?.(sessionTitle);
  }, [sessionTitle, onTitleChange]);

  // 持久化 lastSessionId：当 activeSessionId 变化时写入存储
  useEffect(() => {
    if (activeSessionId) {
      lastSessionId.setValue(activeSessionId);
    }
  }, [activeSessionId]);

  // 监听右键上下文菜单触发的 prompt
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const listener = (msg: unknown) => {
      const m = msg as { type?: string; text?: string };
      if (m?.type === 'context_menu_prompt' && m?.text) {
        const text = m.text;
        // 如果当前在设置页或其他页面，先导航到新聊天
        if (isNewChat) {
          send(text, undefined, null);
        } else {
          // 已有会话，在新聊天中发送
          navigate('/chat/new');
          // 等待导航完成后再发送
          setTimeout(() => send(text, undefined, null), 100);
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [send, isNewChat, navigate]);

  // Auto-scroll: stick to bottom while content streams, but stop following
  // as soon as the user scrolls up. Resumes when the user scrolls back near
  // the bottom. Driven internally by ResizeObserver, so no `messages`-dep
  // effect needed here.
  const { scrollRef, isAtBottom, scrollToBottom } = useStickToBottom();

  // Force-pin to bottom when switching sessions, opening a fresh chat, or when new messages arrive.
  useEffect(() => {
    scrollToBottom({ force: true });
  }, [activeSessionId, isNewChat, scrollToBottom]);

  // Also force-pin when the message list grows (e.g. first message in new chat, restored session).
  // Use rAF to ensure DOM has updated before scrolling.
  const messageCount = messages.length;
  useEffect(() => {
    if (messageCount > 0) {
      requestAnimationFrame(() => {
        scrollToBottom({ force: true });
      });
    }
  }, [messageCount, scrollToBottom]);

  // Force-pin when the user sends a new message — sending is an explicit
  // intent to see the latest output.
  const handleSend = useCallback(
    async (text: string, attachments: Attachment[] | undefined, expectedSessionId: string | null) => {
      const result = await send(text, attachments, expectedSessionId);
      if (result.status === 'dispatched') {
        scrollToBottom({ force: true });
      }
      return result;
    },
    [scrollToBottom, send],
  );

  // Quick tool actions — one-click prompt + optional screenshot
  const handleQuickTool = useCallback(async (toolId: QuickToolId) => {
    if (effectiveRunning && toolId !== 'watch-page') return;
    switch (toolId) {
      case 'read-page':
        await send(t('chat.quickTool.prompts.readPage'));
        break;
      case 'screenshot-analyze': {
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 85 });
          const base64 = dataUrl.split(',', 2)[1] ?? '';
          await send(
            t('chat.quickTool.prompts.screenshotAnalyze'),
            [{ type: 'image', source: 'screenshot', data: base64, mimeType: 'image/jpeg' }],
          );
        } catch {
          // 截图失败时退回纯文本 prompt
          await send(t('chat.quickTool.prompts.screenshotFallback'));
        }
        break;
      }
      case 'operate-page':
        await send(t('chat.quickTool.prompts.operatePage'));
        break;
      case 'fill-form':
        await send(t('chat.quickTool.prompts.fillForm'));
        break;
      case 'watch-page': {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) break;
          if (isWatching) {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: stopPageWatcher });
            setIsWatching(false);
            toast.info(t('chat.quickActions.watchStopped'));
          } else {
            const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: startPageWatcher });
            const status = results?.[0]?.result as string;
            if (status === 'already_watching') {
              toast.info(t('chat.quickActions.watchAlreadyActive'));
            } else {
              toast.success(t('chat.quickActions.watchStarted'));
            }
            setIsWatching(true);
          }
        } catch {
          toast.error(t('chat.quickActions.watchFailed'));
        }
        break;
      }
    }
    if (toolId !== 'watch-page') scrollToBottom({ force: true });
  }, [send, scrollToBottom, effectiveRunning, isWatching]);

  // 监听页面变化通知
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const listener = (msg: unknown) => {
      const m = msg as { type?: string; changeCount?: number };
      if (m?.type === 'page_change_detected') {
        const count = m.changeCount ?? 0;
        setPageChangeAlert({ count });
        toast.info(t('chat.quickActions.pageChanged', [String(count)]), { duration: 8000 });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const showWaitingPlaceholder = effectiveRunning && lastMsg && 'role' in lastMsg && lastMsg.role === 'user';

  // History of user-typed prompts in this session, oldest first; consumed by
  // ChatInput's ↑/↓ navigation. Strips the <user-request> wrapper added by
  // buildStructuredMessage so what comes back is exactly what the user typed.
  const userHistory = useMemo(
    () => messages
      .filter((m): m is UserMessage => 'role' in m && m.role === 'user')
      .map(extractUserText)
      .filter((s) => s.length > 0),
    [messages],
  );

  // Session loading state: any route/state mismatch means the current
  // message array belongs to a different chat and must not be rendered.
  const sessionLoading = !isNewChat && routeSessionId !== activeSessionId;

  // Ref into ChatInput so QuickActionsBar can drive the same composer state
  // (value, focus, slash-menu close) without mirroring it up here. Forwarded
  // by ChatInput via `forwardRef<ChatInputHandle>`.
  const chatInputRef = useRef<ChatInputHandle>(null);

  // Pre-computed indexes for O(1) lookups inside message rendering
  const toolResultIndex = useMemo(() => buildToolResultIndex(messages as Message[]), [messages]);
  const turnMetaMap = useMemo(() => buildTurnMetaMap(messages as Message[]), [messages]);

  return (
    <>
      <div className="flex-1 min-h-0 relative flex flex-col">
        <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
          <div className="flex flex-col gap-4 p-5">
            {sessionLoading && (
              <div className="text-center text-sm text-muted-foreground py-12">
                {t('chat.session.loading')}
            </div>
          )}

          {!sessionLoading && messages.map((msg, idx) => {
            if (!('role' in msg)) return null;

            const handleDelete = () => {
              const sid = activeSessionId ?? routeSessionId;
              if (sid && sid !== 'new') deleteMessage(sid, idx);
            };

            const handleEdit = async (newText: string) => {
              const sid = activeSessionId ?? routeSessionId;
              if (!sid || sid === 'new') return;
              // Truncate from this message onward, then re-send with new text.
              deleteMessage(sid, idx);
              // Small delay so the BG processes delete before the prompt.
              await new Promise(r => setTimeout(r, 80));
              await send(newText);
            };

            if (msg.role === 'user') {
              return (
                <UserMessageBubble key={`user-${idx}`} msg={msg} onDelete={handleDelete} onEdit={handleEdit} />
              );
            }

            if (msg.role === 'assistant') {
              const assistantMsg = msg as import('@earendil-works/pi-ai').AssistantMessage;
              const isLast = idx === messages.length - 1;

              // Show header only for the first assistant message in a consecutive group
              let showHeader = true;
              for (let i = idx - 1; i >= 0; i--) {
                const prev = messages[i];
                if (!('role' in prev)) continue;
                if (prev.role === 'toolResult') {
                  const tr = prev as ToolResultMessage;
                  const info = uiToolRegistry.get(tr.toolName);
                  if (info?.renderResultAsUserBubble && !tr.details?.cancelled) break;
                  continue;
                }
                if (prev.role === 'assistant') showHeader = false;
                break;
              }

              // Meta row: show only on the assistant message that *closes*
              // the turn (stopReason !== 'toolUse'), so multi-tool-round
              // turns get one consolidated meta at the very end instead of
              // one per intermediate model call.
              const turnEnded = !isLast || !isAgentRunning;
              const isTurnClosing =
                turnEnded && assistantMsg.stopReason !== 'toolUse';
              const plainText = getAssistantText(assistantMsg).trim();
              const copyText = isTurnClosing && plainText.length > 0 ? plainText : undefined;
              const meta = isTurnClosing ? turnMetaMap.get(idx) : undefined;

              // Retry button: only on the very last message in the timeline,
              // only when the turn has actually closed (no pending tool round),
              // and only when the agent is idle (no overlapping run).
              const canRetry = isLast && isTurnClosing && !isAgentRunning;
              const onRetry = canRetry ? retry : undefined;

              return (
                <AssistantMessageItem
                  key={`asst-${idx}`}
                  idx={idx}
                  msg={assistantMsg}
                  isLast={isLast}
                  isAgentRunning={isAgentRunning}
                  effectiveRunning={effectiveRunning}
                  showHeader={showHeader}
                  meta={meta}
                  copyText={copyText}
                  canRetry={canRetry}
                  onRetry={onRetry}
                  onDelete={handleDelete}
                  toolResultIndex={toolResultIndex}
                  pendingTools={pendingTools}
                  resolveTool={resolveTool}
                />
              );
            }

            // Generic: render interactive tool results as user bubbles
            if (msg.role === 'toolResult') {
              return (
                <ToolResultBubble
                  key={`tr-${idx}`}
                  msg={msg as ToolResultMessage}
                  idx={idx}
                />
              );
            }

            return null;
          })}

          {/* Waiting placeholder */}
          {showWaitingPlaceholder && (
            <AgentMessage isStreaming />
          )}

          {/* Error display */}
          {lastError && !isAgentRunning && (
            <div className="text-sm text-destructive bg-destructive/15 border border-destructive/30 rounded-lg px-3 py-2">
              {lastError}
            </div>
          )}

          {!sessionLoading && messages.length === 0 && !isAgentRunning && (
            <div className="flex flex-col items-center gap-4 pt-20 pb-12 text-center">
              <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center">
                <SquarePen className="size-5 text-primary" />
              </div>
              {!currentModel ? (
                <p className="text-sm text-muted-foreground">{t('chat.composer.needModel')}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-2xl text-foreground/80 leading-relaxed" style={{ fontFamily: "var(--font-serif)" }}>
                    {t('chat.emptyState.slogan')}
                  </p>
                  <p className="text-sm text-muted-foreground tracking-wide" style={{ fontFamily: "var(--font-serif)" }}>
                    As Thought Reaches, So Action Arrives.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 pt-3 text-xs text-muted-foreground/70">
                    <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 text-[10px]">/</kbd>
                    <span>{t('chat.emptyState.viewCommands')}</span>
                    <span className="text-border">·</span>
                    <span>{t('chat.emptyState.startChat')}</span>
                    <span className="text-border">·</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 text-[10px]">↑↓</kbd>
                    <span>{t('chat.emptyState.historyInput')}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

        {!isAtBottom && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                aria-label={t('chat.session.scrollToBottom')}
                onClick={() => scrollToBottom({ force: true })}
                className="absolute bottom-3 right-3 size-8 rounded-full shadow-md border border-border/60 bg-background/90 backdrop-blur hover:bg-background"
              >
                <ArrowDown className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.session.scrollToBottom')}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <QuickActionsBar
        onTrigger={(prompt) => chatInputRef.current?.handleQuickAction(prompt.fileName)}
      />

      {/* 页面变化提醒横幅 */}
      {pageChangeAlert && (
        <button
          type="button"
          onClick={() => setPageChangeAlert(null)}
          className="mx-4 mb-1.5 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center justify-between hover:bg-amber-100 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
            {t('chat.quickActions.pageChanged', [String(pageChangeAlert.count)])}
          </span>
          <span className="text-amber-600/70">{t('chat.dismiss')}</span>
        </button>
      )}

      <ChatInput
        ref={chatInputRef}
        onSend={handleSend}
        onCancel={cancel}
        isAgentRunning={effectiveRunning}
        onOpenSettings={onOpenSettings}
        userHistory={userHistory}
        sessionId={isNewChat ? activeSessionId : routeSessionId ?? null}
        onQuickTool={handleQuickTool}
        isWatching={isWatching}
      />
    </>
  );
}
