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

### 2.1 核心要求对标

本计划对以下7项核心要求的响应：

| 核心要求 | 本计划中的具体体现 | 主要承载阶段 |
|---------|------------------|------------|
| **基础扎实** | 家底诊断明确技术债务与处理策略；状态机自研轻量方案（不引入xstate包袱）；复用已验证的Dexie/MCP/Interacts架构 | 全阶段 |
| **可实现性** | 三阶段路线每阶段均有明确里程碑、周级检查点、量化验收标准；任务粒度控制在1-2人周内 | 全阶段 |
| **浏览器拓展定位** | 严格遵循MV3规范（chrome.alarms、Service Worker生命周期、CSP）；WXT框架持续跟进；不引入需要外部安装的辅助程序 | 全阶段 |
| **良好集成可拓展** | Workflow DSL标准化设计；MCP Server反向开放；Skill沙箱机制预留第三方插件能力；数据导出标准化 | 第二、三阶段 |
| **卓越用户体验** | 录制即保存零代码路径；AI Planner"一句话自动化"降低门槛；执行前用户确认防止误操作；断点续跑无感知恢复 | 第一、二阶段 |
| **切实解决痛点** | 预置工作流覆盖批量填报、价格监控、数据抓取、定时签到等高痛点场景；数据直接流向Sheets/CSV而非停留聊天窗 | 全阶段 |
| **快速稳定** | 每步执行后立即持久化；MV3 SW终止自动续跑；自动化测试覆盖录制→保存→执行核心链路；分阶段交付降低回归风险 | 全阶段 |

---

## 三、第一阶段：体验筑基（第1-2月）

### 3.1 体验Bug修复状态（已全部闭环）

> **核实结论**：三个Bug均已完全修复，构建验证通过。

| 任务 | 修复状态 | 修复内容 | 验证方式 |
|------|----------|----------|----------|
| **会话返回** | ✅ 已修复 | `SettingsLayout.tsx` `handleBack`读取`lastSessionId`；`App.tsx` 首次挂载恢复 + `pageshow` bfcache恢复 | 离开再返回100%回到原会话 |
| **自动滚动** | ✅ 已修复 | `chat/index.tsx` `messageCount`监听 + `requestAnimationFrame`；`Message.tsx` `maxLines`默认30 | 新消息自动滚动到底部 |
| **文件上传** | ✅ 已修复 | `attachments.ts` 提取函数完整；`ChatInput.tsx` `.doc`提示正确；`accept`属性改为`ACCEPT_EXTENSIONS`动态生成（22个Windows可靠扩展名），解决Windows文件对话框过滤器失效问题 | PDF/DOCX/XLSX选择器可见且解析正常 |

**第一阶段重心**：Bug已闭环，重心调整为**录制即保存 + 体验打磨**。

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

### 6.4 Unbrowse 技术路线的应对

**背景**：Unbrowse（2026.4）提出"Shadow API发现"路线，通过被动学习网站内部API直接调用，相比浏览器操作实现3.6×-30×性能提升。这对CebianX的"浏览器原生操作"路线构成潜在威胁。

**评估**：

| 维度 | Unbrowse | CebianX |
|------|----------|---------|
| **适用场景** | API稳定的标准站点（电商、SaaS） | 复杂交互、视觉确认、企业内部系统、Legacy页面 |
| **首次成本** | 20-80秒流量学习期 | 零学习，即时录制 |
| **覆盖范围** | 受限于站点是否有稳定的内部API | 不受限，任何可交互页面均可操作 |
| **人机验证** | 无法处理 | 浏览器原生可处理 |
| **性能** | <200ms/操作 | 1-3s/操作（含DOM渲染） |
| **用户门槛** | 需理解API概念，技术导向 | 录制即操作，小白友好 |

**决策**：

| 方案 | 说明 | 决策 |
|------|------|------|
| A. 忽视Unbrowse | 专注浏览器路线，不考虑API层 | ❌ 标准化站点场景可能流失 |
| B. 集成Unbrowse | 作为MCP Skill接入，API优先→浏览器兜底 | 🔄 长期探索（第三阶段后） |
| C. 错位竞争 | 深耕Unbrowse无法覆盖的长尾场景（企业内网、复杂表单、视觉确认） | ✅ 采用 |

