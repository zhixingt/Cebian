# Design: 用户偏好学习

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  会话消息更新 (ThrottledSessionWriter.flush)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  异步：learnFromMessage(sessionId, messages)          │  │
│  │  1. 提取最近 3 条用户消息                             │  │
│  │  2. detectLanguage(text) → 'zh' | 'en' | ...         │  │
│  │  3. 多数投票确定主导语言                              │  │
│  │  4. setUserProfile('language', language)              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  navigate 工具执行后                                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  异步：learnFromNavigation(url)                       │  │
│  │  1. extractDomain(url) → 'github.com'                │  │
│  │  2. 读取 userProfile.frequentSites（JSON 数组）        │  │
│  │  3. 频次 +1，按频次降序排序，保留 top-10              │  │
│  │  4. setUserProfile('frequentSites', JSON)             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 语言检测算法

基于字符集的简单语言检测（无需外部依赖）：

```typescript
function detectLanguage(text: string): 'zh' | 'en' | 'ja' | 'unknown' {
  // 统计各字符集字符数
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;  // 中文
  const hiragana = (text.match(/[\u3040-\u309f]/g) || []).length;  // 平假名
  const katakana = (text.match(/[\u30a0-\u30ff]/g) || []).length;  // 片假名
  const latin = (text.match(/[a-zA-Z]/g) || []).length;

  const ja = hiragana + katakana;
  
  if (ja > 0 && ja >= cjk * 0.3) return 'ja';  // 有假名，判定为日语
  if (cjk > latin) return 'zh';  // 中文字符多于拉丁
  if (latin > cjk && latin > 0) return 'en';  // 拉丁字符占主导
  return 'unknown';
}
```

多数投票：对最近 3 条用户消息分别检测语言，取出现次数最多的作为主导语言。

## 常用网站记录

```typescript
interface FrequentSite {
  domain: string;
  count: number;
  lastVisited: number;
}

// 存储格式：userProfile.frequentSites = JSON.stringify(FrequentSite[])
// 最多保留 10 个，按 count 降序排序
```

更新逻辑：
1. 从 `userProfile.frequentSites` 读取 JSON（空则 `[]`）
2. 查找 domain 是否已存在
3. 存在则 count+1、更新 lastVisited
4. 不存在则新增 `{ domain, count: 1, lastVisited: Date.now() }`
5. 按 count 降序排序，保留 top-10
6. 写回 `userProfile.frequentSites`

## 需修改的文件

### 1. `lib/memory/preference-learner.ts`（新增）

- `detectLanguage(text: string): 'zh' | 'en' | 'ja' | 'unknown'`
- `extractDomain(url: string): string | null` — 从 URL 提取 domain（处理无效 URL）
- `learnFromMessage(sessionId: string, messages: AgentMessage[]): Promise<void>` — 分析最近 3 条用户消息，多数投票确定语言，写入 userProfile
- `learnFromNavigation(url: string): Promise<void>` — 提取 domain，更新 frequentSites

### 2. `lib/db.ts`（修改）

在 `ThrottledSessionWriter.flush()` 中，`saveSessionSummary` 调用后，异步调用 `learnFromMessage`：

```typescript
void import('./memory/preference-learner').then(({ learnFromMessage }) =>
  learnFromMessage(id, messages).catch((err) => {
    console.warn('[DB] Failed to learn preferences:', err);
  })
).catch(() => {});
```

### 3. navigate 工具（修改）

在 navigate 工具执行后，异步调用 `learnFromNavigation`。

需要找到 navigate 工具的实现位置。可能的位置：
- `lib/tools/` 中的 navigate 相关工具
- `lib/mcp/server.ts` 中的 `cebian_navigate` case

在 `cebian_navigate` 执行后添加：
```typescript
void import('../memory/preference-learner').then(({ learnFromNavigation }) =>
  learnFromNavigation(url).catch(() => {})
).catch(() => {});
```

## 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 语言检测准确性 | 误判语言 | MVP 可接受；后续可升级为 LLM 检测 |
| 异步学习失败 | 偏好不更新 | catch 静默处理，不影响主流程 |
| frequentSites JSON 解析失败 | 数据丢失 | try/catch + 默认空数组 |
| 并发写入 frequentSites | 数据竞争 | MVP 可接受（ThrottledSessionWriter 节流） |

## 回滚方案

- 回滚 `lib/db.ts`（移除 learnFromMessage 调用）
- 回滚 navigate 工具（移除 learnFromNavigation 调用）
- 删除 `lib/memory/preference-learner.ts`
- `userProfile` 表中已写入的偏好数据保留（不影响功能）
