# Quick Actions Bar — 可视化快捷指令配置

- **Status**: Draft (pending user review)
- **Date**: 2026-06-07
- **Author**: Sisyphus (brainstorming session)
- **Project**: CebianX (fork: `zhixingt/Cebian`, upstream: `maotoumao/Cebian`)
- **Scope**: 一个独立的小功能 = 设置页面"快捷指令"开关 + 聊天栏上方 QuickActionsBar。复用现有 `/` 斜杠指令机制（不新写发送逻辑）。
- **Brainstorming doc**: 用户原文（DeepSeek 草稿）`C:\Users\xiaoz\Desktop\deepseek_markdown_20260607_8e7386.md`（只有 43 行，被本 spec 补全）
- **Estimated effort**: **1 天**（小功能）
- **Estimated tests**: **~15-20 unit tests**（3 个新测试文件）

---

## 1. Background & Motivation

CebianX 已支持 `/` 斜杠指令：在聊天输入框输入 `/` 弹菜单，列出现有 `.md` 提示词，选中后回车即发送该提示词内容（带 `{{var}}` 模板变量补全 UI）。

**问题**：常用提示词要每次打 `/` + 选两步。用户希望"设置页面点星标即收藏，聊天栏直接点胶囊按钮快速调用"。

**目标**（来自用户原文 + brainstorming 6 个决策）：
1. 设置页面"提示词"列表，每行右侧加星形按钮，点击切换"快捷指令"状态
2. 已收藏的提示词，在聊天输入框上方以横向滚动胶囊按钮显示
3. 点击胶囊按钮 = 等价于 `/` + 选条目 + 回车（**复用现有流程**）
4. 收藏顺序在设置页面**拖拽**调整
5. 收藏无数量限制
6. 数据本地存储（`chrome.storage.local`）

---

## 2. Goals & Non-Goals

### Goals (in scope)

1. 设置页面"提示词"列表每行右侧加星形按钮（lucide `Star` / `Pin`）
2. 收藏状态即时切换，**不需刷新页面**
3. 拖拽排序（设置页面调整 → 聊天栏实时反映）
4. 聊天栏 QuickActionsBar：横向滚动，2-3 个可见，超出滚动
5. 点击胶囊按钮触发 `/` 流程（**复用 ChatInput 内部 slash 逻辑**）
6. 模板变量自动支持（继承自 `/` 流程的 `scanPrompts` + `replaceTemplateVars`）
7. Toast 反馈（已用 `sonner`，零成本）
8. 断链占位：原 .md 文件被删/移走，胶囊显示灰色 `?` 占位
9. i18n 完整（zh_CN / en / zh_TW）
10. 跨页实时同步（用现有 `useStorageItem` 钩子）

### Non-Goals (explicit, deferred)

- **Linting/限制收藏数量**：用户原文"无数量限制"，照做
- **跨设备同步**：纯个人本地，不做
- **导入/导出收藏列表**：不做
- **快捷指令分组/分类**：不做（用排序已经足够）
- **快捷指令使用统计**：不做
- **修改 .md 文件名后自动重连收藏**：不做（Q5 选"断链 + 占位"，用户手动去设置页面处理）
- **设置页面外的快捷指令管理 UI**：不做
- **键盘快捷键触发快捷指令**（如 Ctrl+1）：不做

---

## 3. Architecture (4 个改动点)

