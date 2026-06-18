# CebianX 迭代计划 2：从"工具"到"智能助手"的进化

> **制定日期**：2026-06-18
> **基于**：迭代计划 1 完成情况 + Tabbit/Hermes 调研 + 项目全面审查 + API Discovery 审查
> **核心目标**：借鉴 Tabbit（AI Native 浏览器）与 Hermes（自我进化 AI Agent）的差异化能力，将 CebianX 从"浏览器自动化工具"升级为"具备记忆与自我进化能力的智能助手"，并实现 Hermes 通过 MCP 受控调用 CebianX 浏览器能力

---

## 第一部分：项目全面审查报告

### 1.1 迭代计划 1 完成情况

**总览**：迭代计划 1 的三阶段路线图（体验筑基 → RPA 内核 → 生态闭环）已全部完成，并额外完成了 4 项延伸任务。

| 阶段 | 计划任务 | 完成状态 | 证据 |
|------|---------|---------|------|
| **第一阶段** | 3 个 Bug 修复 + 录制即保存 + 工作流执行器 | ✅ 全部完成 | 21 项验收标准全通过 |
| **第二阶段** | Workflow Engine + AI Planner + 触发器 + 录制增强 | ✅ 全部完成 | 含状态机、断点续跑、4 种触发器 |
| **第三阶段** | 数据管道 + 工作流市场 + MCP Server | ✅ 全部完成 | CSV/Clipboard/JSON 导出 + 预置工作流 + MCP Server |
| **延伸任务** | i18n 修复、压力测试、视觉定位、API Discovery | ✅ 全部完成 | 31 项延伸任务全通过 |

**最终验证**：91 个测试文件 / 1173 个测试全部通过；`pnpm compile` 退出码 0。

### 1.2 未完成任务清单

| 序号 | 任务描述 | 当前状态 | 优先级 | 预估工作量 | 技术债务分类 |
|------|---------|---------|--------|-----------|-------------|
| **U-1** | **Stop 按钮不完全有效（DOM-injection 路径）** | 未修复，明确延后 | 高 | 1-2 人日 | 代码质量问题（chrome.scripting 无 abort 信号） |
| **U-2** | **401 检测用户 E2E 验证** | 代码已修复（session watcher），待用户手动验证 | 中 | 0.5 人日 | 测试覆盖缺口 |
| **U-3** | **Firefox/Safari 兼容性** | 仅支持 Chrome/Edge | 低 | 5-10 人日 | 平台覆盖缺口 |
| **U-4** | **企业功能（SSO/审计日志）** | 明确排除不做 | 低 | 10+ 人日 | 商业化功能缺口 |
| **U-5** | **埋点统计系统** | 明确排除不做 | 低 | 3-5 人日 | 运营基础设施缺口 |

> **注**：Google Sheets 导出和社区工作流市场已根据用户决策从计划中移除。

### 1.3 代码级技术债务

| 序号 | 债务描述 | 位置 | 优先级 | 处理策略 |
|------|---------|------|--------|---------|
| **D-1** | `any` 类型残留 367 处/92 文件 | 全项目分布（高频文件已清理） | 中 | 按文件优先级逐步清理，每迭代清理 3-5 个文件 |
| **D-2** | 用户输入未净化（信任用户） | `agent-manager.ts:64` | 中 | 评估是否需增加结构化标签过滤 |
| **D-3** | Skill 模板描述占位符 | `skill-creator.ts:39` | 低 | 完善模板说明 |
| **D-4** | 繁体中文安装指南路径缺失 | `useUpdateCheck.ts:211` | 低 | 站点支持后补充 |
| **D-5** | AppRenderer 协议级错误处理 | `ToolCardWithUI.tsx:226` | 中 | 完善 UI 渲染错误展示 |

### 1.4 架构级技术债务

| 序号 | 债务描述 | 影响 | 优先级 | 处理策略 |
|------|---------|------|--------|---------|
| **A-1** | **无跨会话记忆系统** | Agent 每次对话从零开始，无法积累用户偏好 | 高 | 借鉴 Hermes 分层记忆，基于 Dexie 实现 |
| **A-2** | **工作流无法自动转化为 Skill** | 用户每次手动创建，无自我进化能力 | 高 | 借鉴 Hermes 自动技能生成 |
| **A-3** | **MV3 Service Worker 生命周期限制** | 长时任务可能被终止（已有断点续跑缓解） | 中 | 已有方案，持续优化 |
| **A-4** | **BrowserWing 与原生工具链重叠** | Agent 工具选择困惑（已有分工文档） | 中 | 已有方案，持续执行 |
| **A-5** | **无收藏全文 + RAG 索引** | 无法像 Tabbit 那样收藏页面供 Agent 检索 | 中 | 新增收藏系统 |
| **A-6** | **Hermes → CebianX MCP 反向对接缺失** | Hermes 无法受控调用 CebianX 浏览器能力 | 高 | 新增 Native Messaging Host 桥接 |

### 1.5 延迟与技术债务累积根本原因分析

| 根本原因 | 表现 | 影响范围 | 应对策略 |
|---------|------|---------|---------|
| **MV3 平台限制** | chrome.scripting 无 abort 信号、SW 易被终止、无法监听 TCP 端口 | U-1、A-3、A-6 | 接受限制，设计补偿机制（断点续跑、Native Messaging Host） |
| **资源约束（单人/小团队）** | 企业功能、Firefox 兼容性被排除 | U-3、U-4 | 聚焦核心差异化，社区贡献补齐长尾 |
| **技术债优先级低于功能交付** | `any` 清理、测试覆盖延后 | D-1、D-2 | 每迭代分配 20% 时间清理技术债 |
| **缺乏用户反馈闭环** | 无埋点，难以量化功能使用率 | U-5、A-1 | 建立轻量级用户反馈机制（不依赖埋点） |

---

## 第二部分：Tabbit / Hermes 调研与可行性分析

### 2.1 Tabbit 浏览器核心特性

> **背景**：美团光年之外团队推出的 AI Native 浏览器，2026-06-09 发布 1.0，百日 12 次迭代。