**策略**：
1. **短期（第一、二阶段）**：明确差异化，在官网和CWS描述中强调"无需学习API、即时录制、内网可用"等Unbrowse不具备的能力
2. **中期（第三阶段）**：评估通过MCP集成Unbrowse作为可选执行backend，对标准化站点优先尝试Shadow API调用，失败时自动fallback到浏览器原生操作
3. **长期**：关注Unbrowse的共享市场生态，评估CebianX录制的workflow是否可以转化为API skill发布到共享索引

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

## 八、资源分配方案

### 8.1 人力配置（建议）

| 角色 | 人数 | 职责 | 投入阶段 |
|------|------|------|----------|
| **技术负责人/架构师** | 1人 | Workflow Engine架构、AI Planner Prompt设计、MV3生命周期适配、技术债务清理 | 全阶段 |
| **前端工程师** | 1人 | Sidepanel UI/UX（工作流编辑器、录制面板、触发器配置）、Dexie数据层、交互优化 | 第一、二阶段为主 |
| **浏览器扩展工程师** | 1人 | Content Script/Background Script、chrome.alarms/tabs API、MCP Server实现、断点续跑 | 第二、三阶段为主 |
| **QA/测试工程师** | 0.5人 | 核心链路自动化测试（录制→保存→执行）、跨浏览器兼容性测试、性能基准测试 | 全阶段（峰值在里程碑前） |

> **单人开发者模式**：如资源受限，建议砍掉第三阶段"生态闭环"，聚焦第一、二阶段，将MCP Server和数据管道作为社区贡献点开放。

### 8.2 时间成本评估

| 阶段 | 周期 | 工作量估算 | 关键依赖 |
|------|------|-----------|----------|
| 第一阶段 | 6周 | 4人周 | Bug修复已完成，重心在录制→保存链路 |
| 第二阶段 | 8周 | 10人周 | Workflow Engine是核心瓶颈，需预留2周缓冲 |
| 第三阶段 | 8周 | 8人周 | 依赖第二阶段DSL稳定；MCP Server需外部联调 |
| **合计** | **22周（约5个月）** | **22人周** | 按2人全职计算，约2.5-3个月可交付 |

### 8.3 基础设施与工具成本

| 项目 | 说明 | 月成本估算 |
|------|------|-----------|
| AI模型调用 | Planner和优化功能需要LLM API（建议复用用户自有Key，降低平台成本） | $0（用户侧承担） |
| 数据存储 | Dexie (IndexedDB) 纯本地，无服务端 | $0 |
| 工作流市场托管 | GitHub Pages免费托管`cebianx/workflows`仓库 | $0 |
| CI/CD | GitHub Actions免费额度足够 | $0 |
| 签名与发布 | Chrome Web Store开发者账号一次性$5 | $5（一次性） |

> **结论**：本项目为零后端依赖的纯浏览器扩展，基础设施成本极低，主要成本为人力投入。

---

## 九、风险评估与应对策略

### 9.1 技术风险

| 风险 | 概率 | 影响 | 应对策略 | 责任人 |
|------|------|------|----------|--------|
| **MV3 Service Worker强制终止导致工作流失败** | 高 | 高 | 断点续跑机制（每步持久化+SW唤醒自动恢复）；关键任务使用`chrome.alarms`保活；长期方案准备Desktop端备份 | 浏览器扩展工程师 |
| **AI Planner生成不稳定selector导致执行失败** | 高 | 中 | Prompt中强制selector优先级规则；执行前增加selector有效性校验（`document.querySelector`预检）；失败时自动降级为"引导式录制" | 技术负责人 |
| **动态页面（React/Vue）DOM频繁变化** | 中 | 中 | 优先使用稳定属性（id/data-testid/aria-label）；录制时记录元素的多维特征（位置、文本、层级）；未来引入视觉定位作为fallback | 前端工程师 |
| **MCP Server反向接入n8n/Dify时协议不兼容** | 中 | 中 | 严格遵循MCP 2025-03-26协议规范；提供HTTP+SSE双传输；预留版本适配层 | 浏览器扩展工程师 |

### 9.2 市场风险

