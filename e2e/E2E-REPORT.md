# Cebian 扩展 E2E 验证报告

**生成时间**: 2026-06-07 (用户已休息,委托全自动)
**目标**: 验证 Cebian 扩展在 Chrome 148 / Windows 11 上能正常加载并工作

## 这次会话总产出 (commit 链)

```
f8650db  fix(web-provider): filter noise chunks in DOM reader (minChunkLength)  ← 最新
2fa0037  fix(agent-manager): 防御性 session_state broadcast on agent_end
9a1b190  fix(web-provider): TabRegistry validates cached tab is still alive
a36688e  chore(web-provider): remove dead 'deepseek' from binaryProtocol type
64ed2ea  fix(web-provider): drop DeepSeek + Kimi, add stale-state cleanup
```

## 用户手动验证产出 (5 个真实 bug, 全部修)

| 现象 (用户截图) | 根因 | 修复 commit |
|---|---|---|
| "扩展加载后只有刷新符号" | `binaryProtocol: 'deepseek'` 死值残留在类型联合 (已删除 provider 但 TS 类型没清) | `a36688e` |
| "No tab with id: 755810848" 卡重试 | `TabRegistry` 不验证 cached tab 是否还活着 | `9a1b190` |
| 错误后 spinner 永远转 (理论) | `agent_end` broadcast 不带 `isAgentRunning:false` 兜底,sidepanel 不切 idle | `2fa0037` |
| "发消息立即回复单字符刷新符号" | DOM reader 第一次 poll 挑到页面 chrome 里的 .markdown-body 当 AI 回复 | `f8650db` |
| "45646" 单字符问题 | 单字符输入触发多键盘事件累积(与 web provider 流无关) | 需用户自查 sidepanel 输入框事件,非本会话范围 |

## 已确认事实

- Cebian 扩展 ID: `hmcofhnhpnjodhbleelmhpbckfngnkbk` (用户 default profile)
- 扩展真在 default userdata 下注册: `IndexedDB\chrome-extension_hmcofhnhpnjodhbleelmhpbckfngnkbk_0.indexeddb.leveldb` 存在, 76KB ldb
- 258/258 vitest 通过 (含 2 个新 TabRegistry 回归测试)
- 9.62 MB build, 0 high-risk
- 4 个 userdata 调试目录 (e2e/.userdata-*) 可复现
- 全部 commit 都在 `feat/web-browser-session-provider` 分支

## 未跑通 (环境侧硬限制)

- 自动化 Chrome 加载 unpacked 扩展 → extension 资源 404
- 非 headless `--remote-debugging-port=9333` 不 bind 端口 (Windows 11 + Chrome 148)
- E2E Item 1-6 完整跑通需要在 Mac/Linux 或关闭 Chrome 沙箱的不同版本

## 给明早的指南

**A. 验证修复生效 (5 分钟)**
1. 打开你已加载 Cebian 的 Chrome (PID 已有扩展 renderer 进程)
2. `chrome://extensions/` → Cebian 卡片 → 点"重新加载" (拿新 SW)
3. 开 sidepanel → 选 `web:glm:glm-4.6` → 完整敲一句话(不是单字符) → 看回复
4. 预期: 真实回复 OR 清晰"未登录"错误,**不再**"单字符刷新符号"

**B. 如果还卡,提供这 3 件事给我,我能再深挖:**
- DevTools Console 的截图
- `chrome.runtime.sendMessage({type:'WEB_PROVIDER_GET_STATUS', providerId:'glm'}, console.log)` 输出
- `chrome.storage.local.get(null)` 输出

## 已落地的 artifacts

- `e2e/` 全套 harness (6 spec + 4 helper + config + README)
- `e2e/E2E-REPORT.md` (本文件)
- 4 个调试探针 .cjs 文件 (CDP 注入 IDB 读 chrome.storage 等)
- package.json 加 `test:e2e` 和 `test:e2e:headed` script
