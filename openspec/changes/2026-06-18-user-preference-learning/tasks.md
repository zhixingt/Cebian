# Tasks: 用户偏好学习

## 1. 偏好学习模块

- [ ] 1.1 创建 `lib/memory/preference-learner.ts`
  - `detectLanguage(text: string): 'zh' | 'en' | 'ja' | 'unknown'` — 基于字符集的简单语言检测（CJK/假名/拉丁）
  - `extractDomain(url: string): string | null` — 从 URL 提取 domain（处理无效 URL，使用 `new URL()`）
  - `learnFromMessage(sessionId: string, messages: AgentMessage[]): Promise<void>` — 提取最近 3 条用户消息，多数投票确定语言，写入 `userProfile.language`
  - `learnFromNavigation(url: string): Promise<void>` — 提取 domain，更新 `userProfile.frequentSites`（JSON 数组，top-10，按频次降序）
  - `FrequentSite` 接口（domain, count, lastVisited）

## 2. 集成

- [ ] 2.1 修改 `lib/db.ts` 的 `ThrottledSessionWriter.flush()`
  - 在 `saveSessionSummary` 调用后，异步调用 `learnFromMessage`（动态导入避免循环依赖）
  - 失败时静默处理

- [ ] 2.2 修改 navigate 工具执行处
  - 找到 navigate 工具的实现（`lib/mcp/server.ts` 的 `cebian_navigate` case 或 `lib/tools/` 中的 navigate 工具）
  - 执行后异步调用 `learnFromNavigation(url)`（动态导入）
  - 失败时静默处理

## 3. 测试

- [ ] 3.1 创建 `__tests__/lib/memory/preference-learner.test.ts`
  - `detectLanguage`：中文、英文、日文、混合、空字符串
  - `extractDomain`：正常 URL、无效 URL、带端口、带路径
  - `learnFromMessage`：3 条中文消息 → language='zh'；3 条英文消息 → language='en'；混合消息 → 多数投票
  - `learnFromNavigation`：首次访问、重复访问（count+1）、top-10 截断、按频次排序

## 4. 验证

- [ ] 4.1 运行测试：`pnpm vitest run __tests__/lib/memory/`
- [ ] 4.2 运行类型检查：`pnpm compile`
- [ ] 4.3 验证现有记忆系统测试无回归