```
              ┌────────────────────────────────────┐
              │ settings/prompts 页面              │
              │ ┌──────────────────────────────┐   │
              │ │ FavoritesList (新)           │   │  ← 新建：可拖拽列表
              │ │  ⭐ 学习路线.md          ⋮⋮  │   │
              │ │  ⭐ translate.md         ⋮⋮  │   │
              │ │  + 添加更多快捷指令 ↓       │   │
              │ └──────────────────────────────┘   │
              │ ┌──────────────────────────────┐   │
              │ │ FileWorkspace (不变)         │   │  ← FileTree 只管文件增删
              │ │  📄 123.md            [☆]    │   │  ← FileTree 行右侧加星形
              │ │  📄 学习路线.md       [⭐]   │   │
              │ │  📄 translate.md      [⭐]   │   │
              │ └──────────────────────────────┘   │
              │  storage: favoritePrompts:          │
              │           ["学习路线.md", ...]      │
              └────────────────┬───────────────────┘
                               │ useStorageItem (实时同步)
                               ▼
              ┌────────────────────────────────────┐
              │ chat 页面                           │
              │ ┌────────────────────────────────┐ │
              │ │ QuickActionsBar (新)            │ │  ← 新建，0 收藏时高度 0
              │ │ [学习路线] [translate] [?]    → │ │     横向滚动，断链显示 `?`
              │ └────────────────────────────────┘ │
              │ ┌────────────────────────────────┐ │
              │ │ ChatInput                       │ │
              │ │   /  → 菜单  / 模板变量补全     │ │
              │ └────────────────────────────────┘ │
              └────────────────┬───────────────────┘
                               │ 点击 = triggerSlashPrompt(filename)
                               ▼
              ┌────────────────────────────────────┐
              │ ChatInput.triggerSlashPrompt (新)    │  ← 从 ChatInput 提取的共享函数
              │   = / + 选条目 + 回车 (等价)         │     两个调用方共享
              └────────────────────────────────────┘
```

---

## 4. Data Schema

```ts
// lib/storage.ts (新增)
export const favoritePrompts = storage.defineItem<string[]>(
  'local:favoritePrompts',
  { fallback: [] }
);
```

**为什么是 `string[]` 而不是需求文档的 `{ "filename.md": true }` 对象**：
- 拖拽排序需要有序列表（Q4 决策）
- array 顺序即显示顺序
- O(n) lookup 在"个人使用、数量小"原则下完全可接受
- array vs 对象：array 自带顺序、原生支持 `.indexOf`、JSON 序列化更紧凑

**Array 元素**：**文件名**（如 `"学习路线.md"`），不是 VFS 完整路径。
- 简单，符合用户原文
- 用户原文"123.md"暗示用文件名
- 移动/重命名 .md 后断链 → 走"断链 + 占位"（Q5）

---

## 5. UI Specifications

### 5.1 设置页面 — FavoritesList (新组件)

**位置**：`PromptsSection.tsx` 内，`FileWorkspace` **上方**（不在文件树里、避免与 FileTree 拖拽语义混淆）

**结构**：
- 标题 + 副标题："快捷指令" + 副标题"点击下方提示词右侧的星形添加到这里，可拖动排序"
- 列表：每行一个胶囊
  - 左侧：lucide `GripVertical` 拖拽手柄
  - 中间：提示词 `name`（来自 frontmatter）或文件名
  - 右侧：lucide `X` 取消按钮
- 0 收藏时：显示空状态（"还没有快捷指令，在下方文件列表点击星形添加"）
- "添加更多"提示：副标题里有；不强制显示具体 UI

**拖拽**：用 `@dnd-kit/core + @dnd-kit/sortable`（React 19 兼容、零冲突）
- `DndContext` + `SortableContext` + `useSortable` hook
- 拖拽时整行高亮，半透明 + 缩放动画
- 拖拽结束 → 调 `favoritePrompts.setValue(newOrder)`

### 5.2 设置页面 — FileTree 行右侧星形按钮

**位置**：`FileTree.tsx` 内，每个 `.md` 文件行**最右侧**（context menu 按钮前），通过**可选 prop** 控制是否显示：

```ts
interface FileTreeProps {
  // ... 现有 props
  /** Show a star button on each row to toggle `favoritePrompts`. */
  showFavoriteButton?: boolean;  // default: false
}
```

`FileTree` 是通用组件（也在 SkillsSection、FileWorkspace-in-Files 等处用），**只在 PromptsSection 传 `showFavoriteButton={true}`**，其他场景不受影响。