| 特性 | 描述 | 隐私保护机制 |
|------|------|-------------|
| **多模型自由切换** | 最多 5 个模型同时回答同一问题 | 模型调用走云端，浏览器内数据本地加密 |
| **跨对话记忆** | 对话上下文跨会话保留 | 记忆存储在本地设备 |
| **本地目录挂载** | 用户指定目录供 Agent 访问 | 本地目录挂载相当于"安全圈"，Agent 只在圈内操作 |
| **云端 MCP 协议** | 任务在云端执行，结果回传本地 | 不污染本地环境，无需安装 Python |
| **"妙招"功能** | 自定义宏命令 + "妙招广场"分享 | 妙招定义本地存储 |
| **标签组智能整理** | AI 自动整理标签页分组 | 标签数据本地处理 |
| **收藏全文 + RAG 索引** | 收藏页面全文并建立检索索引 | 收藏内容本地加密 |
| **垂直侧边栏** | 可收起的垂直标签栏 | - |

### 2.2 Hermes Agent 核心特性

> **背景**：Nous Research 开源的自我进化 AI Agent，MIT 协议，126k+ GitHub stars。

| 特性 | 描述 | 技术实现 |
|------|------|---------|
| **自我进化** | 自动从经验中学习技能、改进技能 | 完成复杂任务后自动生成 Skill，使用中自动优化 |
| **分层记忆** | 用户画像 + Agent 记忆 + Skills + 会话历史 | 全部存储为 `~/.hermes/` 下的 markdown 文件 |
| **定时任务** | 自然语言设置 cron 任务 | 内置 cron 调度器，结果推送到指定平台 |
| **多平台访问** | 同一 Agent 从任意设备访问 | Telegram/Discord/Slack/WhatsApp 等 |
| **47 个内置工具** | Web 搜索、浏览器自动化、代码执行等 | 工具生态丰富 |
| **MCP 集成** | 可作为 MCP Server 或 Client | 已与 CebianX 桥接联调成功 |
| **7 层安全模型** | 用户授权 + 危险命令审批 + 容器隔离等 | 防御纵深设计 |

### 2.3 CebianX 可行性评估

#### 2.3.1 Tabbit 特性可实现性

| Tabbit 特性 | CebianX 现状 | 可行性 | 实现方案 | 优先级 |
|------------|-------------|--------|---------|--------|
| 多模型自由切换 | ✅ 已有 ModelSelector | 🟢 已具备 | 增强：多模型并行回复（最多 5 个） | P1 |
| 跨对话记忆 | ❌ 无跨会话记忆 | 🟡 可实现 | 借鉴 Hermes 分层记忆，Dexie 存储 | **P0** |
| 本地目录挂载 | ✅ 已有 VFS | 🟢 已具备 | 增强：VFS + RAG 索引 | P1 |
| 云端 MCP 协议 | ✅ 已有 MCP Client/Server | 🟢 已具备 | 已完成 Hermes 桥接 | - |
| "妙招"功能 | ✅ 已有 Workflow + 预置 | 🟢 已具备 | 已满足，无需额外开发 | - |
| 标签组智能整理 | ❌ 无 | 🟡 可实现 | `chrome.tabs` API + AI 整理 | P2 |
| 收藏全文 + RAG 索引 | 🟡 有 read-page 工具 | 🟡 可实现 | 新增收藏系统 + 全文索引 | **P1** |
| 垂直侧边栏 | ✅ 已有侧边栏 | 🟢 已具备 | UI 优化 | P2 |

#### 2.3.2 Hermes 特性可实现性

| Hermes 特性 | CebianX 现状 | 可行性 | 实现方案 | 优先级 |
|------------|-------------|--------|---------|--------|
| 自我进化（自动 Skill 生成） | ❌ 无自动学习 | 🟡 可实现 | 工作流执行后自动生成可复用 Skill | **P0** |
| 分层记忆 | ❌ 无跨会话记忆 | 🟡 可实现 | Dexie 存储用户偏好 + 上下文 | **P0** |
| 定时任务 | ✅ 已有 cron 触发器 | 🟢 已具备 | 增强：自然语言设置定时 | P2 |
| 多平台访问 | ❌ 仅浏览器扩展 | 🔴 不适用 | 定位不同，不追求多平台 | - |
| 47 个内置工具 | ✅ 已有丰富工具链 | 🟢 已具备 | 可通过 MCP 扩展 | - |
| MCP 集成（CebianX → Hermes） | ✅ 已有完整 MCP | 🟢 已具备 | 已完成 Hermes 桥接（CebianX 调用 Hermes） | - |
| MCP 集成（Hermes → CebianX） | ❌ 反向对接缺失 | 🟡 可实现 | 新增 Native Messaging Host 桥接 | **P0** |
| 7 层安全模型 | 🟡 部分实现 | 🟡 可实现 | 增强危险命令审批 | P2 |

#### 2.3.3 关键差异化机会

**CebianX 的独特定位**：浏览器扩展（无需切换浏览器）+ 已有 RPA 内核 + 已有 Hermes 桥接 + API Discovery

| 差异化方向 | CebianX 优势 | Tabbit/Hermes 劣势 |
|-----------|-------------|-------------------|
| **无需切换浏览器** | 用户现有 Chrome/Edge 即可使用 | Tabbit 需迁移到新浏览器 |
| **浏览器原生 RPA** | 已有完整工作流引擎 + 录制回放 | Tabbit 妙招偏轻量，Hermes 无录制 |
| **Hermes 双向集成** | 已有 MCP 桥接（CebianX→Hermes），将实现反向（Hermes→CebianX） | Tabbit 无 Hermes 集成 |
| **企业内网可用** | 浏览器扩展天然适配内网 | Tabbit 云端方案需公网 |
| **API Discovery** | 已实现 API-first + DOM fallback | Tabbit/Hermes 无此能力 |

### 2.4 Hermes 通过 MCP 对接 CebianX 实现受控浏览器自动化方案

#### 2.4.1 现状分析

**当前已有的 MCP 集成（CebianX → Hermes 方向）**：
- `scripts/hermes-mcp-bridge.ts` 将 Hermes 的 stdio MCP Server 桥接为 Streamable HTTP Server
- CebianX 作为 MCP Client 通过 HTTP 连接 Hermes，调用 Hermes 的 47 个内置工具
- 联调验证成功，暴露 16 个工具

