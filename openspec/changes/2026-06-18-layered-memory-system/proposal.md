# 分层记忆系统：跨会话上下文积累

## Summary

借鉴 Hermes 分层记忆，为 CebianX 实现跨会话记忆系统。新增 Dexie schema v8（`userProfile`、`agentMemory`、`sessionSummary` 三表），实现记忆写入/检索/注入，让 Agent 能引用历史会话上下文和用户偏好。

## Problem

当前 CebianX Agent 每次对话从零开始，无法积累用户偏好和历史上下文。用户每次需要重复说明偏好（如"用 TypeScript"、"偏好简洁回复"），Agent 也无法引用之前会话的经验。

## Solution

### 记忆分层

| 层级 | 内容 | 存储 | 注入策略 |
|------|------|------|---------|
| **用户画像** | 语言偏好、常用网站、工作习惯 | Dexie `userProfile` 表 | 每次对话注入 |
| **Agent 记忆** | 成功的任务模式、失败教训 | Dexie `agentMemory` 表 | 相关时注入 |
| **会话摘要** | 历史会话的关键信息摘要 | Dexie `sessionSummary` 表 | 检索后注入 |

### 架构

```
lib/memory/
├── types.ts              # 记忆类型定义
├── user-profile.ts       # 用户画像 CRUD
├── agent-memory.ts       # Agent 记忆 CRUD
├── session-history.ts    # 会话摘要 CRUD
├── retrieval.ts          # 记忆检索（关键词 + 时间衰减）
└── prompt-builder.ts     # 将记忆注入 system prompt
```

### 数据流

1. **写入**：会话结束时，保存会话摘要（标题 + 关键消息截取）到 `sessionSummary`；用户偏好通过 API 手动写入 `userProfile`
2. **检索**：Agent 创建时，检索相关记忆（用户画像全量 + 会话摘要按关键词/时间衰减 top-K）
3. **注入**：将检索到的记忆格式化为 ≤500 tokens 的文本块，追加到 system prompt

### 新增文件

- `lib/memory/types.ts` — 记忆类型定义
- `lib/memory/user-profile.ts` — 用户画像 CRUD
- `lib/memory/agent-memory.ts` — Agent 记忆 CRUD
- `lib/memory/session-history.ts` — 会话摘要 CRUD
- `lib/memory/retrieval.ts` — 记忆检索
- `lib/memory/prompt-builder.ts` — prompt 注入

### 修改文件

- `lib/db.ts` — 新增 v8 schema（`userProfile`、`agentMemory`、`sessionSummary` 表）
- `lib/agent.ts` — 集成记忆注入到 system prompt
- `entrypoints/background/index.ts` 或会话结束处 — 调用会话摘要保存

## Non-goals

- LLM 自动生成会话摘要（MVP 用简单截取：标题 + 首/尾消息）
- LLM 自动提取用户偏好（MVP 支持手动 API 写入，自动提取为任务4）
- 设置页查看/删除记忆 UI（后续任务）
- 向量检索/嵌入（MVP 用关键词匹配 + 时间衰减）
- 记忆过期自动清理（MVP 手动删除）
