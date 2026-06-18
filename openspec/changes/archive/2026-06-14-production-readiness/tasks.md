## 1. 性能优化

- [x] 1.1 重构 `lib/recorder/session-to-sequence.ts` 中 `optimizeSteps`，将三重嵌套循环改为线性扫描 + 状态机
- [x] 1.2 运行 `pnpm test`，确认 session-to-sequence 相关测试通过且性能断言满足
- [x] 1.3 优化 `lib/tools/interact.ts` 中 `findByText`，精确匹配优先，子串匹配增加长度与包含关系校验
- [x] 1.4 运行 `pnpm test`，确认 interact 相关测试通过

## 2. 稳定性修复

- [x] 2.1 重构 `hooks/useRecorder.ts` 中 `stop()`，同时订阅 `session` 与 `status` 变化
- [x] 2.2 运行 `pnpm test`，确认 useRecorder 相关测试通过
- [x] 2.3 在 `entrypoints/recorder.content/index.ts` 中监听 URL 变化，重置 `lastScrollY`
- [x] 2.4 运行 `pnpm test`，确认 recorder content script 相关测试通过

## 3. 安全加固

- [x] 3.1 在 `buildMutationSelector` 中对属性值双引号执行转义
- [x] 3.2 在 `safeName` 中去除首尾连字符
- [x] 3.3 运行 `pnpm test`，确认相关工具函数测试通过

## 4. 类型安全

- [x] 4.1 将 `updateStep` 改为泛型函数 `<K extends keyof Step>`
- [x] 4.2 修正 `__tests__/lib/recorder/to-attachment.test.ts` 中 `kind` 与 `action` 字段
- [x] 4.3 修正 `__tests__/lib/message-helpers.test.ts` 中 `ThinkingContent`、`ToolCall`、`ToolResultMessage` 类型
- [x] 4.4 运行 `pnpm run check`，确认 TypeScript 零错误

## 5. 国际化

- [x] 5.1 提取 `RecordingEditor.tsx` 中所有硬编码中文到 `t()` 调用
- [x] 5.2 在 `locales/en.yml`、`zh_CN.yml`、`zh_TW.yml` 中新增 `recorder.*` 命名空间
- [x] 5.3 运行 `pnpm run check`，确认 i18n lint 零新增警告

## 6. 测试覆盖

- [x] 6.1 补全 `lib/utils.ts` 中 `downloadFile` 测试
- [x] 6.2 补全 `lib/message-helpers.ts` 边界测试
- [x] 6.3 补全 `lib/recorder/to-attachment.ts` 事件分组测试
- [x] 6.4 补全 `lib/ai-config/web-provider-stream-multiturn.ts` 集成测试
- [x] 6.5 补全 `lib/tools/element-visibility.ts` 可见性检测测试
- [x] 6.6 配置 `vitest.config.ts` 覆盖率阈值（statements 90, branches 85, functions 90, lines 90）
- [x] 6.7 运行 `pnpm test -- --coverage`，确认覆盖率达标（实际 98.79%）

## 7. 生产环境兼容性验证

- [x] 7.1 运行 `pnpm build`，确认 Chrome MV3 构建成功
- [x] 7.2 运行 `pnpm zip`，确认 Chrome 扩展包生成成功
- [x] 7.3 运行 `pnpm build:firefox`，确认 Firefox MV2 构建成功
- [x] 7.4 运行 `pnpm zip:firefox`，确认 Firefox 扩展包生成成功
- [x] 7.5 验证 `.output/chrome-mv3/manifest.json` 中 `manifest_version` 为 3
- [x] 7.6 验证 `.output/firefox-mv2/manifest.json` 中 `manifest_version` 为 2
- [x] 7.7 验证图标、_locales、background.js、sidepanel.html 等关键文件存在且非空

## 8. OpenSpec 归档与部署文档

- [x] 8.1 创建 `openspec/changes/archive/2026-06-14-production-readiness/` 归档
- [x] 8.2 编写 `proposal.md`、`design.md`、`tasks.md`、`.openspec.yaml`
- [x] 8.3 编写项目根目录 `DEPLOYMENT.md`（环境要求、构建步骤、发布流程、商店提交指南）
- [x] 8.4 编写项目根目录 `ROLLBACK.md`（版本标签、回滚步骤、数据迁移、应急联系）
- [x] 8.5 提交所有文档变更

## 验收标准

- [x] `pnpm test` 通过（739 个测试全部 green）
- [x] `pnpm run check` 通过（TypeScript + i18n lint 零错误）
- [x] `pnpm run build` 与 `pnpm run build:firefox` 成功
- [x] 覆盖率报告 ≥ 90%（实际 98.79%）
- [x] Chrome/Firefox 扩展包完整生成
- [x] 部署文档与回滚方案就绪