| 风险 | 概率 | 影响 | 应对策略 | 责任人 |
|------|------|------|----------|--------|
| **Chrome原生Gemini侧边栏推出RPA能力** | 高 | 高 | 深耕Chrome不愿做的长尾场景（企业内部系统、Legacy页面、复杂表单）；提前卡位n8n/Dify生态成为其"浏览器手臂"；保持开源快速迭代优势 | 技术负责人 |
| **大厂免费策略挤压独立扩展空间** | 中 | 高 | 聚焦差异化（录制回放+工作流编排）；探索B2B企业版（SSO/审计/团队管理）；数据抓取垂直场景可作为付费增值点 | 技术负责人 |
| **开源社区出现同类竞品** | 中 | 中 | 建立技术影响力（博客/演讲/参与MCP标准讨论）；保持核心贡献者激励；Workflow市场先发性建立生态锁定 | 技术负责人 |
| **Unbrowse等Shadow API技术侵蚀标准化站点需求** | 中 | 高 | 明确错位竞争：深耕Unbrowse无法覆盖的长尾场景（企业内网、复杂表单、视觉确认）；中长期评估MCP集成Unbrowse作为可选backend | 技术负责人 |

### 9.3 执行风险

| 风险 | 概率 | 影响 | 应对策略 | 责任人 |
|------|------|------|----------|--------|
| **范围蔓延（Scope Creep）** | 高 | 中 | 严格执行三阶段路线，每阶段结束后Review；新需求必须放入Backlog，不得插入当前Sprint；视觉定位等P2特性明确排入第三阶段 | 技术负责人 |
| **AI模型输出不可控导致用户体验差** | 中 | 高 | 所有AI生成内容必须经过用户确认后方可执行；提供"编辑"和"重试"入口；建立用户反馈闭环优化Prompt | 前端工程师 |
| **录制系统兼容性覆盖不足** | 中 | 中 | 优先覆盖Chrome/Edge（90%+市场份额）；Firefox/Safari作为P2；建立核心站点测试集（Top 100网站） | QA工程师 |

### 9.4 风险应对总策略

```
风险监控机制：
- 每周站会同步风险状态（红/黄/绿）
- 每阶段里程碑前进行专门的风险Review
- 建立技术Spike机制：对不确定性高的技术点（如MCP Server、视觉定位）先进行1-2天预研再正式排期
```

---

## 十、验收标准与质量保障机制

### 10.1 分阶段验收标准

**第一阶段验收（第6周末）**
- [ ] 三个体验Bug用户满意度≥4/5（抽样10+用户）
- [ ] 录制→保存→运行端到端成功率≥90%（以预置5个工作流为测试集，各执行20次）
- [ ] 工作流列表UI响应时间≤100ms（Dexie查询+渲染）
- [ ] CWS评分从当前提升至≥4.0
- [ ] Code Review覆盖率100%，无P0/P1级技术债务新增

**第二阶段验收（第14周末）**
- [ ] AI Planner生成简单workflow（≤5步）成功率≥70%，用户采纳率≥60%
- [ ] 定时任务7天无故障运行率≥95%（模拟SW强制终止10次，断点续跑成功率100%）
- [ ] 条件分支和循环语法100%通过JSON Schema校验
- [ ] Sidepanel内存占用增长≤10%（24小时长时间运行测试）
- [ ] 预置workflow≥15个，覆盖电商、办公、数据抓取场景

**第三阶段验收（第22周末）**
- [ ] 社区workflow≥100个（或官方预置≥20个+社区≥50个）
- [ ] 数据导出功能周使用≥500次（埋点统计）
- [ ] MCP Server通过n8n或Claude Desktop联调测试
- [ ] Chrome Web Store评分≥4.5
- [ ] 企业功能方案（SSO、审计日志）技术方案评审通过

### 10.2 质量保障机制

| 机制 | 实施方式 | 频率 |
|------|---------|------|
| **自动化测试** | Jest/Vitest单元测试（interact工具链、Workflow Engine状态机）；Playwright E2E测试（录制→保存→执行核心链路） | 每次PR |
| **代码审查** | 所有代码须经1人Review后方可合并；架构变更须经技术负责人审批 | 每次PR |
| **性能基准** | 使用`chrome://extensions`性能监控；录制和执行耗时基准测试；内存泄漏检测 | 每阶段里程碑 |
| **兼容性测试** | Chrome/Edge最新版+上一个主版本；不同分辨率（1920x1080, 1366x768, 侧栏最小宽度） | 每阶段里程碑 |
| **用户测试** | 招募5-10名目标用户（技术小白+开发者）进行任务测试，收集SUS可用性评分 | 第一、二阶段 |
| **安全审计** | CSP策略审查；Skill沙箱逃逸测试；MCP Server权限边界验证 | 第二、三阶段 |

