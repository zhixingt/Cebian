# CebianX项目迭代计划：浏览器原生 RPA 引擎

> 基于调整后的核心目标制定：
> 1. 深耕"Web自动化 + RPA + 数据抓取"垂直场景
> 2. "浏览器即工作流"——利用浏览器原生能力实现自动化
> 3. 服务技术小白，用户体验出色，工作流顺畅丝滑

---

## 一、家底诊断

### 1.1 核心资产（已具备）

| 资产 | 现状 | 价值评估 |
|------|------|----------|
| **原生页面操作工具链** (`interact.ts`) | 15种原子操作，支持sequence条件分支，事件模拟完善 | 核心竞争力，区别于Playwright/Puppeteer外部方案 |
| **MCP Client 架构** (`mcp/client.ts`, `manager.ts`) | 生产级实现：限流、熔断、重连、工具缓存、SSE/HTTP双传输 | 可扩展性强，已预留MCP Server反向能力 |
| **录制回放系统** (`recorder/`) | 事件录制 → sequence转换 → 智能优化（合并输入、去重点击） | "无代码RPA"的最短路径，技术小白友好 |
| **Skill 执行沙箱** (`run-skill.ts`) | 权限分级、VFS隔离、bgFetch代理 | 已有browserwing skill作为自动化补充 |
| **Agent 多会话管理** (`agent-manager.ts`) | ManagedSession生命周期管理、工具上下文动态构建 | 支撑复杂多步任务 |
| **前端文件解析** (`attachments.ts`) | PDF/DOCX/XLSX纯文本提取，浏览器端完成 | 数据抓取场景的输入能力 |

### 1.2 关键短板（必须补齐）

| 短板 | 影响 | 紧迫度 |
|------|------|--------|
| **Workflow Engine 缺失** | 录制只能生成一次性sequence，无法保存、复用、调度 | P0 |
| **AI Planner 缺失** | 用户必须手动录制，无法"一句话自动化" | P0 |
| **触发器系统缺失** | 无定时/URL/DOM触发，做不到" unattended 自动化" | P1 |
| **数据导出管道缺失** | 抓取的数据只能停留在聊天窗口，无法流向Sheets/CSV/Notion | P1 |
| **视觉定位能力弱** | 纯DOM选择器在动态页面（React/Vue）易失效 | P2 |
| **异常自修复缺失** | 步骤失败即中断，无重试、无降级策略 | P2 |

### 1.3 技术债务（必须清理）

| 债务 | 说明 | 处理策略 |
|------|------|----------|
| **BrowserWing 与原生工具链重叠** | 两者都能click/type/navigate，Agent困惑，用户困惑 | 明确分工：原生链为默认，BrowserWing为跨Tab/跨窗口高级场景保留 |
| **录制系统未对接Workflow** | `session-to-sequence.ts` 输出的是interact步骤，非持久化Workflow对象 | 改造为输出Workflow DSL |
| **三个基础体验Bug未根治** | 会话返回、文件上传、自动滚动，用户多次反馈未解决 | 列入第一阶段首要任务，必须闭环 |
| **MV3 Service Worker 生命周期限制** | 长时工作流可能被SW终止 | 设计断点续跑 + 分段执行策略 |

---

## 二、迭代总览：三阶段路线图

```
第一阶段「体验筑基」（第1-2月）
├── 目标：让现有功能稳定、流畅、小白友好
├── 核心：修复Bug + 统一交互范式 + 录制即保存
└── 验证标准：CWS评分≥4.0，录制→回放成功率≥90%

第二阶段「RPA内核」（第2-4月）
├── 目标：让浏览器成为可编排的自动化引擎
├── 核心：Workflow Engine + AI Planner + 触发器
└── 验证标准：一句话生成5步workflow成功率≥70%，定时任务稳定运行

第三阶段「生态闭环」（第4-6月）
├── 目标：数据抓取→处理→导出全链路打通
├── 核心：数据管道 + 工作流市场 + MCP Server反向开放
└── 验证标准：预置workflow≥20个，社区分享≥100个
```

---

## 三、第一阶段：体验筑基（第1-2月）

### 3.1 体验Bug修复状态（已核实）

> **核实结论**：三个Bug的核心修复代码均已存在于代码库，但文件上传存在一处**体验遗留问题**。

