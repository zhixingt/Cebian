# Tasks: Hermes → CebianX Native Messaging Host 桥接

## 1. Native Messaging Host 脚本

- [ ] 1.1 创建 `scripts/cebianx-mcp-native-host.ts`
  - 实现 Native Messaging I/O（4字节前缀+JSON，stdin 读取 + stdout 写入）
  - 实现 stdin 缓冲区解析（处理分块读取）
  - 实现 HTTP Server（`127.0.0.1:8788`，端口可通过 `CEBIANX_NATIVE_HOST_PORT` 环境变量配置）
  - 实现 `POST /mcp` 端点：接收 JSON-RPC 请求，生成 `requestId`，通过 stdout 转发给 Chrome，等待 stdin 响应，路由回 HTTP
  - 实现 `GET /health` 端点：返回 `{ status: 'ok' }`
  - 实现请求-响应路由表（`Map<requestId, { resolve, reject, timer }>`）
  - 实现超时处理（默认 30s，超时 reject）
  - 实现优雅关闭（stdin EOF → 关闭 HTTP Server → 退出）
  - 错误处理：stdout 写入失败、stdin 解析错误、HTTP 请求格式错误

- [ ] 1.2 创建 `scripts/com.cebianx.mcp_host.json` manifest 模板
  - `name`: `com.cebianx.mcp_host`
  - `type`: `stdio`
  - `path` 和 `allowed_origins` 留占位符（安装脚本填充）

- [ ] 1.3 创建 `scripts/install-native-host.mjs` 安装脚本
  - 检测操作系统（Windows/macOS/Linux）
  - 接受 `--extension-id` 参数（或从 `wxt.config.ts` 读取）
  - 生成 manifest JSON（填入正确的 `path` 和 `allowed_origins`）
  - 生成启动器脚本（`.sh` / `.cmd`）指向编译后的 `cebianx-mcp-native-host.js`
  - 注册到系统位置（Windows 注册表 / macOS/Linux 文件系统）
  - 打印安装结果和 Hermes 配置示例

## 2. 扩展侧 Native Messaging 传输支持

- [ ] 2.1 修改 `lib/mcp/server.ts`
  - 新增 `installNativeMessagingListener()` 函数
  - 监听 `chrome.runtime.onConnect`，过滤 `port.name === 'cebianx-mcp-host'`
  - `port.onMessage`：接收 `{ requestId, mcpRequest }`，调用 `handleRequest(mcpRequest)`，通过 `port.postMessage({ requestId, mcpResponse })` 返回
  - `port.onDisconnect`：清理（日志记录）
  - 导出 `installNativeMessagingListener`
  - 更新文件顶部注释，说明新增的 Native Messaging 传输

- [ ] 2.2 修改 `entrypoints/background/index.ts`
  - 导入 `installNativeMessagingListener`
  - 在 `installMcpServerListener()` 后调用 `installNativeMessagingListener()`

## 3. 测试

- [ ] 3.1 创建 `__tests__/lib/mcp/native-messaging-host.test.ts`
  - 测试 Native Messaging I/O（4字节前缀编码/解码）
  - 测试 stdin 缓冲区解析（分块、跨块消息）
  - 测试 HTTP Server（`/mcp` 端点请求-响应、`/health` 端点）
  - 测试请求-响应路由（requestId 配对）
  - 测试超时处理
  - 测试优雅关闭（stdin EOF）

- [ ] 3.2 创建 `__tests__/lib/mcp/server-native-messaging.test.ts`
  - 测试 `installNativeMessagingListener` 注册 `onConnect` 监听器
  - 测试 port.name 过滤（仅处理 `cebianx-mcp-host`）
  - 测试 `port.onMessage` 接收 `{ requestId, mcpRequest }` → 调用 `handleRequest` → `port.postMessage({ requestId, mcpResponse })`
  - 测试 `tools/list` 请求返回 13 个工具
  - 测试 `tools/call` 请求执行工具（mock `executeTool`）
  - 测试 `port.onDisconnect` 清理

## 4. 验证

- [ ] 4.1 运行单元测试：`pnpm vitest run __tests__/lib/mcp/`
- [ ] 4.2 运行类型检查：`pnpm compile`
- [ ] 4.3 手动验证（文档化，不自动执行）：
  - 编译 Native Host 脚本
  - 运行安装脚本注册 manifest
  - 启动 CebianX 扩展
  - 用 curl 测试 `GET /health`
  - 用 curl 测试 `POST /mcp`（`tools/list`）
  - 配置 Hermes `config.yaml` 指向 `http://127.0.0.1:8788/mcp`