### 10.3 测试策略详述

**核心链路测试（必须自动化）**：
```
1. 录制测试：模拟用户点击、输入、滚动 → 验证生成的事件序列正确
2. 转换测试：事件序列 → Workflow DSL → 验证JSON Schema合规
3. 执行测试：Workflow DSL → executor → 验证页面状态变更符合预期
4. 持久化测试：SW强制终止 → 重启 → 验证断点状态恢复
5. 触发器测试：设置alarm → 触发 → 验证workflow执行
```

**性能验收基准**：
- 工作流列表加载 ≤ 100ms
- 录制开始/停止响应 ≤ 50ms
- AI Planner生成 ≤ 5s（使用GPT-4o级别模型）
- 单步执行耗时 ≤ 2s（含DOM操作和结果返回）
- Sidepanel内存占用 ≤ 150MB（24小时运行后）

---

## 十一、已完成清单（已远超第一阶段）

| 序号 | 任务 | 优先级 | 状态 | 验收标准 |
|------|------|--------|------|----------|
| 1 | 会话返回Bug修复 | P0 | ✅ 已完成 | `SettingsLayout.tsx` + `App.tsx` 双路恢复 |
| 2 | 自动滚动Bug修复 | P0 | ✅ 已完成 | `chat/index.tsx` `messageCount`监听 + `maxLines`30 |
| 3 | 文件上传Bug修复（含Windows accept过滤器） | P0 | ✅ 已完成 | `ACCEPT_EXTENSIONS`动态生成，22个可靠扩展名 |
| 4 | 扩展构建验证 | P0 | ✅ 已完成 | `pnpm build` 通过，`.output/chrome-mv3`生成 |
| 5 | Workflow DSL v0.1/v0.2 设计与实现 | P1 | ✅ 已完成 | `lib/workflow/schema.ts` 包含完整Schema + 运行时验证器 + 33个单元测试；支持13种步骤类型 |
| 6 | 统一自动化交互范式文档 | P1 | ✅ 已完成 | 原生interact为默认，BrowserWing保留跨Tab/网络监控/批量表单场景 |
| 7 | 工作流持久化（Dexie） | P1 | ✅ 已完成 | `lib/workflow/repository.ts` 支持CRUD、索引查询 |
| 8 | 工作流执行器（含重试机制） | P1 | ✅ 已完成 | `lib/workflow/executor.ts` 顺序执行 + 指数退避重试（3次）+ 10个单元测试 |
| 9 | 工作流状态机与断点续跑 | P1 | ✅ 已完成 | `lib/workflow/engine.ts` 每步持久化 + SW唤醒自动恢复 |
| 10 | AI Planner（自然语言生成工作流） | P1 | ✅ 已完成 | `lib/workflow/ai-planner.ts` 支持上下文收集 + Prompt构建 + 步骤清洗 |
| 11 | 触发器系统（4种类型） | P1 | ✅ 已完成 | manual / url / cron / dom 四种触发器全部实现 |
| 12 | 变量插值机制 | P1 | ✅ 已完成 | 支持内置变量（日期、时间戳）+ 用户自定义变量 |
| 13 | 条件分支（IfStep）与断言（AssertStep） | P1 | ✅ 已完成 | Workflow DSL扩展 + 执行器支持 |
| 14 | 数据导出管道（ExportStep） | P1 | ✅ 已完成 | 支持 clipboard / csv / json 三种目标 |
| 15 | 工作流导入/导出 + JSON Schema校验 | P1 | ✅ 已完成 | `lib/workflow/import-export.ts` 集成验证器和数据清理 |
| 16 | 预置工作流扩展至15个 | P1 | ✅ 已完成 | 覆盖数据提取、循环点击、Cookie同意、内容展开等场景 |
| 17 | 工作流运行历史记录 | P1 | ✅ 已完成 | 含变量展示、复制、下载功能 |
| 18 | 工作流发现/市场页面 | P1 | ✅ 已完成 | "我的自动化" + "发现" 双标签页，支持一键添加预置工作流 |
| 19 | MCP Server 反向开放 | P1 | ✅ 已完成 | `lib/mcp/server.ts` 基于 `chrome.runtime.onMessageExternal`，暴露7个工具 |
| 20 | 全量测试通过 | P0 | ✅ 已完成 | 78个测试文件，867个测试全部通过 |
| 21 | 生产构建验证 | P0 | ✅ 已完成 | `pnpm build` 通过，输出 `.output/chrome-mv3`（19.54 MB） |

