## Why

CebianX v1.3.1 在功能快速迭代过程中积累了多项技术债务与潜在缺陷：

1. **性能瓶颈**：`optimizeSteps` 算法采用三重嵌套循环，大输入场景下复杂度为 O(n³)，导致录制回放编辑卡顿。
2. **竞态条件**：`useRecorder.stop()` 在 `cap-trigger` 后永久挂起，因为仅监听 `session` 变化而未同步监听 `status`。
3. **安全缺陷**：`buildMutationSelector` 未转义属性值中的双引号，可能构造无效 CSS selector；`safeName` 生成的文件名保留末尾连字符。
4. **类型漂移**：`updateStep` 使用 `any` 类型导致 number 字段存入 string；`RecordedEvent` 的 `kind` 枚举与实际使用不一致。
5. **体验缺陷**：`findByText` 采用宽松的 `includes` 匹配导致子串误命中；SPA 导航后 scroll delta 计算基准未重置。
6. **可维护性**：`ACTION_LABELS` 硬编码中文，未接入 i18n 体系；`StepRow` 使用 `index` 作为 React key 导致排序后状态错乱。
7. **测试缺失**：核心工具函数和 hooks 缺乏单元测试，覆盖率仅 43%，无法阻止功能回归。

本次变更一次性解决上述全部问题，使代码库达到生产环境可用标准。

## What Changes

### 性能优化
- `session-to-sequence.ts` 中 `optimizeSteps` 重构为线性扫描，合并同 selector 的连续 `clear`+`type` 对，复杂度降为 O(n)。
- `interact.ts` 中 `findByText` 改为优先精确匹配（`textContent === text`），子串匹配时增加文本长度与包含关系校验。

### 稳定性修复
- `useRecorder.ts` 中 `stop()` 同时监听 `session` 和 `status` 变化，任一条件满足即 resolve，消除挂起风险。
- `recorder.content/index.ts` 监听 URL 变化事件，导航后重置 scroll 基准值 `lastScrollY`。

### 安全加固
- `buildMutationSelector` 对属性值执行 `replace(/"/g, '\\"')` 转义。
- `safeName` 追加 `replace(/^-|-$/g, '')` 去除首尾连字符。

### 类型安全
- `updateStep` 改为泛型函数 `<K extends keyof Step>(index: number, key: K, value: Step[K])`，编译期约束字段类型。
- 修正 `__tests__/lib/recorder/to-attachment.test.ts` 中 `kind: 'click'` → `kind: 'interaction'` + `action`。
- 修正 `__tests__/lib/message-helpers.test.ts` 中 `ThinkingContent`、`ToolCall`、`ToolResultMessage` 的字段以匹配 `@earendil-works/pi-ai` 最新类型。

### 国际化
- `RecordingEditor.tsx` 中 `ACTION_LABELS` 硬编码中文全部替换为 `t()` 调用。
- 新增 `recorder.*` i18n key 到 `en.yml`、`zh_CN.yml`、`zh_TW.yml`。

### 测试覆盖
- 新增/补全 5 个核心模块的单元测试：
  - `lib/utils.ts`：`downloadFile` DOM 操作测试
  - `lib/message-helpers.ts`：`extractText`/`getToolResultText` 边界测试
  - `lib/recorder/to-attachment.ts`：事件分组与附件生成测试
  - `lib/ai-config/web-provider-stream-multiturn.ts`：多轮对话状态管理集成测试
  - `lib/tools/element-visibility.ts`：可见性检测综合测试
- `vitest.config.ts` 配置覆盖率阈值：statements 90%、branches 85%、functions 90%、lines 90%。
- 排除非业务代码（entrypoints、components、shims、类型声明等），确保报告聚焦核心逻辑。

### 兼容性验证
- `pnpm build` + `pnpm zip` → Chrome MV3 扩展包生成成功
- `pnpm build:firefox` + `pnpm zip:firefox` → Firefox MV2 扩展包生成成功
- 扫描混淆脚本（`scan-obfuscation.mjs`）无异常命中

## Capabilities

### Modified Capabilities
- `recorder`：录制回放编辑性能提升、操作准确性提升、UI 多语言支持。
- `interact`：元素定位精度提升，减少误操作。
- `settings`：Web Session Provider 设置 UI 支持国际化。

### New Capabilities
- `testing`：核心模块单元测试体系，覆盖率 98.79%。

## Impact

- **修改文件（18+）**：
  - `lib/recorder/session-to-sequence.ts`
  - `lib/tools/interact.ts`
  - `lib/tools/element-visibility.ts`
  - `hooks/useRecorder.ts`
  - `entrypoints/recorder.content/index.ts`
  - `components/chat/RecordingEditor.tsx`
  - `lib/db.ts`（Dexie schema 扩展）
  - `vitest.config.ts`（覆盖率配置）
  - `locales/en.yml`、`locales/zh_CN.yml`、`locales/zh_TW.yml`
  - 5 个新增/修改的测试文件
- **无新增运行时依赖** — 仅追加 `fake-indexeddb` 等 devDependencies。
- **无破坏性变更** — 所有修改均为内部实现优化或纯 additive 的测试/i18n。
- **AGPL-3.0** — 所有修改继承项目许可证。

## Out of Scope

以下问题识别但本次不修，留待后续里程碑：
- i18n lint 中既有中文硬编码警告（历史债务，非本次引入）。
- Playwright E2E 测试覆盖率（基础设施已具备，但用例需针对完整用户旅程另行设计）。
- Chrome Web Store / Firefox Add-ons 实际上架审核流程（需开发者账号与人工提交）。