**缺失的反向集成（Hermes → CebianX 方向）**：
- CebianX 已有 MCP Server（`lib/mcp/server.ts`），暴露 13 个浏览器操作工具
- 但传输层是 `chrome.runtime.onMessageExternal`，只支持其他 Chrome 扩展调用
- Hermes 是 Python 进程，无法直接通过 `chrome.runtime.onMessageExternal` 调用 CebianX
- **需要新增桥接层让 Hermes 能受控调用 CebianX 的浏览器能力**

#### 2.4.2 技术方案：Native Messaging Host 桥接

**架构设计**：
```
┌─────────────────────────────────────────────────────────────┐
│  Hermes Agent (Python 进程)                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  MCP Client (stdio) — 在 config.yaml 中配置           │  │
│  └──────────────────────┬───────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────┘
                          │ stdio (JSON-RPC over stdin/stdout)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  cebianx-mcp-native-host (Node.js 进程)                     │
│  ┌──────────────────────┐  ┌──────────────────────────┐    │
│  │  MCP Server (stdio)  │  │  Native Messaging Client │    │
│  │  暴露 13 个 cebian_* │←→│  chrome.runtime.connect  │    │
│  │  工具给 Hermes        │  │  Native                  │    │
│  └──────────────────────┘  └──────────────────────────┘    │
└─────────────────────────┼───────────────────────────────────┘
                          │ Chrome Native Messaging (JSON over stdin/stdout)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CebianX 扩展 (Service Worker)                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  MCP Server 实现 (lib/mcp/server.ts)                 │  │
│  │  - cebian_navigate / cebian_click / cebian_type      │  │
│  │  - cebian_extract / cebian_read_page / cebian_scroll │  │
│  │  - cebian_screenshot / cebian_wait / cebian_select   │  │
│  │  - cebian_hover / cebian_focus / cebian_keypress     │  │
│  │  - cebian_run_workflow                               │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         │ chrome.tabs / chrome.debugger / scripting
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  浏览器页面 (受控操作)                                │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**为什么选择 Native Messaging Host**：
| 方案 | 可行性 | 优势 | 劣势 |
|------|--------|------|------|
| **Native Messaging Host**（推荐） | ✅ 完全可行 | Chrome 官方支持、无需额外端口、安全（需用户安装 manifest） | 需用户安装 Native Host |
| WebSocket Server | ❌ 不可行 | - | MV3 SW 无法监听 TCP 端口 |
| HTTP Server | ❌ 不可行 | - | MV3 SW 无法监听 TCP 端口 |
| Offscreen Document WebSocket | 🟡 可行但复杂 | 不需 Native Host | 需 Offscreen 常驻、跨域复杂 |

#### 2.4.3 实现步骤

**步骤 1：编写 Native Messaging Host 脚本**

新增文件 `scripts/cebianx-mcp-native-host.ts`：
```typescript
// 职责：
// 1. 作为 MCP Server (stdio)，接收 Hermes 的 MCP 请求
// 2. 作为 Native Messaging Client，转发请求给 CebianX 扩展
// 3. 双向桥接：Hermes ↔ CebianX

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Native Messaging: 通过 stdin/stdout 与 Chrome 通信（4 字节长度前缀 + JSON）
function sendToExtension(message: object): void {
  const json = JSON.stringify(message);
  const buffer = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(Buffer.concat([header, buffer]));
}

// 从 Chrome stdin 读取响应
function readFromExtension(): Promise<object> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      const length = chunk.readUInt32LE(0);
      const json = chunk.subarray(4, 4 + length).toString('utf-8');
      process.stdin.removeListener('data', onData);
      resolve(JSON.parse(json));
    };
    process.stdin.on('data', onData);
  });
}

// MCP Server: 暴露 CebianX 的 13 个工具
const TOOLS = [
  { name: 'cebian_navigate', description: 'Navigate the active tab to a URL', inputSchema: { ... } },
  { name: 'cebian_click', description: 'Click an element by CSS selector', inputSchema: { ... } },
  // ... 其余 11 个工具定义（复用 lib/mcp/server.ts 的 TOOLS 定义）
];

const server = new Server(
  { name: 'cebianx-mcp-native-host', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // 转发请求给 CebianX 扩展
  sendToExtension({
    type: 'mcp_request',
    method: 'tools/call',
    params: request.params,
  });
  // 等待扩展响应
  const response = await readFromExtension();
  return response;
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**步骤 2：创建 Native Messaging Host manifest**

新增文件 `scripts/com.cebianx.mcp_host.json`：
```json
{
  "name": "com.cebianx.mcp_host",
  "description": "CebianX MCP Native Messaging Host - exposes browser automation to Hermes",
  "path": "/path/to/cebianx-mcp-native-host.sh",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://CEBIANX_EXTENSION_ID/"
  ]
}
```

**注册方式**：
- **Windows**：注册表 `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.cebianx.mcp_host`
- **macOS**：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cebianx.mcp_host.json`
- **Linux**：`~/.config/google-chrome/NativeMessagingHosts/com.cebianx.mcp_host.json`

**步骤 3：CebianX 扩展侧改造**

修改 `lib/mcp/server.ts`，新增 Native Messaging 传输支持：
```typescript
// 新增：Native Messaging 连接管理
let nativePort: chrome.runtime.Port | null = null;

export function connectNativeMcpHost(): void {
  if (nativePort) return;
  nativePort = chrome.runtime.connectNative('com.cebianx.mcp_host');

  nativePort.onMessage.addListener((msg) => {
    // 接收来自 Native Host 的 MCP 请求，转发给 executeTool
    handleNativeRequest(msg).then((response) => {
      nativePort?.postMessage(response);
    });
  });

  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
    console.log('[MCP Server] Native host disconnected');
  });
}

async function handleNativeRequest(req: MCPRequest): Promise<MCPResponse> {
  // 复用现有的 handleRequest 逻辑
  return handleRequest(req);
}
```

**步骤 4：Hermes 侧配置**

在 Hermes 的 `~/.hermes/config.yaml` 中添加：
```yaml
mcp_servers:
  cebianx:
    command: "node"
    args: ["/path/to/cebianx-mcp-native-host.js"]
    # 或直接指向编译后的脚本