**形态**：
- 未收藏：lucide `Star` 空心（`text-muted-foreground`）
- 已收藏：lucide `Star` 实心（`fill-yellow-400 text-yellow-400`）
- 悬停：颜色变明显（`hover:text-foreground`）
- 点击：立即切换 + Toast（"已添加到快捷指令" / "已移除快捷指令"）

**实现**：
- 用 `useStorageItem(favoritePrompts, [])` 拿到当前列表
- `isFavorite(filename) = list.includes(filename)`
- `toggleFavorite(filename) = setValue(list.includes(f) ? list.filter(x => x !== f) : [...list, f])`

### 5.3 聊天栏 — QuickActionsBar (新组件)

**位置**：`entrypoints/sidepanel/pages/chat/index.tsx` 内，`<ChatInput />` **之前**（紧贴输入框上方）

**结构**：
- 横向 flex 容器：`flex gap-2 overflow-x-auto px-5 py-2`
- 0 收藏时：**整个组件不渲染**（高度 0，符合"无内容就消失"心智，Q6 决策）
- 加载状态：先显示 `null`（避免 0 收藏闪一下），等 storage hydrate 后再决定渲染

**每项胶囊按钮**：
- 找到的提示词：`<button>{name}</button>`，点击调 `triggerSlashPrompt(fileName)`
- 断链的：`disabled` 灰色按钮 + `?` 文案 + `aria-label="原文件已丢失"`，点击弹 toast 提示

**滚动**：
- 横向滚动条用 `overflow-x-auto`
- 不显示滚动条（`scrollbar-hide` Tailwind 插件 / `[&::-webkit-scrollbar]:hidden`）
- 末尾 fade-out 用 `mask-image: linear-gradient(...)` 暗示有更多

### 5.4 Toast 反馈

| 触发 | 消息 |
|---|---|
| 收藏成功 | "已添加到快捷指令" |
| 取消收藏 | "已移除快捷指令" |
| 拖拽完成 | 不弹（视觉变化已经够） |
| 断链点击 | "原文件已丢失，请到设置页面处理" |

用 `sonner`（项目已用），零成本。**不引入"未选中模型"toast**——ChatInput 现有 send 流程不检查 model 选择，胶囊按钮继承同样的行为（不阻止发送）。

---

## 6. Behavior Specification (openspec 风格)

### Requirement: Persistent Favorites Storage

The system MUST persist the favorites list in `chrome.storage.local` under the key `favoritePrompts` as a JSON array of filenames (e.g. `["学习路线.md", "translate.md"]`).

#### Scenario: First-time user has no favorites

Given the user opens the extension for the first time
When they navigate to Settings → Prompts
Then `favoritePrompts` MUST be `[]` (empty array, fallback value)

#### Scenario: User adds a favorite

Given the file `学习路线.md` exists in VFS
And the user clicks the star button on its row in the file list
When the click is processed
Then `favoritePrompts` MUST be set to `["学习路线.md"]`
And a success toast MUST appear

#### Scenario: User adds a favorite that is already in the list

Given `favoritePrompts` is `["学习路线.md"]`
When the user clicks the star button on `学习路线.md` again
Then the list MUST remain unchanged (no duplicate)
And no toast MUST appear (silent no-op)

#### Scenario: User removes a favorite

Given `favoritePrompts` is `["学习路线.md", "translate.md"]`
When the user clicks the filled star on `学习路线.md`
Then `favoritePrompts` MUST become `["translate.md"]`
And a removal toast MUST appear

#### Scenario: User drags a favorite to a new position

Given `favoritePrompts` is `["a.md", "b.md", "c.md"]`
When the user drags `c.md` to the top of the list
Then `favoritePrompts` MUST become `["c.md", "a.md", "b.md"]`
And the QuickActionsBar in any open chat tab MUST reflect the new order (real-time)

### Requirement: Real-Time Cross-Tab Sync

The system MUST reflect favorites changes in the QuickActionsBar within the same render cycle, without requiring a page refresh.