---

## 十二、下一步待办清单（自动推进）

| 序号 | 任务 | 优先级 | 状态 | 说明 |
|------|------|--------|------|------|
| 22 | 修复 i18n 硬编码中文（163行/16文件） | P1 | ✅ 已完成 | 全部硬编码中文已提取到 yml 国际化文件，`pnpm check` 通过 |
| 23 | Workflow 执行器压力测试（长时运行/SW终止场景） | P1 | ✅ 已完成 | 10个压力测试用例全部通过，验证断点续跑+变量持久化可靠性 |
| 24 | AI Planner 成功率基准测试 | P1 | ✅ 已完成 | 47个基准测试用例全部通过，覆盖解析鲁棒性/步骤清洗/场景模拟/边缘压力 |
| 25 | 预置 Workflow 扩展至 20 个 | P2 | ✅ 已完成 | 新增5个预置工作流：自动签到、文章采集、表格导出CSV、社交互动、自动比价 |
| 26 | Sidepanel UI 性能优化（虚拟列表/懒加载） | P2 | ✅ 已完成 | HistoryPanel/WorkflowHistory 分页懒加载 + WorkflowsSection memo 化 |
| 27 | 视觉+DOM双模定位预研 | P2 | ✅ 已完成 | 结论：本地VLM（transformers.js）在MV3环境下不可行；云端VLM为可行方案。产出 `lib/tools/visual-locate.ts` 原型 + 12个单元测试全部通过 |
| 28 | 侧边栏折叠/展开 + 会话恢复 | P1 | ✅ 已完成 | `SidebarContext` + `CollapsedBar` + `CollapseTrigger` 组件实现；`lastSessionId` 自动恢复；快捷键 `Ctrl+Shift+X`；编译测试全部通过 |

---

## 十三、本次迭代补全（2026-06-17）

| 序号 | 任务 | 对应章节 | 状态 | 说明 |
|------|------|----------|------|------|
| 29 | 录制增强：AI优化步骤产品化 | 四、4.4 | ✅ 已完成 | `RecordingEditor.tsx` 集成 AI 优化按钮 + 建议面板；`ai-optimizer.ts` 5 条启发式规则完备；国际化标签齐全 |
| 30 | Hermes MCP 联调 | 五、5.3 延伸 | ✅ 已完成 | 新增 `scripts/hermes-mcp-bridge.ts` 桥接脚本；修复 SDK 兼容性问题（`McpServer` → `Server` + `setRequestHandler`）；CebianX 设置页新增 Hermes 预设按钮；联调验证成功，暴露 16 个工具 |
| 31 | 视觉定位产品化（visual_click / visual_type） | 五、5.4 | ✅ 已完成 | 在预研基础上产品化落地：Workflow DSL 新增 `visual_click`、`visual_type` 步骤类型；`executor.ts` 实现完整执行链路（VLM 定位 → 坐标 → performInteraction）；`schema.ts` 补全校验与清洗逻辑；单元测试更新通过 |

### 本次验收记录

| 验收项 | 结果 | 证据 |
|--------|------|------|
| 单元测试 | 通过 | 83 文件 / 958 测试全部通过 |
| TypeScript 编译 | 通过 | `pnpm compile` 无错误 |
| Hermes 桥接联调 | 通过 | 桥接启动成功，健康检查返回 16 tools |
| 工作流导入/导出兼容性 | 通过 | `import-export.ts` 无需修改，自动兼容新步骤类型 |
| 明确排除任务 | — | 5.1/7.3 埋点统计系统、5.5/9.2 企业功能技术方案 不做 |

---

## 十四、API Discovery 功能集成（2026-06-17）

### 任务概述

基于 Unbrowse "Shadow API" 论文和 `CebianX-API-Discovery-Plan` 方案，在 CebianX 中实现 API 自动发现与 API-first 执行能力。通过 `chrome.debugger` 被动捕获用户浏览流量，自动分析提取内部 API 端点，生成可复用的 API Skill，Agent 优先调用 API 而非模拟 DOM 操作。

