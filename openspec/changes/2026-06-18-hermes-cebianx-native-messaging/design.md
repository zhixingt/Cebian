# Design: Hermes → CebianX Native Messaging Host 桥接

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Hermes Agent (Python 进程)                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  MCP Client (Streamable HTTP)                        │  │
│  │  配置: http://127.0.0.1:8788/mcp                     │  │
│  └──────────────────────┬───────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────┘
                          │ HTTP POST (JSON-RPC)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  cebianx-mcp-native-host (Node.js 进程，被 Chrome 启动)      │
│  ┌──────────────────────┐  ┌──────────────────────────┐    │
│  │  HTTP Server         │  │  Native Messaging I/O    │    │
│  │  127.0.0.1:8788/mcp  │←→│  process.stdin/stdout    │    │
│  │  接收 Hermes 请求     │  │  (4字节前缀 + JSON)       │    │
│  │  返回 HTTP 响应       │  │  与 Chrome 通信           │    │
│  └──────────────────────┘  └──────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  请求-响应路由表 (Map<requestId, pendingPromise>)     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────┘
                          │ Chrome Native Messaging
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CebianX 扩展 (Service Worker)                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  installNativeMessagingListener()                    │  │
│  │  chrome.runtime.onConnect → port.name === 'cebianx-mcp-host' │  │
│  │  port.onMessage → handleRequest → port.postMessage   │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         │ executeTool                       │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  chrome.tabs / chrome.debugger / chrome.scripting    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 数据流

### 请求流（Hermes → CebianX）

1. Hermes 发送 HTTP POST 到 `http://127.0.0.1:8788/mcp`，body 为 MCP 请求 JSON-RPC（如 `tools/call`）
2. Native Host HTTP Server 接收请求，生成唯一 `requestId`
3. Native Host 将 `{ requestId, mcpRequest }` 通过 `process.stdout`（4字节前缀+JSON）发送给 Chrome
4. Chrome 将消息转发给 CebianX 扩展的 `port.onMessage` 监听器
5. 扩展提取 `mcpRequest`，调用 `handleRequest(mcpRequest)`
6. `handleRequest` 执行 `executeTool`，操作浏览器

### 响应流（CebianX → Hermes）

1. 扩展 `handleRequest` 返回 `mcpResponse`
2. 扩展通过 `port.postMessage({ requestId, mcpResponse })` 发送给 Chrome
3. Chrome 将消息通过 `process.stdin`（4字节前缀+JSON）转发给 Native Host
4. Native Host 从 stdin 读取消息，提取 `requestId`
5. Native Host 从路由表查找对应的 `pendingPromise`，resolve `mcpResponse`
6. HTTP Server 将 `mcpResponse` 作为 HTTP 响应返回给 Hermes

## 需修改的文件

### 1. `scripts/cebianx-mcp-native-host.ts`（新增）

Native Messaging Host 脚本，职责：
- 被 Chrome 启动（通过 `chrome.runtime.connectNative`）
- 运行 HTTP Server（`127.0.0.1:8788`，端口可通过环境变量 `CEBIANX_NATIVE_HOST_PORT` 配置）
- 接收 Hermes 的 HTTP MCP 请求
- 为每个请求生成 `requestId`，通过 Native Messaging（stdout）转发给 Chrome
- 从 Native Messaging（stdin）读取响应，按 `requestId` 路由回 HTTP 请求
- 超时处理（默认 30s）
- 优雅关闭（stdin 关闭时退出）

关键实现细节：
- **Native Messaging 协议**：4 字节小端无符号整数长度前缀 + JSON UTF-8 body
- **HTTP 端点**：`POST /mcp` 接收 JSON-RPC 请求；`GET /health` 健康检查
- **请求-响应路由**：`Map<string, { resolve, reject, timer }>` 管理 pending 请求
- **stdin 解析**：维护缓冲区，按 4 字节前缀切分消息（Chrome 可能分块发送）

### 2. `scripts/com.cebianx.mcp_host.json`（新增）

Native Messaging Host manifest 模板：
```json
{
  "name": "com.cebianx.mcp_host",
  "description": "CebianX MCP Native Messaging Host",
  "path": "<auto-detected-by-install-script>",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<CEBIANX_EXTENSION_ID>/"]
}
```

### 3. `scripts/install-native-host.mjs`（新增）

跨平台安装脚本，职责：
- 检测操作系统（Windows/macOS/Linux）
- 检测 CebianX 扩展 ID（从 `wxt.config.ts` 或用户输入）
- 生成 manifest JSON（填入正确的 `path` 和 `allowed_origins`）
- 将 manifest 注册到系统位置：
  - Windows：写入注册表 `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.cebianx.mcp_host`
  - macOS：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cebianx.mcp_host.json`
  - Linux：`~/.config/google-chrome/NativeMessagingHosts/com.cebianx.mcp_host.json`
- 生成启动器脚本（`.sh` / `.cmd`）指向编译后的 `cebianx-mcp-native-host.js`

### 4. `lib/mcp/server.ts`（修改）

新增 `installNativeMessagingListener` 函数：
- 监听 `chrome.runtime.onConnect`
- 过滤 `port.name === 'cebianx-mcp-host'`
- 注册 `port.onMessage` 监听器：
  - 接收 `{ requestId, mcpRequest }` 格式的消息
  - 调用现有 `handleRequest(mcpRequest)`
  - 通过 `port.postMessage({ requestId, mcpResponse })` 返回响应
- 注册 `port.onDisconnect` 监听器（清理）
- 导出 `installNativeMessagingListener`

### 5. `entrypoints/background/index.ts`（修改）

在 `installMcpServerListener()` 调用后，新增 `installNativeMessagingListener()` 调用。

## 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Native Host manifest 需用户手动安装 | 部署门槛 | 提供一键安装脚本 `install-native-host.mjs` |
| 扩展 ID 在开发期间变化 | manifest `allowed_origins` 失效 | 安装脚本支持自定义扩展 ID；文档说明开发模式用固定 ID |
| Native Host 进程崩溃 | Hermes 请求失败 | HTTP Server 返回 503；扩展侧 port.onDisconnect 重连 |
| 同一 tab 并发请求 | 请求-响应错配 | `requestId` 路由表确保正确配对 |
| stdin 分块读取 | 消息解析错误 | 缓冲区 + 按 4 字节前缀切分 |

## 回滚方案

- 回滚 `lib/mcp/server.ts` 和 `entrypoints/background/index.ts` 的修改
- 删除 `scripts/cebianx-mcp-native-host.ts`、`scripts/com.cebianx.mcp_host.json`、`scripts/install-native-host.mjs`
- 用户卸载 Native Host manifest（删除系统目录中的 JSON 文件或注册表项）
- 现有 `chrome.runtime.onMessageExternal` 传输不受影响