#### Scenario: Settings page and chat page open simultaneously

Given the user has `设置/Prompts` and the chat tab both open
When they add a favorite in Settings
Then the QuickActionsBar in the chat tab MUST show the new button within 1 second

### Requirement: Chat QuickActionsBar Visibility

The system MUST hide the QuickActionsBar when there are zero favorites.

#### Scenario: User has no favorites

Given `favoritePrompts` is `[]`
When the chat page renders
Then the QuickActionsBar MUST NOT be in the DOM (zero height, no space occupied)

#### Scenario: User adds their first favorite

Given the chat page is rendered with no QuickActionsBar
When `favoritePrompts` becomes `["a.md"]`
Then the QuickActionsBar MUST appear immediately
And the button for `a.md` MUST be visible

### Requirement: Quick Action Click Reuses Slash Flow

The system MUST trigger the same code path as typing `/` + selecting the prompt + pressing Enter when the user clicks a quick action button.

#### Scenario: User clicks a quick action with no template variables

Given `translate.md` contains "Translate the following text to French: {{text}}" with `{{text}}` having no default
When the user clicks the `translate` quick action button
Then a template-variable dialog MUST appear (same as if they typed `/translate`)
And the dialog MUST require the user to provide a value for `{{text}}`

#### Scenario: User clicks a quick action with all template variables having defaults

Given `greet.md` contains "Hello {{name}}" with `{{name}}` defaulting to "world"
When the user clicks the `greet` quick action button
Then the prompt MUST be sent immediately without showing a dialog
And the sent message MUST be "Hello world"

### Requirement: Broken-Link Placeholder

The system MUST show a placeholder for favorites whose underlying `.md` file is missing.

#### Scenario: User deletes a .md file that is favorited

Given `favoritePrompts` is `["a.md", "b.md"]`
And `b.md` is then deleted from VFS
When the chat page renders
Then the QuickActionsBar MUST show: `[a.md button] [? button (disabled, gray)]`
And clicking the `?` button MUST show a toast "原文件已丢失，请到设置页面处理"

#### Scenario: User renames a favorited .md file

Given `favoritePrompts` is `["a.md"]`
And the user renames `a.md` to `a-renamed.md` in the file list
When the chat page renders
Then the QuickActionsBar MUST show: `[? button (disabled, gray)]`
And the placeholder behavior MUST be the same as a deleted file

### Requirement: Drag-to-Reorder Favorites

The system MUST allow the user to reorder favorites by dragging rows in the FavoritesList.

#### Scenario: User drags a row to a new position

Given FavoritesList shows: `[a.md, b.md, c.md]`
When the user drags `c.md` to between `a.md` and `b.md`
Then the visual order MUST update to `[a.md, c.md, b.md]` during the drag (live preview)
And on drop, `favoritePrompts` MUST become `["a.md", "c.md", "b.md"]`

---

## 7. Module Changes (Code Map)

| 文件 | 改动 | 改动量 | 风险 |
|---|---|---|---|
| `lib/storage.ts` | 新增 `favoritePrompts: string[]` + helper | +10 行 | 低（仅加新 key） |
| `components/settings/sections/PromptsSection.tsx` | 在 `<FileWorkspace>` 之前加 `<FavoritesList />` | +5 行 | 低 |
| `components/settings/sections/FavoritesList.tsx` | **新建** | ~150 行 | 中（新组件） |
| `components/editor/FileTree.tsx` | 每行右侧加 `StarButton` 组件 | +30 行 | 中（触及核心组件） |
| `components/chat/QuickActionsBar.tsx` | **新建** | ~80 行 | 中（新组件） |
| `components/chat/ChatInput.tsx` | 提取 `triggerSlashPrompt(fileName)` 共享函数 | +30 行 / 改 ~20 行 | **中高**（触及核心组件） |
| `entrypoints/sidepanel/pages/chat/index.tsx` | 在 `<ChatInput>` 之前插入 `<QuickActionsBar />` | +3 行 | 低 |
| `locales/{zh_CN,en,zh_TW}.yml` | 加 `settings.prompts.favorite*` + `chat.quickActions.*` | ~30 行 ×3 | 低 |
| `__tests__/lib/storage-favorite-prompts.test.ts` | **新建** | ~50 行 | 低 |
| `__tests__/components/settings/FavoritesList.test.tsx` | **新建** | ~100 行 | 中 |
| `__tests__/components/chat/QuickActionsBar.test.tsx` | **新建** | ~100 行 | 中 |
| `package.json` | 加 `@dnd-kit/core` + `@dnd-kit/sortable` | +2 行 | 低 |

