# 用户偏好学习：自动从行为中提取偏好

## Summary

在分层记忆系统基础上，实现自动用户偏好学习。从用户消息中检测语言偏好，从 navigate 工具调用中记录常用网站，异步写入 `userProfile` 表。无需手动配置，使用 3 次后能识别用户语言偏好。

## Problem

当前 `userProfile` 表只能通过手动 API 写入，没有自动学习机制。用户每次使用都需要重复说明偏好，Agent 无法自动适应用户习惯。

## Solution

### 学习维度（MVP）

| 维度 | 学习信号 | 存储 key | 应用场景 |
|------|---------|---------|---------|
| **语言偏好** | 用户消息语言 | `language` | Agent 回复语言（已通过 prompt 注入生效） |
| **常用网站** | navigate 工具目标 URL | `frequentSites` | 后续工作流推荐 |

### 架构

```
用户消息 / 工具调用
  │ 异步触发（不阻塞主流程）
  ▼
lib/memory/preference-learner.ts
  ├── detectLanguage(text) → 'zh' | 'en' | 'ja' | ...
  ├── extractDomain(url) → 'github.com'
  └── learnFromMessage(sessionId, messages)
  └── learnFromNavigation(url)
  │ 写入 userProfile 表
  ▼
lib/memory/user-profile.ts（已有）
  └── setUserProfile(key, value)
```

### 数据流

1. **语言偏好**：会话消息更新时（`ThrottledSessionWriter.flush`），异步分析最近用户消息语言，更新 `userProfile.language`
2. **常用网站**：navigate 工具执行后，异步提取 URL domain，更新 `userProfile.frequentSites`（JSON 数组，top-10，按频次排序）
3. **注入**：已通过 `buildMemoryPrompt` 的 `<user-profile>` 块自动注入

### 新增文件

- `lib/memory/preference-learner.ts` — 偏好学习逻辑

### 修改文件

- `lib/db.ts` — `ThrottledSessionWriter.flush()` 中异步调用 `learnFromMessage`
- `lib/tools/` 中 navigate 相关工具 — 执行后异步调用 `learnFromNavigation`

## Non-goals

- 工作习惯学习（工作流执行时间分布）— 复杂度高，后续迭代
- 工具偏好学习（interact vs browserwing）— 复杂度高，后续迭代
- 设置页查看/修正偏好 UI — 后续任务
- LLM 辅助偏好提取 — MVP 用规则（语言检测 + URL domain）
