# Design: 分层记忆系统

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Agent 创建 (lib/agent.ts)                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  buildMemoryEnhancedPrompt(sessionId)                │  │
│  │  1. 检索用户画像 (全量)                                │  │
│  │  2. 检索会话摘要 (top-K, 关键词+时间衰减)              │  │
│  │  3. 检索 Agent 记忆 (top-K, 关键词+时间衰减)           │  │
│  │  4. 格式化为 ≤500 tokens 文本块                       │  │
│  │  5. 追加到 system prompt                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  会话结束 (session save)                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  saveSessionSummary(sessionId)                       │  │
│  │  - 标题 + 首条用户消息 + 末条助手消息截取              │  │
│  │  - 提取关键词 (简单分词)                               │  │
│  │  - 写入 sessionSummary 表                             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Dexie schema v8                                             │
│  ┌────────────────┐ ┌────────────────┐ ┌─────────────────┐ │
│  │ userProfile    │ │ agentMemory    │ │ sessionSummary  │ │
│  │ - key (PK)     │ │ - id (PK)      │ │ - id (PK)       │ │
│  │ - value        │ │ - type         │ │ - sessionId     │ │
│  │ - updatedAt    │ │ - content      │ │ - title         │ │
│  │                │ │ - keywords[]   │ │ - summary       │ │
│  │                │ │ - createdAt    │ │ - keywords[]    │ │
│  │                │ │ - relevance    │ │ - createdAt     │ │
│  └────────────────┘ └────────────────┘ └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Dexie Schema v8

### `userProfile` 表

键值对存储用户画像，每次对话全量注入。

```typescript
interface UserProfileRecord {
  key: string;          // PK: 'language' | 'preferredSites' | 'workHabits' | ...
  value: string;        // JSON string or plain text
  updatedAt: number;    // timestamp
}
```

索引：`key, updatedAt`

### `agentMemory` 表

存储 Agent 的任务经验和教训，按相关性检索注入。

```typescript
interface AgentMemoryRecord {
  id: string;           // PK: UUID
  type: 'success' | 'failure' | 'pattern';
  content: string;      // 记忆内容描述
  keywords: string[];   // 检索关键词
  createdAt: number;    // timestamp
  relevance: number;    // 初始相关性分数 (0-1)
}
```

索引：`id, type, createdAt`

### `sessionSummary` 表

存储会话摘要，按关键词和时间衰减检索。

```typescript
interface SessionSummaryRecord {
  id: string;           // PK: UUID
  sessionId: string;    // 关联的会话 ID
  title: string;        // 会话标题
  summary: string;      // 摘要（首条用户消息 + 末条助手消息截取）
  keywords: string[];   // 检索关键词
  createdAt: number;    // timestamp
}
```

索引：`id, sessionId, createdAt`

## 记忆检索算法

### 用户画像

全量检索，按 key 排序。

### 会话摘要 / Agent 记忆

基于关键词匹配 + 时间衰减的评分：

```
score = keywordMatchScore * 0.7 + timeDecayScore * 0.3

keywordMatchScore = (匹配关键词数 / 总关键词数) * 1.0
  - 如果查询无关键词，keywordMatchScore = 0.5（中性）

timeDecayScore = exp(-daysSinceCreated / 30)
  - 30 天半衰期，7 天内 score > 0.79
```

返回 top-K（K=5）条记忆。

## Prompt 注入

将检索到的记忆格式化为结构化文本块，追加到 system prompt：

```
<user-profile>
语言偏好: TypeScript
常用网站: github.com, stackoverflow.com
</user-profile>

<recent-context>
[3天前] 调试 WXT 构建问题 — 解决了 content script 注入失败
[7天前] 创建工作流自动化表单填写 — 成功
</recent-context>
```

约束：总记忆注入 ≤500 tokens。超限时按 score 降序截断。

## 需修改的文件

### 1. `lib/memory/types.ts`（新增）

定义 `UserProfileRecord`、`AgentMemoryRecord`、`SessionSummaryRecord` 类型。

### 2. `lib/db.ts`（修改）

- 新增 v8 schema，声明三个新表
- 在 `db` 类型声明中添加三个 `EntityTable`

### 3. `lib/memory/user-profile.ts`（新增）

- `getUserProfile(key: string): Promise<string | undefined>`
- `setUserProfile(key: string, value: string): Promise<void>`
- `getAllUserProfile(): Promise<UserProfileRecord[]>`
- `deleteUserProfile(key: string): Promise<void>`

### 4. `lib/memory/agent-memory.ts`（新增）

- `addAgentMemory(memory: Omit<AgentMemoryRecord, 'id' | 'createdAt'>): Promise<string>`
- `getAgentMemory(id: string): Promise<AgentMemoryRecord | undefined>`
- `listAgentMemory(): Promise<AgentMemoryRecord[]>`
- `deleteAgentMemory(id: string): Promise<void>`

### 5. `lib/memory/session-history.ts`（新增）

- `saveSessionSummary(sessionId: string): Promise<string>` — 从 sessions 表读取会话，生成摘要，写入 sessionSummary
- `getSessionSummary(id: string): Promise<SessionSummaryRecord | undefined>`
- `listSessionSummaries(): Promise<SessionSummaryRecord[]>`
- `deleteSessionSummary(id: string): Promise<void>`
- `deleteSessionSummaryBySessionId(sessionId: string): Promise<void>`

### 6. `lib/memory/retrieval.ts`（新增）

- `retrieveRelevantMemories(query: string, options?: { topK?: number }): Promise<{ profile: UserProfileRecord[]; summaries: SessionSummaryRecord[]; memories: AgentMemoryRecord[] }>`
- `scoreByKeywordAndTime(record: { keywords: string[]; createdAt: number }, queryKeywords: string[]): number`

### 7. `lib/memory/prompt-builder.ts`（新增）

- `buildMemoryPrompt(query: string): Promise<string>` — 检索记忆并格式化为 ≤500 tokens 文本块
- `formatUserProfile(profile: UserProfileRecord[]): string`
- `formatSessionSummaries(summaries: SessionSummaryRecord[]): string`
- `formatAgentMemories(memories: AgentMemoryRecord[]): string`
- `truncateToTokenLimit(text: string, limit: number): string` — 简单按字符数估算 token（4 chars ≈ 1 token）

### 8. `lib/agent.ts`（修改）

在 `createCebianAgent` 中，构建 `effectivePrompt` 后，调用 `buildMemoryPrompt` 追加记忆：

```typescript
const memoryPrompt = await buildMemoryPrompt(sessionId);
const finalPrompt = memoryPrompt
  ? `${effectivePrompt}\n\n${memoryPrompt}`
  : effectivePrompt;
```

## 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 记忆注入增加 prompt 长度 | token 开销增加 | 限制 ≤500 tokens，按 score 截断 |
| 关键词检索准确性低 | 检索到无关记忆 | MVP 可接受；后续可升级为向量检索 |
| SW 生命周期导致记忆丢失 | 记忆不持久 | Dexie 持久化在 IndexedDB，SW 重启后自动加载 |
| 会话摘要质量低（无 LLM） | 摘要不够精炼 | MVP 用首/尾消息截取；后续可加 LLM 摘要 |

## 回滚方案

- 回滚 `lib/db.ts`（删除 v8 schema 声明）
- 回滚 `lib/agent.ts`（移除记忆注入）
- 删除 `lib/memory/` 目录
- Dexie 数据库中的 v8 表会在下次打开时保留（Dexie 不自动删除表），但不影响功能