```

**步骤 5：用户授权与安全**

- CebianX 设置页新增"Hermes 集成"开关
- 首次连接时弹出授权确认（显示 Hermes 将能调用的工具列表）
- 支持"只读模式"（仅 cebian_read_page / cebian_screenshot）和"完整模式"（全部 13 个工具）
- 所有 Hermes 调用记录到审计日志（Dexie `mcpCallLog` 表）

#### 2.4.4 验收标准

- [ ] Native Messaging Host 脚本可被 Chrome 启动并与扩展双向通信
- [ ] Hermes config.yaml 配置后能发现 13 个 cebian_* 工具
- [ ] Hermes 调用 `cebian_navigate` 能控制浏览器导航
- [ ] Hermes 调用 `cebian_click` 能点击页面元素
- [ ] Hermes 调用 `cebian_run_workflow` 能触发 CebianX 工作流
- [ ] 用户授权机制生效（首次连接弹窗、只读/完整模式切换）
- [ ] 调用审计日志可查
- [ ] `pnpm compile` + `pnpm test` 全绿

**预估工作量**：5-7 人日

### 2.5 API Discovery（unbrowse）功能审查结论

> **审查对象**：`C:\Users\xiaoz\Desktop\CebianX-API-Discovery-Plan\实现方案.md`
> **审查日期**：2026-06-18

#### 2.5.1 实现方案文档要点

实现方案描述了"网络流量捕获 → API 端点提取 → Skill 自动生成 → API-first 执行"的本地化方案，核心设计：
- **API-first，DOM 为 fallback**：Agent 优先调用自动发现的 API Skill，失败回退 DOM 工具
- **chrome.debugger 捕获**：MV3 环境下唯一可行的 CDP 封装
- **凭证零信任**：Skill 不存储 token/cookie，执行时动态读取
- **单机本地化**：无共享/同步/市场/代币

#### 2.5.2 代码实现审查

**已实现文件清单**（8 个，与方案一致）：

| 文件 | 方案职责 | 实现状态 | 关键实现 |
|------|---------|---------|---------|
| `lib/capture/types.ts` | CDP 事件、端点元数据、Skill 定义 | ✅ 完整 | 类型定义完备 |
| `lib/capture/debugger.ts` | chrome.debugger 封装 + 心跳 | ✅ 完整 | Promise 化 + 30s 心跳保活 |
| `lib/capture/capture-session.ts` | 捕获会话生命周期管理 | ✅ 完整 | 单例 + start/stop/getCapturedRequests |
| `lib/capture/analyzer.ts` | 流量过滤、去重、参数推断 | ✅ 完整 | 静态资源过滤 + 路径归一化 + 置信度计算 |
| `lib/capture/skill-generator.ts` | 自动生成 SKILL.md + api.js | ✅ 完整 | EndpointMeta → AutoSkillDefinition |
| `lib/capture/skill-registry.ts` | 内存 + IndexedDB 持久化 | ✅ 完整 | 按 hostname 索引 + 匹配查询 |
| `lib/capture/api-executor.ts` | API-first 执行 + DOM fallback | ✅ 完整 | 动态认证注入 + NoMatchError 回退 |
| `lib/capture/handler.ts` | Background message handler | ✅ 完整 | 7 种控制消息处理 + 状态广播 |

**Agent 工具集成**（2 个，超出方案）：

| 文件 | 职责 | 实现状态 |
|------|------|---------|
| `lib/tools/smart-read-page.ts` | smart_read_page 工具（API 优先，DOM 回退） | ✅ 已注册到 `lib/tools/index.ts` |
| `lib/tools/smart-interact.ts` | smart_interact 工具（API 优先，DOM 回退） | ✅ 已注册到 `lib/tools/index.ts` |

**设置页集成**：
- `components/settings/sections/ApiDiscoverySection.tsx` 已实现
- `locales/{en,zh_CN,zh_TW}.yml` 国际化标签齐全
- `lib/storage.ts` 新增 `apiDiscoveryEnabled` storage item
- `lib/db.ts` 升级 v7，新增 `autoSkills` 表

#### 2.5.3 审查结论

| 审查维度 | 结论 | 证据 |
|---------|------|------|
| **方案一致性** | ✅ 完全一致 | 8 个核心文件 + 2 个 smart 工具均按方案实现 |
| **功能完整性** | ✅ 完整 | 捕获 → 分析 → 生成 → 注册 → 执行 → 回退全链路打通 |
| **安全约束** | ✅ 满足 | 凭证零信任（动态读取 cookie/token）、bgFetch pattern 边界 |
| **测试覆盖** | ✅ 充分 | 83 文件 / 958 测试全部通过（含 API Discovery 测试） |
| **文档完整性** | ✅ 完整 | 迭代计划 1 第十四章已记录实施过程 |

**最终结论**：**API Discovery 功能已完整推进并达到生产可用状态**，与实现方案文档完全一致，无需额外开发。后续可作为 Hermes → CebianX MCP 对接的增值能力（Hermes 可通过 CebianX 间接使用 API Discovery）。

---

## 第三部分：CebianX 迭代计划 2

### 3.1 战略主题

**从"工具"到"智能助手"——让 CebianX 具备记忆、自我进化与双向 MCP 集成能力**

借鉴 Hermes 的"自我进化"与 Tabbit 的"收藏 + RAG"，在已有 RPA 内核 + API Discovery 基础上构建四大新支柱：

1. **记忆支柱**：跨会话用户偏好 + 上下文积累（借鉴 Hermes 分层记忆）
2. **进化支柱**：工作流自动 Skill 化 + 使用中优化（借鉴 Hermes 自我进化）
3. **知识支柱**：收藏全文 + RAG 索引（借鉴 Tabbit 收藏系统）
4. **集成支柱**：Hermes → CebianX 反向 MCP 对接（实现受控浏览器自动化）

### 3.2 三阶段路线图

```
第四阶段「记忆与集成筑基」（第 1-2 月）
├── 目标：让 CebianX 记住用户 + Hermes 能受控调用 CebianX
├── 核心：分层记忆系统 + Stop 按钮修复 + Hermes→CebianX MCP 对接
└── 验证标准：跨会话上下文召回准确率 ≥ 80%，Hermes 可调用 13 个 cebian_* 工具

第五阶段「自我进化」（第 2-4 月）
├── 目标：工作流自动转化为 Skill，使用中持续优化
├── 核心：自动 Skill 生成 + 多模型并行 + 收藏 RAG
└── 验证标准：自动生成的 Skill 用户采纳率 ≥ 50%

