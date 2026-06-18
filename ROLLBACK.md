# CebianX 回滚方案

> 版本：v1.3.1  
> 日期：2026-06-14  
> 适用范围：Chrome Web Store / Firefox Add-ons / 手动分发

## 1. 回滚触发条件

以下任一情况发生时，启动回滚流程：

| 级别 | 触发条件 | 响应时间 |
|------|---------|---------|
| P0（紧急） | 扩展安装后导致浏览器崩溃、数据丢失、或安全漏洞 | 立即 |
| P1（严重） | 核心功能（聊天、录制、设置）大面积不可用 | 2 小时内 |
| P2（一般） | 特定平台/浏览器版本出现功能回归，影响部分用户 | 24 小时内 |
| P3（轻微） | UI 显示异常、非关键功能缺陷 | 下一版本修复 |

## 2. 版本标签与产物归档

每个发布版本必须在 Git 中打标签，并保留构建产物：

```bash
# 当前版本标签
git tag -a v1.3.1 -m "Release v1.3.1 - Production readiness"
git push origin v1.3.1

# 上一稳定版本（回滚目标）
# 假设上一版本为 v1.3.0
git tag -l "v*" --sort=-v:refname
```

产物归档位置：
- 本地：`.output/cebianx-<version>-{chrome,firefox}.zip`
- 远程：GitHub Release 附件
- 备份：至少保留最近 3 个版本的 `.zip` 文件

## 3. 商店回滚步骤

### 3.1 Chrome Web Store

CWS **不支持直接回滚到上一版本**。替代方案：

1. **临时下架（紧急）**：
   - 进入 [Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
   - 选择商品 → 「分发」→ 将可见性设为「不公开」或「暂停」
   - 用户将无法新安装，但已安装用户仍可继续使用

2. **发布旧版本覆盖（推荐）**：
   - 从 Git 检出上一稳定版本标签：`git checkout v1.2.x`
   - 重新构建：`pnpm build && pnpm zip`
   - 上传旧版本的 `.zip` 作为「新版本」
   - 在更新说明中注明「回滚至 v1.2.x，修复 v1.3.1 引入的回归问题」
   - 提交审核（审核期间用户仍使用 v1.3.1，需配合临时下架）

3. **通过百分比发布控制影响面**：
   - 若使用 CWS 的「百分比发布」功能，可立即将发布比例降为 0%
   - 已收到更新的用户不受影响，但新用户不再接收 v1.3.1

### 3.2 Firefox Add-ons

Firefox 支持**禁用当前版本**并保留旧版本：

1. 进入 [Developer Hub](https://addons.mozilla.org/zh-CN/developers/)
2. 选择商品 → 「管理版本」
3. 找到 v1.3.1，点击「禁用」
4. 上一版本（v1.2.x）会自动恢复为当前可用版本
5. 已安装用户的扩展会在下次检查时自动回滚

**注意**：禁用版本后，若该版本存在严重安全问题，AMO 审核团队可能要求额外说明。

## 4. 手动分发回滚

对于通过 GitHub Release 或企业内部渠道分发的场景：

```bash
# 1. 从 Git 检出上一稳定版本
git checkout v1.2.x

# 2. 重新构建
pnpm install
pnpm run check
pnpm test
pnpm build        # 或 pnpm build:firefox
pnpm zip          # 或 pnpm zip:firefox

# 3. 替换分发链接
# 将下载链接指向新生成的 cebianx-1.2.x-chrome.zip
```

## 5. 数据兼容性

本次 v1.3.1 变更全部为**内部实现优化或纯 additive**，回滚时的数据影响：

| 数据类型 | 兼容性 | 回滚影响 |
|---------|--------|---------|
| 聊天记录（Dexie `chats` / `messages`） | 完全兼容 | 无影响 |
| 设置（Dexie `settings` / `customModels`） | 完全兼容 | 无影响 |
| WebProvider 配置（Dexie `webProviders`） | 正向兼容 | 回滚后该表不被读取，但数据保留在 IndexedDB 中，未来升级可恢复 |
| 录制事件（Dexie `recordedEvents`） | 完全兼容 | 无影响 |
| OAuth Token（`chrome.storage` / `localStorage`） | 完全兼容 | 无影响 |

**结论**：回滚到 v1.2.x 不会导致任何用户数据丢失。

## 6. 验证回滚成功

执行回滚后，验证以下事项：

- [ ] 商店页面显示的最新版本为回滚目标版本（或已禁用）
- [ ] 干净浏览器配置文件中安装/更新后，扩展正常加载
- [ ] Side Panel 可正常打开
- [ ] 核心功能（聊天、录制、设置）可用
- [ ] 无崩溃报告或异常错误日志

## 7. 事后复盘

回滚完成后 48 小时内，必须完成：

1. **问题定位**：在 `master` 分支复现问题，最小化还原触发条件
2. **修复开发**：基于 `master` 创建 `hotfix/` 分支，修复后执行完整测试
3. **回归测试**：确保修复不会引入新的回归
4. **重新发布**：修复完成后，版本号递增（如 v1.3.2），重新走发布流程
5. **复盘文档**：在团队 wiki 记录根因、回滚耗时、改进措施

## 8. 应急联系

| 角色 | 职责 | 联系方式 |
|------|------|---------|
| 技术负责人 | 回滚决策、技术方案审批 | GitHub @zhixingt |
| 发布工程师 | 执行构建、上传、标签管理 | （项目维护者） |
| 测试验证 | 回滚后功能验证 | （社区贡献者） |

紧急通道：通过 GitHub Issues 创建 `P0-rollback` 标签的 issue，同步描述问题与回滚进展。

## 9. 相关文档

- [DEPLOYMENT.md](./DEPLOYMENT.md) — 部署流程与质量门禁
- [openspec/changes/archive/2026-06-14-production-readiness/](./openspec/changes/archive/2026-06-14-production-readiness/) — 本次变更归档
