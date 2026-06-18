# Hermes → CebianX MCP 反向对接：Native Messaging Host 桥接

## Summary

实现 Hermes Agent（Python 进程）通过 MCP 协议受控调用 CebianX 扩展的 13 个浏览器自动化工具（`cebian_navigate`、`cebian_click`、`cebian_type` 等）。通过 Chrome Native Messaging Host 作为双向桥接层，解决 MV3 Service Worker 无法监听 TCP 端口的限制。

## Problem

当前 CebianX 已有 MCP Server（`lib/mcp/server.ts`），暴露 13 个浏览器操作工具，但传输层仅支持 `chrome.runtime.onMessageExternal`（其他 Chrome 扩展调用）。Hermes 是 Python 进程，无法通过此通道调用 CebianX。

缺失的能力：Hermes → CebianX 方向的 MCP 集成，使 Hermes 能受控操作浏览器（导航、点击、输入、截图、运行工作流等）。

## Solution

采用 **Native Messaging Host 桥接** 方案（Chrome 官方支持，无需额外 TCP 端口，安全可控）：

### 架构

```
Hermes (Python)
  │ HTTP (Streamable HTTP MCP)
  ▼
cebianx-mcp-native-host (Node.js，被 Chrome 启动)
  │ Chrome Native Messaging (stdin/stdout, 4字节前缀+JSON)
  ▼
CebianX 扩展 (Service Worker)
  │ chrome.runtime.Port (connectNative)
  ▼
handleRequest → executeTool → chrome.tabs / chrome.debugger
```

### 关键设计决策

1. **Native Host 传输层为 HTTP，非 stdio**：迭代计划2原方案让 Native Host 同时作为 MCP stdio Server 和 Native Messaging Client，但两者都使用 stdin/stdout 会冲突。修正为：Native Host 被 Chrome 启动后（stdin/stdout 与 Chrome 通信），内部运行 HTTP Server 接收 Hermes 请求。

2. **请求-响应配对**：Native Host 为每个 HTTP 请求生成唯一 `requestId`，通过 Native Messaging 发送给扩展；扩展响应时携带相同 `requestId`，Native Host 据此将响应路由回正确的 HTTP 请求。

3. **扩展侧复用现有 `handleRequest`**：`lib/mcp/server.ts` 已实现完整的 MCP 请求处理（tools/list、tools/call），新增 Native Messaging 传输层只需将 port 消息转发给 `handleRequest`。

### 新增文件

- `scripts/cebianx-mcp-native-host.ts` — Native Messaging Host 脚本（HTTP Server + Native Messaging 双向桥接）
- `scripts/com.cebianx.mcp_host.json` — Native Messaging Host manifest 模板
- `scripts/install-native-host.mjs` — 跨平台安装脚本（Windows/macOS/Linux）

### 修改文件

- `lib/mcp/server.ts` — 新增 `installNativeMessagingListener` 函数，监听 `chrome.runtime.onConnect`（Native Messaging port）
- `entrypoints/background/index.ts` — 调用 `installNativeMessagingListener`

## Non-goals

- 用户授权 UI（设置页"Hermes 集成"开关、首次连接弹窗）— 后续任务
- 只读/完整模式切换 — 后续任务
- 调用审计日志（Dexie `mcpCallLog` 表）— 后续任务
- Hermes 侧 `config.yaml` 配置文档 — 部署文档任务
- Native Host 的 stdio MCP 传输（因 stdin/stdout 冲突不可行，已改为 HTTP）
