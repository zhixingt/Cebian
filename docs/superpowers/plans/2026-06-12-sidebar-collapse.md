# 侧边栏折叠/展开 + 会话恢复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CebianX sidepanel 添加内置折叠/展开功能（图标栏模式），并实现重新打开时自动恢复上次聊天会话。

**Architecture:** 在 App.tsx 中新增 SidebarContext 管理折叠状态，折叠时隐藏主内容并显示 CollapsedBar 图标栏（48px），展开时反向切换。会话恢复通过 localStorage 记录 lastSessionId，App 挂载时自动导航。

**Tech Stack:** React 19, React Router, Tailwind CSS, Lucide Icons, Chrome Extensions MV3 API

---

### Task 1: SidebarContext + 会话恢复存储

**Files:**
- Create: `components/layout/SidebarContext.tsx`
- Modify: `lib/storage.ts`

- [ ] **Step 1: 在 storage.ts 中添加 lastSessionId 和 sidebarCollapsedHide 存储项**

在 `lib/storage.ts` 末尾添加：

```typescript
/** 上次活跃的聊天会话 ID，用于重新打开 sidepanel 时自动恢复。 */
export const lastSessionId = storage.defineItem<string | null>(
  'local:lastSessionId',
  { fallback: null },
);

/** 折叠时是否完全隐藏侧边栏（极客模式）。 */
export const sidebarCollapsedHide = storage.defineItem<boolean>(
  'local:sidebarCollapsedHide',
  { fallback: false },
);
```

- [ ] **Step 2: 创建 SidebarContext.tsx**

创建 `components/layout/SidebarContext.tsx`：

```tsx
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useStorageItem } from '@/hooks/useStorageItem';
import { sidebarCollapsedHide } from '@/lib/storage';

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggleCollapsed: () => void;
  fullyHidden: boolean;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullyHidden] = useStorageItem(sidebarCollapsedHide, false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => !prev);
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggleCollapsed, fullyHidden }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
```

- [ ] **Step 3: 验证编译通过**

Run: `cd D:\Project\CebianX\cebian-web-provider && npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20`
Expected: 无新增错误

---

### Task 2: CollapsedBar 图标栏组件

**Files:**
- Create: `components/layout/CollapsedBar.tsx`

- [ ] **Step 1: 创建 CollapsedBar 组件**

创建 `components/layout/CollapsedBar.tsx`：

```tsx
import { PanelRightOpen, SquarePen, History, Settings, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSidebar } from './SidebarContext';
import { useStorageItem } from '@/hooks/useStorageItem';
import { activeModel } from '@/lib/storage';
import { t } from '@/lib/i18n';

interface CollapsedBarProps {
  onNewChat: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  isAgentRunning: boolean;
  unreadCount: number;
}

export function CollapsedBar({ onNewChat, onOpenHistory, onOpenSettings, isAgentRunning, unreadCount }: CollapsedBarProps) {
  const { setCollapsed } = useSidebar();
  const [currentModel] = useStorageItem(activeModel, null);

  const handleExpand = () => setCollapsed(false);
  const handleNewChat = () => { setCollapsed(false); onNewChat(); };
  const handleHistory = () => { setCollapsed(false); onOpenHistory(); };
  const handleSettings = () => { setCollapsed(false); onOpenSettings(); };

  return (
    <div className="flex flex-col items-center w-12 h-full border-r border-border bg-background py-3 gap-1">
      {/* 展开按钮 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={handleExpand} className="mb-2">
            <PanelRightOpen className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('common.expandSidebar')}</TooltipContent>
      </Tooltip>

      {/* 当前会话状态 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative mb-2">
            <Button variant="ghost" size="icon-xs" onClick={handleExpand}>
              <Bot className={`size-4.5 ${isAgentRunning ? 'text-primary animate-pulse' : currentModel ? 'text-foreground' : 'text-muted-foreground'}`} />
            </Button>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full bg-destructive text-[8px] text-destructive-foreground grid place-items-center leading-none font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {isAgentRunning ? t('common.session.running') : t('common.currentSession')}
        </TooltipContent>
      </Tooltip>

      <div className="w-6 border-t border-border my-1" />

      {/* 快捷操作 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={handleNewChat}>
            <SquarePen className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('common.newChat')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={handleHistory}>
            <History className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('common.history')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={handleSettings}>
            <Settings className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('common.settings')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
```

---

### Task 3: CollapseTrigger 折叠触发按钮

**Files:**
- Create: `components/layout/CollapseTrigger.tsx`

- [ ] **Step 1: 创建 CollapseTrigger 组件**

创建 `components/layout/CollapseTrigger.tsx`：

```tsx
import { useState } from 'react';
import { PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSidebar } from './SidebarContext';
import { t } from '@/lib/i18n';

/**
 * 展开状态下，鼠标靠近右边缘时显示的折叠触发按钮。
 * 悬浮在内容区域右侧，自动显隐。
 */
export function CollapseTrigger() {
  const { toggleCollapsed } = useSidebar();
  const [visible, setVisible] = useState(false);

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-2 z-20"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <div
        className={`absolute right-1 top-1/2 -translate-y-1/2 transition-opacity duration-150 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon-xs"
              onClick={toggleCollapsed}
              className="size-6 rounded-full shadow-sm border border-border/60 bg-background/90 backdrop-blur"
            >
              <PanelRightClose className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t('common.collapseSidebar')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
```

---

### Task 4: 集成到 App.tsx — 折叠布局 + 会话恢复

**Files:**
- Modify: `entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: 修改 App.tsx 集成折叠功能和会话恢复**

关键修改：
1. 导入 SidebarProvider, useSidebar, CollapsedBar, CollapseTrigger
2. 包裹 SidebarProvider
3. 添加会话恢复逻辑（useEffect 读取 lastSessionId）
4. 折叠时显示 CollapsedBar，展开时显示原有布局
5. ChatPage 的 sessionId 变化时更新 lastSessionId

---

### Task 5: ChatPage 中更新 lastSessionId

**Files:**
- Modify: `entrypoints/sidepanel/pages/chat/index.tsx`

- [ ] **Step 1: 在 ChatPage 中持久化 activeSessionId**

在 ChatPage 的 `activeSessionId` 变化时，写入 `lastSessionId` 存储。

---

### Task 6: 完全隐藏模式 — AdvancedSection 设置项

**Files:**
- Modify: `components/settings/sections/AdvancedSection.tsx`

- [ ] **Step 1: 在 AdvancedSection 中添加"收起时完全隐藏"开关**

---

### Task 7: i18n 国际化键值

**Files:**
- Modify: `_locales/zh_CN/messages.json`
- Modify: `_locales/en/messages.json`

- [ ] **Step 1: 添加新增的 i18n 键值**

---

### Task 8: 快捷键注册

**Files:**
- Modify: `wxt.config.ts` (manifest.commands)

- [ ] **Step 1: 在 manifest 中注册 Ctrl+Shift+X 快捷键**

---

### Task 9: 构建验证

- [ ] **Step 1: 运行构建**
- [ ] **Step 2: 运行测试**