**总计**：~600 行代码 + 250 行测试 = ~850 行。

---

## 8. Testing Strategy (TDD)

### 单元测试（`__tests__/` 新增 3 个文件）

#### 8.1 `lib/storage-favorite-prompts.test.ts` (~5 tests)
- 初始 fallback 是 `[]`
- 写入后读出来是写入的值
- 多次写入不破坏数据
- 写入空数组 = 清空收藏
- 跨命名空间：favoritePrompts 不污染 providerCredentials 等其他 key

#### 8.2 `components/settings/sections/FavoritesList.test.tsx` (~5 tests)
- 0 收藏时显示空状态文案
- 有收藏时按数组顺序渲染胶囊
- 拖拽一个胶囊到新位置 → 调 `favoritePrompts.setValue(newOrder)` 一次
- 取消按钮 → 调 `favoritePrompts.setValue(filtered)` 一次
- storage 变化 → 组件重新渲染（实时同步）

#### 8.3 `components/chat/QuickActionsBar.test.tsx` (~5 tests)
- 0 收藏时不渲染任何 DOM
- 有收藏时按顺序渲染胶囊
- 找到的提示词按钮可点击 → 调 `triggerSlashPrompt(filename)`
- 断链的提示词显示 disabled 灰色 `?` 按钮
- storage 变化 → 组件重新渲染

### 集成（手动 E2E，本机 Chrome）

不在自动化 E2E 范围（chat 页面 E2E 仍未跑通——见 KNOWN_ISSUES），但写 manual checklist：

- [ ] 设置页面点星形 → 收藏列表出现
- [ ] 拖拽一行 → 收藏列表顺序变化
- [ ] 打开 chat → QuickActionsBar 显示新收藏
- [ ] 点击胶囊 → 触发 `/` 流程（无变量直接发，有变量弹补全 UI）
- [ ] 删除 .md → 胶囊变 `?` 占位
- [ ] 跨页同步：设置加收藏 → chat 立即显示

### 已知约束

- 不写自动化 E2E（chat 页面 E2E 仍未跑通）
- 跑完整 305+ 测试套件无回归

---

## 9. Implementation Phases (3 选 1：方案 A 推荐)

按 brainstorming 决策（方案 A：垂直切片 1）：

### Phase 1: 设置页面 + 存储 + 拖拽（**不动 ChatInput**）

PR 1 范围：
- `lib/storage.ts` + `favoritePrompts` key
- `FavoritesList.tsx`（新）
- `FileTree.tsx` 加星形按钮
- `PromptsSection.tsx` 挂载 FavoritesList
- i18n（3 个 locale）
- 3 个测试文件
- `@dnd-kit` 依赖

**验证标准**：设置页面可加/删/拖拽收藏；存储读写正确；ChatInput **完全没改**。

### Phase 2: QuickActionsBar + 复用 / 流程

PR 2 范围：
- `ChatInput.tsx` 提取 `triggerSlashPrompt` 共享函数
- `QuickActionsBar.tsx`（新）
- `chat/index.tsx` 挂载 QuickActionsBar
- 1 个新测试文件
- 集成测试

**验证标准**：聊天栏胶囊可点；点击等价 `/` 流程；有变量弹补全；断链 `?` 占位。