第六阶段「知识闭环」（第 4-6 月）
├── 目标：收藏 → 索引 → 检索 → 引用全链路打通
├── 核心：收藏系统 + 全文索引 + Agent 引用 + 标签整理
└── 验证标准：收藏内容被 Agent 引用率 ≥ 30%
```

### 3.3 第四阶段：记忆与集成筑基（第 1-2 月）

#### 3.3.1 P0 任务：Stop 按钮完全修复

**任务描述**：修复 KNOWN_ISSUES Issue 1，DOM-injection 路径的 Stop 按钮无法立即终止流。

**当前状态**：已明确根因（chrome.scripting 无 abort 信号），延后处理。

**实现方案**：
```typescript
// 方案：注入 chrome.runtime.connect 端口，content script 轮询 abort 信号
// 1. installIsolatedBridge 注入 Port
// 2. runDomRelayMainWorld 每 100ms 轮询 Port 的 abort 标志
// 3. Stop 按钮触发 Port.postMessage({ type: 'abort' })
```

**验收标准**：
- [ ] 点击 Stop 后 500ms 内流式输出停止
- [ ] 二次点击 Stop 无副作用
- [ ] 不影响正常流式回复

**预估工作量**：1-2 人日

#### 3.3.2 P0 任务：Hermes → CebianX MCP 反向对接

**任务描述**：实现 Hermes 通过 MCP 协议受控调用 CebianX 浏览器自动化能力。

**当前状态**：CebianX 已有 MCP Server（13 个工具），但传输层不支持 Hermes（Python 进程）调用。

**实现方案**：详见第 2.4 节"Native Messaging Host 桥接方案"。

**核心交付物**：
- `scripts/cebianx-mcp-native-host.ts`：Native Messaging Host 脚本
- `scripts/com.cebianx.mcp_host.json`：Native Host manifest
- `lib/mcp/server.ts` 改造：新增 Native Messaging 传输支持
- `components/settings/sections/HermesIntegrationSection.tsx`：设置页 UI（授权开关、模式选择、审计日志）
- `lib/db.ts` 升级：新增 `mcpCallLog` 表

**验收标准**：
- [ ] Native Messaging Host 可被 Chrome 启动并与扩展双向通信
- [ ] Hermes config.yaml 配置后能发现 13 个 cebian_* 工具
- [ ] Hermes 调用 `cebian_navigate` / `cebian_click` / `cebian_run_workflow` 功能正常
- [ ] 用户授权机制生效（首次弹窗、只读/完整模式切换）
- [ ] 调用审计日志可查
- [ ] `pnpm compile` + `pnpm test` 全绿

**预估工作量**：5-7 人日

#### 3.3.3 P0 任务：分层记忆系统

**任务描述**：借鉴 Hermes 分层记忆，实现跨会话上下文积累。

**架构设计**：
```
lib/memory/
├── types.ts              # 记忆类型定义
├── user-profile.ts       # 用户画像（偏好、习惯）
├── agent-memory.ts       # Agent 记忆（任务模式、成功经验）
├── session-history.ts    # 会话历史摘要
├── retrieval.ts          # 记忆检索（基于 Dexie）
└── prompt-builder.ts     # 将记忆注入 Agent system prompt
```

**记忆分层**：
| 层级 | 内容 | 存储方式 | 注入策略 |
|------|------|---------|---------|
| **用户画像** | 语言偏好、常用网站、工作习惯 | Dexie `userProfile` 表 | 每次对话注入 |
| **Agent 记忆** | 成功的任务模式、失败教训 | Dexie `agentMemory` 表 | 相关时注入 |
| **会话摘要** | 历史会话的关键信息摘要 | Dexie `sessionSummary` 表 | 检索后注入 |

**实现步骤**：
1. 设计 Dexie schema v8，新增 `userProfile`、`agentMemory`、`sessionSummary` 表
2. 实现记忆写入：会话结束时 LLM 生成摘要 + 提取用户偏好
3. 实现记忆检索：基于关键词 + 时间衰减的相关性检索
4. 实现 prompt 注入：将相关记忆注入 Agent system prompt

**验收标准**：
- [ ] 用户偏好（如"偏好 TypeScript"）跨会话保留
- [ ] Agent 能引用 7 天内的会话上下文
- [ ] 记忆注入不增加超过 500 tokens 开销
- [ ] 用户可查看/删除记忆（设置页）

**预估工作量**：5-7 人日

#### 3.3.4 P1 任务：用户偏好学习

**任务描述**：自动从用户行为中学习偏好，无需手动配置。

**学习维度**：
| 维度 | 学习信号 | 应用场景 |
|------|---------|---------|
| **语言偏好** | 用户消息语言 | Agent 回复语言 |
| **常用网站** | navigate 步骤目标 URL | 预置工作流推荐 |
| **工作习惯** | 工作流执行时间分布 | 定时任务建议 |
| **工具偏好** | interact vs browserwing 选择 | 工具推荐优先级 |

**验收标准**：
- [ ] 使用 3 次后能识别用户语言偏好
- [ ] 偏好学习不影响响应速度（异步处理）
- [ ] 用户可在设置页查看/修正偏好

**预估工作量**：3-4 人日

#### 3.3.5 第四阶段里程碑

| 检查点 | 时间 | 标准 |
|--------|------|------|
| Stop 按钮修复 | 第 2 周 | 500ms 内终止流式输出 |
| Hermes→CebianX MCP 对接 | 第 4 周 | Hermes 可调用 13 个 cebian_* 工具 |
| 记忆系统 MVP | 第 6 周 | 跨会话上下文召回准确率 ≥ 80% |
| 偏好学习上线 | 第 8 周 | 3 次使用后识别语言偏好 |

### 3.4 第五阶段：自我进化（第 2-4 月）

#### 3.4.1 P0 任务：工作流自动 Skill 化

**任务描述**：借鉴 Hermes 自我进化，工作流执行后自动生成可复用 Skill。

**实现方案**：
```typescript
// lib/workflow/auto-skill.ts
// 监听工作流执行完成事件
// 1. 提取工作流结构 + 执行结果
// 2. LLM 生成 Skill 描述（名称、用途、参数）
// 3. 参数化：识别可变部分（如 URL、文本）提取为参数
// 4. 写入 Skill 注册表，标记为"自动生成"
// 5. 下次类似任务时，Agent 优先推荐该 Skill
```

**参数化策略**：
| 元素类型 | 参数化示例 |
|---------|-----------|
| 固定 URL | `https://example.com/login` → `{{url}}` |
| 固定文本 | `用户名` → `{{username}}` |
| 固定日期 | `2026-06-18` → `{{today}}` |
| 选择器 | 保留（通常稳定） |