| 任务 | 修复状态 | 核实位置 | 遗留问题 |
|------|----------|----------|----------|
| **会话返回** | ✅ 已修复 | `SettingsLayout.tsx` 第60-67行`handleBack`读取`lastSessionId`；`App.tsx` 第51-77行首次挂载恢复 + `pageshow` bfcache恢复 | 无 |
| **自动滚动** | ✅ 已修复 | `chat/index.tsx` 第166-173行`messageCount`监听 + `requestAnimationFrame`；`Message.tsx` 第277行`maxLines`默认30 | 无 |
| **文件上传** | ⚠️ 核心已修复，有遗留 | `attachments.ts` 提取函数完整；`ChatInput.tsx` 第637-639行`.doc`提示正确 | **`accept`属性未包含`.pdf/.docx/.xlsx`**，文件选择器默认过滤 |

**立即行动**：补充`accept`属性后即可关闭此Bug。第一阶段重心从"修复Bug"调整为**用户验证 + 体验打磨**。

### 3.2 统一自动化交互范式

**目标**：消除"到底用interact还是browserwing"的困惑。

**决策**：
- **默认路径**：所有单Tab页面操作走原生 `interact` 工具链（更快、更稳定、无外部依赖）
- **保留路径**：以下场景仍调用BrowserWing skill：
  - 跨Tab操作（原生工具链绑定当前active tab）
  - 需要网络/控制台监控（`consoleMessages`, `networkRequests`）
  - 批量表单填充（`fillForm` 智能匹配）
- **UI提示**：Sidepanel中自动化操作时显示"🖱️ 浏览器原生"或"🌐 BrowserWing"标签

**实现**：
```typescript
// lib/tools/index.ts 中调整工具优先级
// Agent system prompt 中增加指导：
// "优先使用interact工具进行当前页面的点击、输入、滚动操作。
// 仅在需要跨Tab、监控网络/控制台、或智能表单填充时使用browserwing skill。"
```

### 3.3 录制系统升级：录制即保存

**现状**：录制生成sequence后，用户只能"立即回放"，无法保存复用。

**改造**：
```
lib/recorder/
├── session-to-sequence.ts   (现有，保留)
├── session-to-workflow.ts   (新增，录制事件 → Workflow DSL对象)
└── ai-optimizer.ts          (新增，LLM优化步骤，如"将日期替换为今天")
```

**Workflow DSL v0.1**（最小可用）：
```typescript
interface Workflow {
  id: string;
  name: string;
  createdAt: number;
  steps: WorkflowStep[];
}

type WorkflowStep =
  | { type: 'navigate'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'extract'; selector: string; fields: string[] }
  | { type: 'wait'; selector?: string; timeout: number }
  | { type: 'scroll'; selector?: string; deltaY: number };
```

**用户流程**：
1. 点击"录制" → 操作页面 → 点击"停止"
2. 弹出"录制结果"面板，显示步骤列表（可删除/编辑单步）
3. 点击"保存为工作流" → 输入名称 → 保存到Dexie
4. 工作流出现在"我的自动化"列表，可随时运行

### 3.4 工作流执行器（最小版）

无需完整Workflow Engine，先实现顺序执行器：

```typescript
// lib/workflow/executor.ts
export async function executeWorkflow(
  workflow: Workflow,
  options: { onStepStart?: (step, index) => void; onStepEnd?: (step, index, result) => void }
): Promise<ExecutionResult> {
  for (const [i, step] of workflow.steps.entries()) {
    options.onStepStart?.(step, i);
    const result = await executeStep(step); // 复用interact工具链
    options.onStepEnd?.(step, i, result);
  }
}
```

**UI**：Sidepanel新增"我的自动化"标签页，列表展示已保存工作流，点击"运行"逐步高亮执行。

### 3.5 第一阶段里程碑

| 检查点 | 时间 | 标准 |
|--------|------|------|
| Bug修复闭环 | 第1周 | 三个Bug用户验证通过 |
| 录制→保存链路 | 第3周 | 录制→保存→运行端到端可用 |
| 预置工作流 | 第6周 | 提供5个官方预置workflow（批量填报、价格监控、数据抓取、表单提交、定时签到） |

---

## 四、第二阶段：RPA内核（第2-4月）

### 4.1 Workflow Engine 正式版

**架构**：
```
lib/workflow/
├── engine.ts          # WorkflowEngine 状态机（基于xstate或自研）
├── state-machine.ts   # 状态持久化（Dexie），支持断点续跑
├── executor.ts        # 步骤执行（复用interact/mcp/skill）
├── planner.ts         # AI Planner：自然语言 → Workflow
├── triggers/
│   ├── cron-trigger.ts    # chrome.alarms 定时触发
│   ├── url-trigger.ts     # chrome.tabs.onUpdated URL匹配
│   └── dom-trigger.ts     # MutationObserver 元素出现触发
├── types.ts           # Workflow DSL v0.2（增加条件分支、循环）
└── schema.ts          # JSON Schema校验
```