### Phase 3 (可选): 优化
- 动画（拖拽时的高亮、胶囊出现/消失）
- 键盘无障碍（`aria-label`、focus 管理）
- 性能（虚拟滚动？100+ 收藏时）
- 调研：能否扩展到非 `.md` 提示词（技能/MCP tool？）

---

## 10. Risks & Mitigations

| 风险 | 等级 | 缓解 |
|---|---|---|
| `triggerSlashPrompt` 与 ChatInput 现有 slash 流程行为不一致 | **高** | Phase 2 写专门的"等价性"测试：点击胶囊后的 send 行为 = `/` + 选 + Enter 的 send 行为 |
| 拖拽性能（100+ 收藏时） | 低 | Phase 3 优化；当前"个人使用"不会触发 |
| `useStorageItem` 跨页同步有 race（两个 tab 同时改） | 中 | `chrome.storage.local` 在 WXT 中通过 `storage.onChanged` 事件广播变更；`useStorageItem` 内部已订阅 `chrome.storage.onChanged`，跨 tab 同步**已被覆盖**；写测试覆盖 `storage.setValue` 后另一 tab 的 `useStorageItem` 收到新值 |
| FileTree 改动破坏其他 section（FileTree 也在 Skills / Files 等处用） | 中 | 把星形按钮做成可选 prop（`showFavoriteButton?: boolean`），默认 false，只在 PromptsSection 启用 |
| dnd-kit 与 react-arborist（FileTree 用的）冲突 | 低 | 两者解耦，dnd-kit 只在 FavoritesList 用，react-arborist 只在 FileTree 用；选不同 DOM 区域 |
| ChatInput 改动破坏 slash 菜单 | 中 | Phase 2 提取前先**完整**复制现有 slash 流程 → 改造成 `triggerSlashPrompt` + ChatInput 内部调用；写完整的 slash 流程回归测试 |
| i18n 漏 key 导致 fallback 错误 | 低 | 严格按 `t('chat.quickActions.added')` 模式；CI 检查 3 个 locale 文件 key 完整性 |

---

## 11. Open Questions（暂留待 PR 时确认）

- [ ] **拖拽触发粒度**：拖到一半就更新 storage，还是拖完才更新？答：**拖完才更新**（避免 storage thrashing）
- [ ] **取消收藏的二次确认**：直接取消还是弹"确定？"。答：**直接取消 + Toast**（toast 自带撤销按钮——可选 Phase 3）
- [ ] **收藏同名 .md**：用户在 `/subfolder1/a.md` 和 `/subfolder2/a.md` 都收藏，聊天栏如何显示？答：按 VFS 路径作内部 ID，UI 显示 `subfolder1/a` 等
- [ ] **快捷按钮宽度**：长文件名（如"超长提示词名字.md"）截断 vs 换行？答：**截断 + tooltip**（一致现有 UI 风格）

> 备注：以上 Open Questions 已由脑暴阶段决策默认值填充；如有不同意见，在 PR review 时讨论。

---

## 12. References

- 用户原文：DeepSeek 生成的草稿需求（43 行，被本 spec 补全）
- 现有 `/` 斜杠指令实现：`components/chat/ChatInput.tsx:54-56`（`showSlash`/`prompts`/`selectedPromptIndex`）
- 存储模式参考：`lib/storage.ts:97-100`（`mcpServers` 的 `storage.defineItem` 模式）
- FileTree（**不被本次改动侵入**）：`components/editor/FileTree.tsx`
- ChatInput（**Phase 2 才动**）：`components/chat/ChatInput.tsx`
- superpowers spec 格式参考：`docs/superpowers/specs/2026-06-04-web-provider-agent-integration-design.md`
- openspec 场景化规范参考：`openspec/specs/web-browser-cookie-extraction/spec.md`

---

## 13. Approval Gate

- [ ] 用户审本文档
- [ ] 反馈修改（按需）
- [ ] 批准后进入 `writing-plans` 技能 → 写实施计划 → 实施