**验收标准**：
- [ ] 工作流执行 3 次后自动生成 Skill
- [ ] 自动生成的 Skill 参数化率 ≥ 60%
- [ ] Agent 能在类似任务中推荐自动 Skill
- [ ] 用户可查看/禁用/删除自动 Skill

**预估工作量**：6-8 人日

#### 3.4.2 P1 任务：多模型并行回复

**任务描述**：借鉴 Tabbit，支持最多 5 个模型同时回答同一问题。

**实现方案**：
```typescript
// lib/agent/multi-model.ts
// 1. 用户选择多个模型（ModelSelector 多选）
// 2. 并行调用各模型的 stream
// 3. UI 分栏展示各模型回复
// 4. 用户可对单个模型回复继续对话
```

**验收标准**：
- [ ] 支持 2-5 个模型并行回复
- [ ] 各模型回复独立流式展示
- [ ] 可对单个模型回复继续对话
- [ ] 性能：5 模型并行时首 token 延迟 ≤ 3s

**预估工作量**：4-5 人日

#### 3.4.3 P1 任务：收藏系统 + RAG 索引

**任务描述**：借鉴 Tabbit，支持收藏页面全文并建立检索索引。

**架构设计**：
```
lib/collection/
├── types.ts           # 收藏项类型
├── collector.ts       # 页面收藏（read-page + 全文提取）
├── indexer.ts         # 全文索引（基于 Dexie + 倒排索引）
├── retrieval.ts       # 检索（关键词 + TF-IDF）
└── agent-integration.ts  # Agent 引用收藏内容
```

**验收标准**：
- [ ] 一键收藏当前页面（≤ 3s 完成索引）
- [ ] 收藏内容支持关键词检索
- [ ] Agent 能引用收藏内容回答问题
- [ ] 收藏列表 UI 可管理（搜索/删除/分类）

**预估工作量**：6-8 人日

#### 3.4.4 第五阶段里程碑

| 检查点 | 时间 | 标准 |
|--------|------|------|
| 自动 Skill 生成 | 第 12 周 | 执行 3 次后自动生成，采纳率 ≥ 50% |
| 多模型并行 | 第 14 周 | 5 模型并行首 token ≤ 3s |
| 收藏 RAG | 第 16 周 | 收藏内容 Agent 引用率 ≥ 30% |

### 3.5 第六阶段：知识闭环（第 4-6 月）

#### 3.5.1 P1 任务：标签组智能整理

**任务描述**：借鉴 Tabbit，AI 自动整理浏览器标签页分组。

**实现方案**：
```typescript
// lib/tools/tab-organizer.ts
// 1. chrome.tabs.query 获取所有标签页
// 2. 提取每个标签页的 title + url
// 3. LLM 分类（按网站/主题/时间）
// 4. chrome.tabs.group 创建分组
// 5. chrome.tabGroups 设置分组名称/颜色
```

**验收标准**：
- [ ] 一键整理所有标签页（≤ 5s）
- [ ] 分组准确率 ≥ 80%（用户确认）
- [ ] 支持自定义分组规则

**预估工作量**：3-4 人日

#### 3.5.2 P2 任务：自然语言定时任务

**任务描述**：借鉴 Hermes，支持自然语言设置定时任务。

**验收标准**：
- [ ] 自然语言解析 cron 准确率 ≥ 90%
- [ ] 定时任务 7 天稳定运行
- [ ] 支持查看/编辑/删除定时任务

**预估工作量**：3-4 人日

#### 3.5.3 P2 任务：技术债务清理

**任务描述**：持续清理 `any` 类型残留（367 处/92 文件）。

**策略**：每迭代清理 5-10 个文件，按优先级：
1. 高频生产文件（已完成 19 个）
2. 测试文件（类型要求较宽松）
3. 配置/工具文件

**验收标准**：
- [ ] 每迭代减少 ≥ 30 处 `any`
- [ ] 不引入新的 `any`
- [ ] `pnpm compile` + `pnpm test` 全绿

**预估工作量**：持续进行，每迭代 1-2 人日

#### 3.5.4 第六阶段里程碑

| 检查点 | 时间 | 标准 |
|--------|------|------|
| 标签整理 | 第 20 周 | 分组准确率 ≥ 80% |
| 自然语言定时 | 第 22 周 | cron 解析准确率 ≥ 90% |
| 技术债清理 | 第 24 周 | `any` 减少至 ≤ 100 处 |

---

## 第四部分：严格审查

### 4.1 可行性审查

#### 4.1.1 技术可行性

| 任务 | 技术风险 | 风险等级 | 缓解措施 |
|------|---------|---------|---------|
| Stop 按钮修复 | chrome.scripting Port 跨 world 通信复杂 | 中 | 先做技术 Spike（1 天）验证方案 |
| Hermes→CebianX MCP 对接 | Native Messaging 跨平台注册复杂 | 中 | 提供安装脚本，Windows 优先 |
| 分层记忆系统 | MV3 SW 生命周期导致记忆丢失 | 低 | Dexie 持久化，SW 唤醒自动加载 |
| 自动 Skill 生成 | LLM 参数化质量不稳定 | 中 | 生成后用户确认，支持手动修正 |
| 多模型并行 | 并发流式 UI 性能 | 中 | 限制最多 5 模型，虚拟列表优化 |
| 收藏 RAG | 全文索引在 MV3 环境性能 | 中 | 增量索引，限制单收藏 ≤ 100KB |
| 标签整理 | chrome.tabs API 权限 | 低 | 已有 tabs 权限 |

**结论**：所有任务技术可行，3 项中等风险已有缓解措施。

#### 4.1.2 资源可行性

| 阶段 | 工作量估算 | 单人全职周期 | 关键依赖 |
|------|-----------|-------------|---------|
| 第四阶段 | 14-20 人日 | 约 3 周 | Stop 修复 Spike + Native Messaging Host + 记忆系统设计 |
| 第五阶段 | 16-21 人日 | 约 4 周 | 自动 Skill 的 LLM Prompt 设计 |
| 第六阶段 | 6-8 人日 + 持续 | 约 2 周 + 持续 | 无外部依赖 |