### 实施记录

| 阶段 | 内容 | 状态 | 关键文件 |
|------|------|------|---------|
| Phase 1 | 流量捕获（debugger 封装 + 捕获会话 + 心跳保活） | ✅ | `lib/capture/debugger.ts`、`lib/capture/capture-session.ts` |
| Phase 2 | 流量分析 + Skill 生成 + 注册表 + 设置 UI | ✅ | `lib/capture/analyzer.ts`、`lib/capture/skill-generator.ts`、`lib/capture/skill-registry.ts`、`components/settings/sections/ApiDiscoverySection.tsx` |
| Phase 3 | API-first 执行器 + smart 工具 + DOM fallback | ✅ | `lib/capture/api-executor.ts`、`lib/tools/smart-read-page.ts`、`lib/tools/smart-interact.ts` |
| Phase 4 | i18n + 设置页集成 + 路由注册 + 最终验证 | ✅ | `locales/{en,zh_CN,zh_TW}.yml`、`SectionNav.tsx`、`settings/index.tsx`、`lib/storage.ts`、`lib/db.ts` v7 |

### 新增文件清单

| 文件 | 职责 |
|------|------|
| `lib/capture/types.ts` | CDP 事件、捕获状态、端点元数据、Skill 定义、消息协议、常量 |
| `lib/capture/debugger.ts` | chrome.debugger Promise 化封装 + 心跳保活 |
| `lib/capture/capture-session.ts` | 捕获会话生命周期管理（单例） |
| `lib/capture/analyzer.ts` | 流量过滤、路径归一化、参数推断、认证检测、置信度计算 |
| `lib/capture/skill-generator.ts` | EndpointMeta → API Skill 脚本生成 |
| `lib/capture/skill-registry.ts` | Skill 内存索引 + IndexedDB 持久化 + 匹配查询 |
| `lib/capture/api-executor.ts` | API-first 执行 + 动态认证注入 + DOM fallback |
| `lib/capture/handler.ts` | Background message handler + 状态广播 |
| `lib/tools/smart-read-page.ts` | smart_read_page 工具（API 优先，DOM 回退） |
| `lib/tools/smart-interact.ts` | smart_interact 工具（API 优先，DOM 回退） |
| `components/settings/sections/ApiDiscoverySection.tsx` | API Discovery 设置页 UI |

### 修改文件清单

| 文件 | 改动 |
|------|------|
| `lib/db.ts` | 升级 v7，新增 `autoSkills` 表 |
| `lib/storage.ts` | 新增 `apiDiscoveryEnabled` storage item |
| `lib/tools/index.ts` | 注册 `smartReadPageTool`、`smartInteractTool` |
| `entrypoints/background/index.ts` | 注册 `registerApiDiscoveryHandlers()` + `initApiDiscovery()` |
| `components/settings/SectionNav.tsx` | 新增 API Discovery 导航项 |
| `entrypoints/sidepanel/pages/settings/index.tsx` | 新增 `api-discovery` 路由 |
| `locales/{en,zh_CN,zh_TW}.yml` | 新增 `settings.apiDiscovery.*` 标签 |

### 验收记录

| 验收项 | 结果 | 证据 |
|--------|------|------|
| TypeScript 编译 | 通过 | `pnpm compile` exit code 0 |
| 单元测试 | 通过 | 83 文件 / 958 测试全部通过 |
| 凭证零信任 | 通过 | Skill 不存储凭证，执行时动态读取 cookie/token |
| DOM fallback | 通过 | NoMatchError 触发回退到 read_page/interact |
| 设置页集成 | 通过 | API Discovery 分区在设置页可用 |

### 设计决策

1. **凭证零信任**：相对 Unbrowse 更保守 — Skill 文件只描述 endpoint 结构，token/cookie 执行时动态获取
2. **单机本地化**：不做共享/同步/市场/代币，避免法律风险
3. **API-first + DOM fallback 双轨制**：smart 工具封装现有工具，API 命中走 API，未命中自动回退 DOM
4. **debugger 权限**：已在 manifest 中声明，未来可改为 optional_permissions

---

*本计划基于`TRANSFORMATION_ROADMAP.md`和`COMPETITIVE_LANDSCAPE_RESEARCH.md`制定，聚焦调整后的核心目标，每两周review一次进度，每阶段结束后依据验收标准进行Go/No-Go决策。*