**状态机设计**（简化）：
```
idle → planning → pending_confirm → running → paused → completed
                    ↓                    ↓
                 rejected             failed → retrying
```

**断点续跑策略**（应对MV3 SW终止）：
1. 每步执行后立即`await db.workflows.put(state)`持久化
2. SW唤醒时检查`db.workflows`中`status === 'running'`的记录
3. 自动恢复执行，从断点步继续

### 4.2 AI Planner：一句话自动化

**输入**：用户自然语言 + 当前页面上下文（title、url、DOM snapshot摘要）

**输出**：Workflow JSON（须经用户确认后方可执行）

**Prompt设计**：
```
用户目标：{goal}
当前页面：{title} ({url})
可交互元素：{clickableElementsSummary}

请将目标拆解为浏览器操作步骤，输出JSON：
- navigate: 打开URL
- click: 点击元素（用CSS selector）
- type: 输入文本
- extract: 提取数据（用CSS selector + 字段名）
- wait: 等待元素出现或固定时长
- scroll: 滚动页面

约束：
1. selector优先用id、name、aria-label，避免动态class
2. 每步增加"reason"字段说明为何此步
3. 如果目标模糊，输出"needs_clarification"并列出需确认的问题
```

**确认UI**：
- Planner生成workflow后，以"步骤卡片"形式展示
- 每步可编辑selector/text、可拖拽排序、可删除
- 用户点击"确认执行"或"保存并稍后运行"

### 4.3 触发器系统

| 触发器 | 实现方式 | 典型场景 |
|--------|----------|----------|
| **手动** | 用户点击"运行" | 一次性任务 |
| **定时（Cron）** | `chrome.alarms` + 用户Cron表达式 | 每日9点自动导出报表 |
| **URL匹配** | `chrome.tabs.onUpdated` + 正则匹配 | 打开后台管理页时自动签到 |
| **DOM出现** | Content Script MutationObserver | 页面出现"立即购买"按钮时自动点击 |

**注意**：MV3中alarms最小间隔1分钟，且SW可能休眠。定时任务需配合断点续跑。

### 4.4 录制增强：AI优化步骤

**场景**：用户录制了"登录→点击报表→选择2024-01-01→导出"

**AI优化建议**：
- "检测到登录步骤，建议提取账号密码为参数（运行时输入）"
- "检测到固定日期，建议替换为`{{today}}`动态日期"
- "建议在导出后增加`wait 5s`等待下载完成"

**UI**：录制结果面板增加"🪄 AI优化"按钮，弹出优化建议列表，用户勾选应用。

### 4.5 第二阶段里程碑

| 检查点 | 时间 | 标准 |
|--------|------|------|
| Workflow Engine MVP | 第8周 | 支持顺序执行、条件分支、循环、断点续跑 |
| AI Planner上线 | 第10周 | 一句话生成简单workflow成功率≥70%，须经用户确认 |
| 触发器上线 | 第12周 | 定时+URL+DOM三种触发器可用，定时任务稳定运行≥7天 |
| 预置workflow≥15 | 第14周 | 覆盖电商、办公、数据抓取场景 |

---

## 五、第三阶段：生态闭环（第4-6月）

### 5.1 数据管道：抓取→处理→导出

**现状**：`extract`步骤获取的数据只能显示在聊天窗口。

**目标**：让数据流向用户真正需要的地方。

**实现**：
```typescript
// 新增步骤类型
{ type: 'export', destination: 'csv', filename: 'products-{{date}}.csv' }
{ type: 'export', destination: 'google-sheets', sheetName: '竞品价格' }
{ type: 'export', destination: 'clipboard' }
```

**导出格式**：
- CSV：浏览器端生成Blob下载
- Google Sheets：OAuth + Sheets API（或simulate用户操作）
- Clipboard：`navigator.clipboard.writeText`
- JSON：保存到VFS供其他skill读取

### 5.2 工作流市场

**目标**：用户分享/下载workflow，建立生态壁垒。

**机制**：
- 导出：`workflow.json` + `README.md` 打包为 `.ceb` 文件
- 导入：拖拽 `.ceb` 文件到Sidepanel即可安装
- 官方市场：GitHub仓库 `cebianx/workflows` 作为官方源，CebianX内置"发现"页拉取列表

### 5.3 MCP Server 反向开放

**目标**：让外部工具（n8n、Claude Desktop）能调用CebianX的浏览器能力。

**实现**：
```typescript
// lib/mcp/server.ts（新增）
// CebianX作为MCP Server，暴露以下工具：
// - cebian_navigate
// - cebian_click
// - cebian_extract
// - cebian_run_workflow
// 传输：stdio（与Claude Desktop集成）或SSE（与n8n集成）
```