**结论**：按单人全职计算，三阶段约 9 周可完成核心任务。资源紧张时可砍第六阶段 P2 任务。

#### 4.1.3 市场可行性

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Tabbit 1.0 已上线，先发优势明显 | 高 | 中 | CebianX 定位差异化（无需切换浏览器 + Hermes 双向集成） |
| Chrome 原生 AI Assist 推出类似功能 | 中 | 高 | 深耕企业内网 + Hermes 集成等 Chrome 不做的场景 |
| 用户对"记忆"功能隐私担忧 | 中 | 中 | 记忆本地存储 + 用户可查看/删除 |
| Hermes → CebianX 对接的 Native Host 安装门槛 | 中 | 中 | 提供一键安装脚本，Windows 优先 |

### 4.2 优先级排序审查

**审查结论**：优先级排序合理，Hermes→CebianX MCP 对接提升为 P0（与记忆系统并列）。

| 任务 | 优先级 | 理由 |
|------|--------|------|
| Stop 按钮修复 | P0 | 影响基础体验，必须先修 |
| Hermes→CebianX MCP 对接 | **P0** | 核心差异化，实现受控浏览器自动化 |
| 分层记忆系统 | P0 | 核心差异化，所有后续功能依赖 |
| 自动 Skill 生成 | P1 | 依赖记忆系统，应排在记忆之后 |
| 多模型并行 | P2 | 锦上添花，非核心差异化 |
| 收藏 RAG | P1 | 知识支柱核心，与记忆协同 |

### 4.3 与迭代计划 1 的一致性审查

| 一致性维度 | 审查结论 |
|-----------|---------|
| **核心定位** | ✅ 一致：均聚焦"浏览器原生 AI 自动化" |
| **技术栈** | ✅ 一致：Dexie/MCP/WXT/MV3 |
| **用户群体** | ✅ 一致：技术小白 + 开发者 |
| **差异化方向** | ✅ 延续：从 RPA 内核延伸到智能助手 + 双向 MCP |
| **风险应对** | ✅ 延续：MV3 限制、大厂竞争等风险持续监控 |
| **API Discovery** | ✅ 延续：已完整实现，作为 Hermes 对接的增值能力 |

### 4.4 排除项明确声明

为避免范围蔓延，以下任务**明确排除**在迭代计划 2 之外：

| 排除项 | 理由 |
|--------|------|
| Google Sheets 导出 | 用户决策移除，CSV/Clipboard/JSON 已满足需求 |
| 社区工作流市场 | 用户决策移除，聚焦核心能力 |
| 多平台访问（Telegram/Discord 等） | CebianX 定位为浏览器扩展，不追求 Hermes 的多平台 |
| 云端执行工作流 | MV3 限制 + 隐私考量，保持本地执行 |
| 企业功能（SSO/审计） | 资源约束，留给未来商业化版本 |
| Firefox/Safari 兼容性 | 聚焦 Chrome/Edge 90%+ 市场份额 |
| 埋点统计系统 | 隐私优先，用用户反馈替代 |

---

## 第五部分：成功指标（OKR）

### 5.1 第四阶段（第 1-2 月）

- **O**：CebianX 具备跨会话记忆能力 + Hermes 双向集成
- **KR1**：跨会话上下文召回准确率 ≥ 80%
- **KR2**：Stop 按钮修复后用户满意度 ≥ 4/5
- **KR3**：Hermes 可调用 13 个 cebian_* 工具，联调通过
- **KR4**：用户偏好学习 3 次使用后识别率 ≥ 90%

### 5.2 第五阶段（第 2-4 月）

- **O**：CebianX 具备自我进化能力
- **KR1**：自动生成 Skill 用户采纳率 ≥ 50%
- **KR2**：多模型并行功能周使用 ≥ 100 次
- **KR3**：收藏内容被 Agent 引用率 ≥ 30%

### 5.3 第六阶段（第 4-6 月）

- **O**：知识闭环 + 技术债清理
- **KR1**：标签整理准确率 ≥ 80%
- **KR2**：自然语言定时任务解析准确率 ≥ 90%
- **KR3**：`any` 类型减少至 ≤ 100 处

---

## 第六部分：资源分配与风险应对

### 6.1 人力配置（建议）

| 角色 | 人数 | 职责 | 投入阶段 |
|------|------|------|---------|
| **技术负责人** | 1 人 | 记忆系统架构、Hermes 对接架构、审查 | 全阶段 |
| **前端工程师** | 1 人 | 记忆 UI、多模型并行 UI、收藏 UI、标签整理 | 第四、五阶段 |
| **浏览器扩展工程师** | 1 人 | Stop 修复、Native Messaging Host、Dexie schema、chrome.tabs 整合 | 全阶段 |

> **单人模式**：聚焦第四阶段（记忆系统 + Hermes 对接）+ 第五阶段（自动 Skill），砍掉多模型并行和标签整理。

### 6.2 风险应对策略

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| **记忆系统注入 prompt 过长** | 中 | 中 | 限制注入 ≤ 500 tokens，相关性排序 |
| **自动 Skill 参数化质量差** | 中 | 中 | 用户确认机制 + 手动修正入口 |
| **Tabbit 先发优势挤压** | 高 | 中 | 强调"无需切换浏览器 + Hermes 双向集成"差异化 |
| **MV3 SW 终止导致记忆丢失** | 低 | 高 | Dexie 持久化 + SW 唤醒自动恢复 |
| **Native Messaging Host 跨平台安装复杂** | 中 | 中 | Windows 优先，提供一键安装脚本 |
| **范围蔓延** | 高 | 中 | 严格执行排除项，新需求入 Backlog |

---

## 第七部分：验收标准与质量保障

### 7.1 分阶段验收

**第四阶段验收（第 8 周末）**
- [ ] Stop 按钮点击后 500ms 内终止流式输出
- [ ] Hermes 可通过 MCP 调用 13 个 cebian_* 工具
- [ ] Native Messaging Host 在 Windows/macOS 可安装
- [ ] 用户授权机制生效（首次弹窗、只读/完整模式）
- [ ] 跨会话上下文召回准确率 ≥ 80%（20 个测试用例）
- [ ] 用户偏好学习 3 次使用后识别语言偏好
- [ ] 记忆系统不增加超过 500 tokens 开销
- [ ] 设置页可查看/删除记忆 + 查看 MCP 调用审计日志
- [ ] `pnpm compile` + `pnpm test` 全绿

