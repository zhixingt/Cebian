# 侧边栏折叠/展开 + 会话恢复设计

## 背景

当前 CebianX Chrome 扩展的 sidepanel 存在两个痛点：

1. **关闭后丢失上下文**：点击扩展图标关闭 sidepanel 后再打开，总是显示新聊天界面，上次的对话需要从历史记录中找回
2. **无法快速折叠**：没有内置的折叠/展开机制，每次都需要通过扩展图标操作

## 需求概述

1. 在 sidepanel 内部增加折叠/展开控制，折叠后显示图标栏，展开后恢复完整界面
2. 重新打开 sidepanel 时自动恢复上次的聊天会话
3. 提供"完全隐藏"选项，满足极客用户需求

## 方案选择

**选定方案：CSS Transform 缩放折叠（方案 A）**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A: CSS Transform 缩放 | 动画流畅、状态保留、互不干扰 | 折叠时内存不变 | ✅ 选定 |
| B: 条件渲染切换 | 内存占用低 | 闪烁、状态恢复复杂 | ❌ |
| C: 双 iframe | 完全隔离 | 过度工程、sidepanel 不支持 | ❌ |

---

## 设计详情

### 1. 整体架构

在 `App.tsx` 根容器内新增 `CollapsedBar` 组件和折叠状态管理：

```
App 根容器 (flex flex-col h-screen overflow-hidden relative)
├─ 展开状态: Header + Routes（现有布局不变）
│   └─ 右边缘 8px 热区 → 折叠按钮（hover 显隐）
└─ 折叠状态: CollapsedBar（48px 宽图标栏，纵向排列）
```

#### 状态管理

- 新增 `collapsed: boolean` 状态，由 `App` 组件管理
- 通过 React Context (`SidebarContext`) 向子组件传递 `collapsed` / `setCollapsed`
- 折叠状态持久化到 `localStorage`（key: `cebian-sidebar-collapsed`）

#### 折叠/展开动画

- 使用 CSS `transition` 实现宽度过渡（`width: 100%` ↔ `width: 48px`），时长 300ms，ease-out
- 主内容区域折叠时 `opacity: 0` + `pointer-events: none`（不卸载组件，保留状态）
- 图标栏展开时 `opacity: 0` + `pointer-events: none`
- 两者交叉淡入淡出，避免闪烁

### 2. CollapsedBar 图标栏

折叠后显示 48px 宽的纵向图标栏，从上到下排列：

```
┌──────┐
│ ▶    │  ← 展开按钮（顶部）
│──────│
│ 💬   │  ← 当前会话状态图标
│      │     (AI provider 图标 / 回复中脉冲动画 / 空闲)
│──────│
│ ➕   │  ← 新建聊天
│ 📋   │  ← 历史记录
│ ⚙️   │  ← 设置
│──────│
│      │
│ 🔔3  │  ← 通知提示（底部，有未读时显示数字红点）
└──────┘
```

#### 交互细节

- **展开按钮**：始终显示在顶部，hover 时 tooltip "展开侧边栏"
- **当前会话状态**：显示当前 AI provider 图标；AI 回复中时显示脉冲动画；无会话时显示占位图标
- **快捷操作**：
  - 新建聊天 → 展开侧边栏 + 创建新会话
  - 历史记录 → 展开侧边栏 + 打开 HistoryPanel
  - 设置 → 展开侧边栏 + 导航到设置页
- **通知提示**：AI 回复完成时显示未读计数红点，点击展开查看

#### 折叠按钮（展开状态下的触发器）

- 鼠标靠近侧边栏**右边缘** 8px 热区时，折叠按钮自动显示
- 鼠标离开热区后 500ms 延迟隐藏
- 按钮样式：小圆形按钮（24px），半透明背景，定位在边缘中央
- 显示/隐藏有 150ms fade 过渡动画

### 3. 自动恢复上次会话

#### 当前问题

`MemoryRouter` 初始入口硬编码为 `/chat/new`，每次打开都是新聊天。

#### 修复方案

1. App 挂载时，从 `localStorage` 读取 `cebian-last-session-id`
2. 如果存在有效的 `lastSessionId`，用 `navigate(`/chat/${lastSessionId}`)` 替代默认的 `/chat/new`
3. 每次切换会话时（ChatPage 的 `sessionId` 变化），更新 `lastSessionId` 到 `localStorage`
4. 有效性校验：检查该 sessionId 是否仍存在于会话列表中，不存在则 fallback 到 `/chat/new`

#### 实现位置

- `App.tsx`：新增 `useEffect` 在路由初始化后执行一次恢复逻辑
- `ChatPage.tsx`：在 `sessionId` 变化时更新 `localStorage`

### 4. 完全隐藏模式

#### 设置项

Settings → Advanced 中新增开关 **"收起时完全隐藏侧边栏"**

#### 行为

- 开启后，折叠时整个 sidepanel 内容区域 `width: 0` + `overflow: hidden`，不显示图标栏
- 鼠标靠近浏览器可视区域右边缘时，显示一个浮动的小按钮（`position: fixed`，定位在右边缘中央）
- 点击浮动按钮展开侧边栏
- 浮动按钮样式：小圆形（32px），半透明，hover 时高亮

#### 快捷键

- 在 `manifest.json` 中注册 `chrome.commands` 快捷键（默认 `Ctrl+Shift+X`）
- 在 `background.js` 中监听快捷键命令
- 快捷键触发时通过 `chrome.sidePanel.open()` 打开面板
- 面板内检测到打开后，根据折叠状态自动恢复（如果处于完全隐藏模式则展开）

#### 限制

Chrome MV3 的 `chrome.sidePanel` API 只能打开/关闭面板，无法直接控制面板内部状态。快捷键实际效果是打开面板 + 面板内自动恢复上次会话。

---

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `entrypoints/sidepanel/App.tsx` | 修改 | 新增折叠状态管理、SidebarContext、恢复会话逻辑 |
| `components/layout/CollapsedBar.tsx` | 新增 | 折叠图标栏组件 |
| `components/layout/CollapseTrigger.tsx` | 新增 | 展开状态下的折叠触发按钮 |
| `components/layout/SidebarContext.tsx` | 新增 | 折叠状态 Context |
| `entrypoints/sidepanel/ChatPage.tsx` | 修改 | 更新 lastSessionId |
| `components/settings/AdvancedSection.tsx` | 修改 | 新增"完全隐藏"开关 |
| `entrypoints/background.ts` | 修改 | 注册快捷键监听 |
| `wxt.config.ts` | 修改 | manifest.commands 配置 |

## 成功标准

1. 点击折叠按钮后，侧边栏收起为 48px 图标栏，动画流畅
2. 图标栏中点击展开按钮，侧边栏恢复完整宽度
3. 折叠状态下，图标栏各按钮功能正常（新建、历史、设置）
4. AI 回复完成时，图标栏显示通知红点
5. 关闭 sidepanel 后重新打开，自动恢复上次的聊天会话
6. 开启"完全隐藏"后，折叠时不显示图标栏，鼠标靠近边缘显示浮动按钮
7. 快捷键 `Ctrl+Shift+X` 可打开 sidepanel
8. 折叠/展开操作不影响主侧边栏原有布局与滚动行为