**价值**：当用户在n8n中需要"在浏览器中完成某步"时，可调用CebianX，形成互补。

### 5.4 视觉+DOM双模定位（P2）

**时机**：第三阶段视资源情况投入，不影响主线。

**方案**：
- 截图 → 前端VLM（如`transformers.js`加载轻量模型，或调用云端VLM API）→ 返回元素坐标
- 坐标 + DOM信息联合定位，处理动态class、canvas内元素等难题

### 5.5 第三阶段里程碑

| 检查点 | 时间 | 标准 |
|--------|------|------|
| 数据管道 | 第18周 | 支持CSV/Clipboard导出，Sheets导出可用 |
| 工作流市场 | 第20周 | 社区workflow≥50个，导入/导出流畅 |
| MCP Server | 第22周 | n8n/Claude Desktop可调用CebianX工具 |
| 企业功能预览 | 第24周 | SSO、审计日志方案确定 |

---

## 六、关键决策与取舍

### 6.1 BrowserWing 的定位

| 方案 | 说明 | 决策 |
|------|------|------|
| A. 废弃BrowserWing | 完全依赖原生工具链 | ❌ 跨Tab/网络监控能力暂时无法替代 |
| B. 保留但降级 | 原生为默认，BrowserWing为高级场景 | ✅ 采用 |
| C. 深度融合 | 将BrowserWing API封装为interact的backend | ❌ 投入大，收益不明确 |

### 6.2 Workflow DSL 演进

| 版本 | 特性 | 时间 |
|------|------|------|
| v0.1 | 顺序执行，5种基本步骤 | 第一阶段 |
| v0.2 | 增加条件分支（if）、循环（foreach）、变量插值 | 第二阶段 |
| v0.3 | 增加子workflow调用、异常处理（try/catch）、并发（parallel） | 第三阶段 |

### 6.3 技术选型

| 模块 | 选型 | 理由 |
|------|------|------|
| 状态机 | 自研轻量状态机 | xstate功能过剩，自研更贴合MV3生命周期 |
| 定时触发 | `chrome.alarms` | MV3原生，无需额外权限 |
| 数据存储 | Dexie (IndexedDB) | 已有依赖，支持结构化数据 |
| Planner LLM | 复用用户当前模型配置 | 不强制特定模型，降低门槛 |

---

## 七、成功指标（OKR）

### 7.1 第一阶段（第1-2月）
- **O**：基础体验稳定，录制即保存可用
- **KR1**：三个体验Bug用户满意度≥4/5
- **KR2**：录制→保存→运行端到端成功率≥90%
- **KR3**：CWS评分从当前提升至≥4.0

### 7.2 第二阶段（第2-4月）
- **O**：RPA内核成型，一句话自动化可用
- **KR1**：AI Planner生成workflow用户采纳率≥60%
- **KR2**：定时任务7天无故障运行率≥95%
- **KR3**：WAU增长+100%

### 7.3 第三阶段（第4-6月）
- **O**：生态闭环，数据抓取→导出全链路打通
- **KR1**：社区workflow≥100个
- **KR2**：数据导出功能周使用≥500次
- **KR3**：Chrome Web Store评分≥4.5

---

## 八、立即执行清单（本周）

| 序号 | 任务 | 优先级 | 状态 | 验收标准 |
|------|------|--------|------|----------|
| 1 | 会话返回Bug修复 | P0 | ✅ 已完成 | `SettingsLayout.tsx` + `App.tsx` 双路恢复 |
| 2 | 自动滚动Bug修复 | P0 | ✅ 已完成 | `messageCount`监听 + `maxLines`30 |
| 3 | 文件上传Bug修复（含Windows accept过滤器） | P0 | ✅ 已完成 | `ACCEPT_EXTENSIONS`动态生成，22个可靠扩展名 |
| 4 | 扩展构建验证 | P0 | ✅ 已完成 | `pnpm build` 通过，`.output/chrome-mv3`生成 |
| 5 | 创建`feat/workflow-engine`分支 | P1 | 🔄 待开始 | 分支创建，CI通过 |
| 6 | 设计Workflow DSL v0.1 JSON Schema | P1 | 🔄 待开始 | Schema定义，团队评审通过 |
| 7 | 统一自动化交互范式文档 | P1 | 🔄 待开始 | 确定interact优先、BrowserWing保留场景 |

---

*本计划基于`TRANSFORMATION_ROADMAP.md`和`COMPETITIVE_LANDSCAPE_RESEARCH.md`制定，聚焦调整后的核心目标，每两周review一次进度。*
