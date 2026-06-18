# CebianX 部署文档

> 版本：v1.3.1  
> 日期：2026-06-14  
> 适用平台：Chrome (MV3) / Firefox (MV2)

## 1. 环境要求

| 工具 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 20.x | 推荐使用 LTS (22.x) |
| pnpm | 10.x | 包管理器，必须启用 `corepack` 或全局安装 |
| Git | 2.x | 版本控制 |
| Windows / macOS / Linux | 最新稳定版 | 开发构建支持全平台 |

商店发布额外要求：
- Chrome Web Store 开发者账号（一次性 $5 注册费）
- Firefox Add-ons 开发者账号（免费）

## 2. 源码与依赖

```bash
# 克隆仓库
git clone https://github.com/maotoumao/Cebian.git
cd Cebian/cebian-web-provider

# 安装依赖（含 devDependencies）
pnpm install

# 验证环境
node -v   # >= 20
pnpm -v   # >= 10
```

## 3. 构建流程

### 3.1 开发构建（热重载）

```bash
# Chrome
pnpm dev

# Firefox
pnpm dev:firefox
```

产物目录：
- Chrome：`.output/chrome-mv3/`
- Firefox：`.output/firefox-mv2/`

### 3.2 生产构建

```bash
# Chrome MV3
pnpm build

# Firefox MV2
pnpm build:firefox
```

构建脚本会自动执行：
1. WXT 打包（Vite + Rolldown）
2. `scan-obfuscation.mjs` 扫描潜在混淆代码（防止 CWS 审核被拒）

### 3.3 打包为可分发格式

```bash
# Chrome 商店上传包
pnpm zip

# Firefox 商店上传包
pnpm zip:firefox
```

产物：
- `.output/cebianx-<version>-chrome.zip`
- `.output/cebianx-<version>-firefox.zip`
- `.output/cebianx-<version>-sources.zip`（源码包，CWS 要求公开源码时提供）

## 4. 质量门禁

每次构建前必须通过的检查：

```bash
# 1. 类型检查 + i18n 校验
pnpm run check

# 2. 代码风格检查
pnpm run lint

# 3. 单元测试（覆盖率阈值已配置在 vitest.config.ts）
pnpm test

# 4. （可选）E2E 测试
pnpm test:e2e
```

**门禁标准：**
- `pnpm run check`：TypeScript 零错误，i18n lint 零新增警告
- `pnpm run lint`：ESLint 零错误
- `pnpm test`：739 个测试全部通过，覆盖率 statements ≥ 90%, branches ≥ 85%, functions ≥ 90%, lines ≥ 90%

## 5. 发布流程

### 5.1 版本号管理

本项目采用语义化版本（SemVer）：
- `package.json` 中的 `version` 字段为唯一真实版本源
- WXT 会自动将版本写入 `manifest.json`

发版前更新版本号：
```bash
# 手动修改 package.json 中的 version，然后
pnpm install  # 更新 pnpm-lock.yaml（如适用）
```

### 5.2 Chrome Web Store 发布

1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
2. 选择对应商品，点击「上传新版本」
3. 上传 `.output/cebianx-<version>-chrome.zip`
4. 填写更新说明（中文/英文）
5. 提交审核（通常 1-3 个工作日）

**注意事项：**
- 若 `scan-obfuscation.mjs` 报出任何警告，必须在提交前解决（CWS 对混淆代码零容忍）。
- 如审核要求提供源码，上传 `.output/cebianx-<version>-sources.zip`。
- `content_security_policy.sandbox` 的宽松策略需在商品说明中解释用途（MCP App 沙箱 iframe 需要加载外部资源）。

### 5.3 Firefox Add-ons 发布

1. 访问 [Firefox Add-ons Developer Hub](https://addons.mozilla.org/zh-CN/developers/)
2. 选择对应商品，点击「上传新版本」
3. 上传 `.output/cebianx-<version>-firefox.zip`
4. 填写更新说明
5. 提交审核（通常 1-5 个工作日）

**注意事项：**
- Firefox MV2 的 `background.scripts` 与 Chrome MV3 的 `background.service_worker` 由 WXT 自动转换，无需手动维护两份 manifest。
- Firefox 对 `clipboardRead` 权限的审核较严格，确保商品描述中已说明剪贴板读取的使用场景。

### 5.4 GitHub Release（可选）

```bash
# 打标签
git tag -a v1.3.1 -m "Release v1.3.1 - Production readiness"
git push origin v1.3.1

# 在 GitHub 上创建 Release，上传 chrome/firefox zip 作为附件
```

## 6. 部署后验证

发布到商店后，执行以下验证：

| 验证项 | Chrome | Firefox | 方法 |
|--------|--------|---------|------|
| 扩展正常安装 | ✅ | ✅ | 从商店安装到干净浏览器配置文件 |
| Side Panel 打开 | ✅ | ✅ | 点击扩展图标或快捷键 |
| 多模型聊天 | ✅ | ✅ | 发送一条测试消息到 OpenAI / GLM |
| 页面录制与回放 | ✅ | ✅ | 录制 3 步操作并播放 |
| 设置保存与读取 | ✅ | ✅ | 修改模型参数后刷新扩展 |
| i18n 切换 | ✅ | ✅ | 切换浏览器语言，观察 UI 变化 |
| 离线可用性 | ✅ | ✅ | 断开网络，确认历史聊天记录可读取 |

## 7. 监控与告警

- **商店评分监控**：每周查看 Chrome Web Store / Firefox Add-ons 的用户评价，收集崩溃报告。
- **错误日志收集**：Side Panel 中的 `window.onerror` 与 `sidepanel-error-boundary.js` 会捕获未处理异常，用户可导出日志反馈。
- **版本回滚**：若发现严重回归，参考 [ROLLBACK.md](./ROLLBACK.md) 执行回滚。

## 8. 相关文档

- [ROLLBACK.md](./ROLLBACK.md) — 回滚方案与应急处理
- [openspec/changes/archive/2026-06-14-production-readiness/](./openspec/changes/archive/2026-06-14-production-readiness/) — 本次变更的完整 OpenSpec 归档
- [README.md](./README.md) — 项目简介与快速开始
