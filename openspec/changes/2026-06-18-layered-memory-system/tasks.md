# Tasks: 分层记忆系统

## 1. Dexie Schema 与类型定义

- [ ] 1.1 创建 `lib/memory/types.ts`
  - 定义 `UserProfileRecord`（key, value, updatedAt）
  - 定义 `AgentMemoryRecord`（id, type, content, keywords, createdAt, relevance）
  - 定义 `SessionSummaryRecord`（id, sessionId, title, summary, keywords, createdAt）
  - 定义 `RetrievedMemories` 类型（profile, summaries, memories）

- [ ] 1.2 修改 `lib/db.ts` 新增 v8 schema
  - 导入 `lib/memory/types.ts` 的类型
  - 在 `db` 类型声明中添加 `userProfile`、`agentMemory`、`sessionSummary` 三个 `EntityTable`
  - 添加 `db.version(8).stores({...})` 声明三个新表（严格 additive，保留所有现有表）
  - 索引：`userProfile: 'key, updatedAt'`、`agentMemory: 'id, type, createdAt'`、`sessionSummary: 'id, sessionId, createdAt'`

## 2. 记忆 CRUD

- [ ] 2.1 创建 `lib/memory/user-profile.ts`
  - `getUserProfile(key): Promise<string | undefined>`
  - `setUserProfile(key, value): Promise<void>`（upsert，更新 updatedAt）
  - `getAllUserProfile(): Promise<UserProfileRecord[]>`
  - `deleteUserProfile(key): Promise<void>`

- [ ] 2.2 创建 `lib/memory/agent-memory.ts`
  - `addAgentMemory(memory: Omit<AgentMemoryRecord, 'id' | 'createdAt'>): Promise<string>`（生成 UUID，设置 createdAt）
  - `getAgentMemory(id): Promise<AgentMemoryRecord | undefined>`
  - `listAgentMemory(): Promise<AgentMemoryRecord[]>`（按 createdAt 降序）
  - `deleteAgentMemory(id): Promise<void>`

- [ ] 2.3 创建 `lib/memory/session-history.ts`
  - `saveSessionSummary(sessionId): Promise<string>` — 从 `db.sessions` 读取会话，生成摘要（标题 + 首条用户消息前 200 字 + 末条助手消息前 200 字），提取关键词（简单分词：按空格/标点分割，过滤停用词，取 top-5），写入 `db.sessionSummary`
  - `getSessionSummary(id): Promise<SessionSummaryRecord | undefined>`
  - `listSessionSummaries(): Promise<SessionSummaryRecord[]>`（按 createdAt 降序）
  - `deleteSessionSummary(id): Promise<void>`
  - `deleteSessionSummaryBySessionId(sessionId): Promise<void>`

## 3. 记忆检索

- [ ] 3.1 创建 `lib/memory/retrieval.ts`
  - `extractKeywords(text: string): string[]` — 简单分词（按空格/标点/中文分词），过滤停用词，取 top-5
  - `scoreByKeywordAndTime(record: { keywords: string[]; createdAt: number }, queryKeywords: string[]): number` — 关键词匹配 0.7 + 时间衰减 0.3
  - `retrieveRelevantMemories(query: string, options?: { topK?: number }): Promise<RetrievedMemories>`
    - profile: 全量检索
    - summaries: 按 score 降序取 top-K（默认 5）
    - memories: 按 score 降序取 top-K（默认 5）

## 4. Prompt 注入

- [ ] 4.1 创建 `lib/memory/prompt-builder.ts`
  - `estimateTokens(text: string): number` — 简单估算（字符数 / 4）
  - `buildMemoryPrompt(query: string, options?: { tokenLimit?: number }): Promise<string>` — 检索记忆，格式化，截断到 ≤500 tokens（默认）
  - `formatUserProfile(profile: UserProfileRecord[]): string` — 格式化为 `<user-profile>` 块
  - `formatSessionSummaries(summaries: SessionSummaryRecord[]): string` — 格式化为 `<recent-context>` 块
  - `formatAgentMemories(memories: AgentMemoryRecord[]): string` — 格式化为 `<agent-memory>` 块
  - 截断策略：按 score 降序填充，超限时停止添加

## 5. 集成

- [ ] 5.1 修改 `lib/agent.ts`
  - 导入 `buildMemoryPrompt`
  - 在 `createCebianAgent` 中，构建 `effectivePrompt` 后，调用 `await buildMemoryPrompt(sessionId)` 追加记忆
  - 错误处理：记忆检索失败时不阻塞 Agent 创建（catch + 返回空字符串）

## 6. 测试

- [ ] 6.1 创建 `__tests__/lib/memory/types.test.ts`（可选，类型测试）
- [ ] 6.2 创建 `__tests__/lib/memory/user-profile.test.ts`
  - set/get/delete userProfile
  - upsert 行为（同 key 覆盖）
  - getAllUserProfile
- [ ] 6.3 创建 `__tests__/lib/memory/agent-memory.test.ts`
  - add/get/delete agentMemory
  - listAgentMemory 排序
- [ ] 6.4 创建 `__tests__/lib/memory/session-history.test.ts`
  - saveSessionSummary（从 mock session 生成摘要）
  - get/list/delete
  - deleteSessionSummaryBySessionId
- [ ] 6.5 创建 `__tests__/lib/memory/retrieval.test.ts`
  - extractKeywords
  - scoreByKeywordAndTime（关键词匹配、时间衰减、无关键词）
  - retrieveRelevantMemories（top-K、排序）
- [ ] 6.6 创建 `__tests__/lib/memory/prompt-builder.test.ts`
  - formatUserProfile / formatSessionSummaries / formatAgentMemories
  - buildMemoryPrompt（token 限制截断、空记忆）
  - estimateTokens

## 7. 验证

- [ ] 7.1 运行测试：`pnpm vitest run __tests__/lib/memory/`
- [ ] 7.2 运行类型检查：`pnpm compile`
- [ ] 7.3 验证现有测试无回归：`pnpm vitest run __tests__/lib/agent`
