import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { DialogOutlet } from '@/components/dialogs/outlet';
import { ConfirmOutlet } from '@/components/dialogs/confirm-outlet';
import { UpdateNoticeOutlet } from '@/components/dialogs/update-notice-outlet';
import { Header } from '@/components/layout/Header';
import { HistoryPanel } from '@/components/layout/HistoryPanel';
import { SidebarProvider, useSidebar } from '@/components/layout/SidebarContext';
import { CollapsedBar } from '@/components/layout/CollapsedBar';
import { CollapseTrigger } from '@/components/layout/CollapseTrigger';
import { useStorageItem } from '@/hooks/useStorageItem';
import { themePreference, lastSessionId, sidebarCollapsedFlag } from '@/lib/storage';
import { ChatPage } from './pages/chat';

// Lazy-load Settings: pulls in CodeMirror, react-arborist, lightning-fs,
// all provider/MCP forms, etc. — a large chunk that's only needed once
// the user opens /settings. Keeping it out of the sidepanel's initial
// bundle is the single biggest first-paint win.
const SettingsRoutes = lazy(() =>
  import('./pages/settings').then(m => ({ default: m.SettingsRoutes })),
);

/** Resolve 'system' to the actual theme based on OS preference (defaults to 'light'). */
function resolveTheme(pref: 'dark' | 'light' | 'system'): 'dark' | 'light' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', resolved);
}

function AppContent() {
  const { collapsed, toggleCollapsed } = useSidebar();
  const [theme, setTheme] = useStorageItem(themePreference, 'system');
  const [themeReady, setThemeReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatTitle, setChatTitle] = useState('');
  const sessionRestored = useRef(false);

  const navigate = useNavigate();
  const location = useLocation();

  // Load theme from storage before first render
  useEffect(() => {
    themePreference.getValue().then((val) => {
      applyTheme(resolveTheme(val ?? 'system'));
      setThemeReady(true);
    });
  }, []);

  // 会话恢复：首次挂载时读取 lastSessionId，自动导航到上次的聊天
  useEffect(() => {
    if (!themeReady || sessionRestored.current) return;
    sessionRestored.current = true;
    lastSessionId.getValue().then((savedId) => {
      if (savedId && location.pathname === '/chat/new') {
        navigate(`/chat/${savedId}`, { replace: true });
      }
    });
  }, [themeReady, location.pathname, navigate]);

  // sidepanel 打开时清除折叠标志
  useEffect(() => {
    sidebarCollapsedFlag.setValue(false).catch(() => {});
  }, []);

  // 处理 bfcache 恢复：当 sidepanel 从缓存中恢复时，重新检查 lastSessionId
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && location.pathname === '/chat/new') {
        lastSessionId.getValue().then((savedId) => {
          if (savedId) navigate(`/chat/${savedId}`, { replace: true });
        });
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [navigate, location.pathname]);

  const toggleTheme = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
  };

  const handleNewChat = useCallback(() => {
    if (location.pathname === '/chat/new') return;
    setChatTitle('');
    navigate('/chat/new');
  }, [location.pathname, navigate]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setHistoryOpen(false);
    if (location.pathname === `/chat/${sessionId}`) return;
    setChatTitle('');
    navigate(`/chat/${sessionId}`);
  }, [location.pathname, navigate]);

  const handleDeleteSession = useCallback((deletedId: string) => {
    if (location.pathname === `/chat/${deletedId}`) {
      navigate('/chat/new', { replace: true });
    }
  }, [location.pathname, navigate]);

  // 全局快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+/ 或 Escape：聚焦输入框
      if ((e.ctrlKey && e.key === '/') || e.key === 'Escape') {
        // 只在非输入状态下聚焦（避免打断正在输入的用户）
        const active = document.activeElement;
        const isInputFocused = active instanceof HTMLInputElement
          || active instanceof HTMLTextAreaElement
          || active?.getAttribute('contenteditable') === 'true';
        if (!isInputFocused) {
          e.preventDefault();
          // 查找 ChatInput 的 textarea 并聚焦
          const textarea = document.querySelector<HTMLTextAreaElement>('[data-chat-input]');
          textarea?.focus();
        }
      }

      // Ctrl+N：新建聊天
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        handleNewChat();
      }

      // Ctrl+Shift+X：切换侧边栏折叠
      if (e.ctrlKey && e.shiftKey && e.key === 'X') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNewChat, toggleCollapsed]);

  // Sync theme changes after initial load
  useEffect(() => {
    if (!themeReady) return;
    applyTheme(resolveTheme(theme));
  }, [theme, themeReady]);

  // Listen for OS theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  if (!themeReady) return null;

  // 折叠状态：显示图标栏
  if (collapsed) {
    return (
      <div className="flex h-screen w-full overflow-hidden">
        <CollapsedBar
          onNewChat={handleNewChat}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenSettings={() => navigate('/settings')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen relative group/main overflow-hidden">
      {!location.pathname.startsWith('/settings') && (
        <Header
          title={chatTitle}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenSettings={() => navigate('/settings')}
          onNewChat={handleNewChat}
          onOpenHistory={() => setHistoryOpen(true)}
        />
      )}

      <CollapseTrigger />

      <Routes>
        <Route path="/chat/new" element={<ChatPage onOpenSettings={() => navigate('/settings')} onTitleChange={setChatTitle} />} />
        <Route path="/chat/:sessionId" element={<ChatPage onOpenSettings={() => navigate('/settings')} onTitleChange={setChatTitle} />} />
        <Route
          path="/settings/*"
          element={
            <Suspense fallback={null}>
              <SettingsRoutes basePath="/settings" showBackButton showOpenInTab />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/chat/new" replace />} />
      </Routes>

      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
      />

      <Toaster theme={resolveTheme(theme)} />
      <DialogOutlet />
      <ConfirmOutlet />
      <UpdateNoticeOutlet />
    </div>
  );
}

function App() {
  return (
    <SidebarProvider>
      <TooltipProvider delayDuration={300}>
        <AppContent />
      </TooltipProvider>
    </SidebarProvider>
  );
}

export default App;