**第五阶段验收（第 16 周末）**
- [ ] 工作流执行 3 次后自动生成 Skill
- [ ] 自动 Skill 参数化率 ≥ 60%
- [ ] 多模型并行（5 模型）首 token ≤ 3s
- [ ] 收藏内容 Agent 引用率 ≥ 30%
- [ ] 收藏索引 ≤ 3s 完成
- [ ] `pnpm compile` + `pnpm test` 全绿

**第六阶段验收（第 24 周末）**
- [ ] 标签整理准确率 ≥ 80%
- [ ] 自然语言 cron 解析准确率 ≥ 90%
- [ ] `any` 类型减少至 ≤ 100 处
- [ ] 定时任务 7 天稳定运行
- [ ] `pnpm compile` + `pnpm test` 全绿

### 7.2 质量保障机制

| 机制 | 实施方式 | 频率 |
|------|---------|------|
| **自动化测试** | 记忆系统单元测试 + Native Messaging 集成测试 + 收藏 RAG 集成测试 + 多模型 E2E | 每次 PR |
| **代码审查** | 所有代码 1 人 Review，架构变更技术负责人审批 | 每次 PR |
| **性能基准** | 记忆注入延迟 ≤ 100ms、收藏索引 ≤ 3s、多模型首 token ≤ 3s、Native Messaging 响应 ≤ 500ms | 每阶段里程碑 |
| **用户测试** | 10 名用户测试记忆 + 自动 Skill + Hermes 对接，收集 SUS 评分 | 第四、五阶段 |
| **隐私审计** | 记忆数据本地存储验证、用户删除权限验证、MCP 调用审计日志验证 | 第四阶段 |
| **安全审计** | Native Messaging Host 权限边界验证、Hermes 调用授权机制验证 | 第四阶段 |

---

## 第八部分：立即执行清单

| 序号 | 任务 | 优先级 | 状态 | 验收标准 |
|------|------|--------|------|---------|
| 1 | Stop 按钮修复技术 Spike | P0 | 🔄 待开始 | 验证 Port 跨 world 通信方案可行 |
| 2 | Native Messaging Host 架构设计 | P0 | 🔄 待开始 | 架构评审通过，技术 Spike 验证可行 |
| 3 | `cebianx-mcp-native-host.ts` 脚本编写 | P0 | 🔄 待开始 | 可被 Chrome 启动并与扩展双向通信 |
| 4 | `lib/mcp/server.ts` Native Messaging 改造 | P0 | 🔄 待开始 | 扩展可接收 Native Host 请求并响应 |
| 5 | Hermes 集成设置页 UI | P0 | 🔄 待开始 | 授权开关、模式选择、审计日志可用 |
| 6 | 分层记忆系统架构设计 | P0 | 🔄 待开始 | Dexie schema v8 设计评审通过 |
| 7 | 记忆系统 Dexie 表实现 | P0 | 🔄 待开始 | userProfile/agentMemory/sessionSummary 表可用 |

---

## 附录 A：与迭代计划 1 的衔接

迭代计划 2 在迭代计划 1 完成的基础上延伸：

| 迭代计划 1 成果 | 迭代计划 2 利用方式 |
|---------------|-------------------|
| Workflow Engine | 自动 Skill 生成的基础 |
| AI Planner | 结合记忆系统优化规划质量 |
| 触发器系统 | 自然语言定时任务的基础 |
| MCP Server（13 个工具） | Hermes→CebianX 反向对接的基础 |
| Hermes MCP 桥接（CebianX→Hermes） | 与反向对接互补，形成双向集成 |
| API Discovery（已完整实现） | Hermes 可通过 CebianX 间接使用 API-first 能力 |
| 视觉定位 | 与收藏系统协同，截图也可收藏 |

## 附录 B：Hermes 双向集成架构

```
┌──────────────────────────────────────────────────────────────┐
│  双向 MCP 集成                                                │
│                                                              │
│  方向 1（已完成）：CebianX → Hermes                           │
│  CebianX (MCP Client) ──HTTP──→ hermes-mcp-bridge.ts          │
│                              ──stdio──→ Hermes (MCP Server)   │
│  用途：CebianX 调用 Hermes 的 47 个工具（搜索、代码执行等）    │
│                                                              │
│  方向 2（计划中）：Hermes → CebianX                           │
│  Hermes (MCP Client) ──stdio──→ cebianx-mcp-native-host.ts    │
│                              ──Native Messaging──→ CebianX    │
│  (MCP Server, 13 个浏览器工具)                                │
│  用途：Hermes 受控调用 CebianX 的浏览器自动化能力              │
│                                                              │
│  协同价值：                                                   │
│  - Hermes 需要浏览器操作时 → 调用 CebianX                     │
│  - CebianX 需要 Web 搜索/代码执行时 → 调用 Hermes             │
│  - API Discovery 的 Skill 可被 Hermes 间接使用                │
└──────────────────────────────────────────────────────────────┘
```

## 附录 C：参考资源

- **Tabbit 1.0**：美团光年之外团队 AI Native 浏览器（2026-06-09 发布）
- **Hermes Agent**：Nous Research 开源自我进化 AI Agent（MIT 协议，126k+ stars）
- **CebianX 迭代计划 1**：`docs/CebianX项目迭代计划.md`
- **CebianX 战略分析**：`docs/STRATEGIC_ANALYSIS.md`
- **CebianX 已知问题**：`docs/KNOWN_ISSUES.md`
- **Hermes MCP 桥接（CebianX→Hermes）**：`scripts/hermes-mcp-bridge.ts`（已完成联调）
- **CebianX MCP Server**：`lib/mcp/server.ts`（13 个工具，待新增 Native Messaging 传输）
- **API Discovery 实现方案**：`C:\Users\xiaoz\Desktop\CebianX-API-Discovery-Plan\实现方案.md`（已完整实现）
- **API Discovery 代码**：`lib/capture/`（8 个文件）+ `lib/tools/smart-*.ts`（2 个工具）

---

*本计划基于迭代计划 1 完成情况 + Tabbit/Hermes 调研 + API Discovery 审查制定，每两周 review 一次进度，每阶段结束后依据验收标准进行 Go/No-Go 决策。*
