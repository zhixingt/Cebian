# CebianX 转型为"浏览器原生 AI 工作流引擎"战略规划

## 一、产品定位与核心价值主张

### 1.1 新定位

> **浏览器原生 AI 工作流引擎（Browser-Native AI Workflow Engine）**
>
> 核心主张：**"让浏览器为你工作，而不只是回答你的问题。"**

### 1.2 价值主张

| 传统 AI 聊天工具 | CebianX 工作流引擎 |
|----------------|-------------------|
| "这个页面讲了什么？" | "帮我把这个页面的所有商品信息录入到表格" |
| "请总结这段文字" | "每天早上 9 点自动登录系统并导出昨日报表" |
| "点击这个按钮" | "录制一次操作，之后自动重复执行 100 次" |
| 单次问答，人工决策 | 目标驱动，自动规划，闭环执行 |

### 1.3 目标用户画像

| 用户类型 | 核心痛点 | 使用场景 |
|---------|---------|---------|
| **运营人员** | 重复性浏览器操作（数据录入、报表导出、批量审核） | 录制一次，自动执行百次 |
| **数据分析师** | 需要从多个网页采集数据并汇总 | 跨页面数据抓取 → 自动整理 |
| **电商卖家** | 多平台商品管理、价格监控 | 定时检查竞品价格，自动预警 |
| **开发者/测试** | 需要自动化测试 Web 应用 | 录制用户路径 → 生成自动化测试脚本 |
| **普通办公族** | 日常遇到复杂的网页填报、申请流程 | "帮我报名这个活动"一句话搞定 |

---

## 二、技术架构调整方案

### 2.1 当前架构 vs 目标架构

```
当前架构：AI 聊天工具 + 丰富工具箱
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Sidepanel  │────▶│ Agent Core  │────▶│  Tool Box   │
│  (React UI) │     │(pi-agent)   │     │(interact/   │
└─────────────┘     └─────────────┘     │ screenshot/  │
                                        │ read_page)   │
                                        └─────────────┘

目标架构：浏览器原生 AI 工作流引擎
┌─────────────┐     ┌─────────────────────────────┐     ┌─────────────┐
│  Sidepanel  │────▶│      Workflow Engine        │────▶│  Tool Box   │
│  (React UI) │     │  ┌─────────┐  ┌─────────┐  │     │(interact/   │
└─────────────┘     │  │Trigger  │─▶│Planner  │  │     │ screenshot/  │
                    │  └─────────┘  └────┬────┘  │     │ read_page/   │
                    │  ┌─────────┐  ┌────▼────┐  │     │ extract/     │
                    │  │Scheduler│  │Executor │  │     │ skill/       │
                    │  └─────────┘  └────┬────┘  │     │ mcp/         │
                    │  ┌─────────┐  ┌────▼────┐  │     └─────────────┘
                    │  │ State   │  │Monitor  │  │
                    │  │ Machine │  │& Alert  │  │
                    │  └─────────┘  └─────────┘  │
                    └─────────────────────────────┘
```

### 2.2 核心新增模块

| 模块 | 职责 | 技术方案 |
|------|------|---------|
| **Workflow Engine** | 工作流的状态机、调度、执行 | 基于 `xstate` 或自研状态机，运行在 Background SW |
| **Trigger System** | 触发器管理（定时、URL变化、DOM事件） | `chrome.alarms` + `chrome.tabs.onUpdated` + MutationObserver |
| **Planner** | AI 自动规划工作流步骤 | LLM 调用，输入目标+页面上下文，输出 workflow JSON |
| **Executor** | 工作流步骤执行 | 复用现有 interact + skill + mcp 工具链 |
| **State Machine** | 工作流状态持久化 | Dexie 存储 workflow 实例状态，支持断点续跑 |
| **Monitor & Alert** | 执行监控和异常通知 | 执行日志 + `chrome.notifications` + 可选邮件/Webhook |

### 2.3 架构调整实施路径

**Phase 1：工作流内核（1-2 个月）**

```
新增文件：
lib/workflow/
├── engine.ts              # WorkflowEngine 类
├── state-machine.ts       # 工作流状态管理
├── planner.ts             # AI 规划器（自然语言 → workflow）
├── executor.ts            # 步骤执行器
├── triggers/
│   ├── cron-trigger.ts    # 定时触发
│   ├── url-trigger.ts     # URL 变化触发
│   └── dom-trigger.ts     # DOM 出现触发
├── types.ts               # Workflow DSL 类型定义
└── schema.ts              # Workflow JSON Schema
```

**Phase 2：录制 → 工作流（2-3 个月）**

```
改造文件：
lib/recorder/
├── session-to-workflow.ts   # 录制事件 → workflow JSON（替代 session-to-sequence）
└── ai-optimizer.ts          # LLM 分析并优化 workflow

components/recorder/
├── RecordingEditor.tsx      # 增加"AI 优化"和"转为工作流"按钮
└── WorkflowPreview.tsx      # 工作流可视化预览
```

**Phase 3：触发与调度（3-4 个月）**

```
新增功能：
- 定时任务：用户设置 Cron 表达式，SW 通过 chrome.alarms 唤醒执行
- URL 触发：用户访问特定 URL 时自动触发工作流
- DOM 触发：页面出现特定元素时触发（如"当页面出现'立即购买'按钮时自动点击"）
```

---

## 三、关键功能模块设计

### 3.1 模块优先级矩阵

| 模块 | 用户价值 | 技术难度 | 差异化强度 | 优先级 |
|------|---------|---------|-----------|--------|
| 智能工作流编排（一句话自动化） | 极高 | 中 | 极高 | **P0** |
| 录制 → 工作流 AI 增强 | 高 | 中 | 高 | **P0** |
| 定时/触发调度 | 高 | 中 | 中 | **P1** |
| 工作流市场（Skill 生态） | 高 | 低 | 高 | **P1** |
| 视觉+DOM 双模定位 | 中高 | 高 | 高 | **P1** |
| 异常自修复 | 中 | 高 | 中高 | **P2** |
| 数据管道（导出到 Sheets/Notion） | 中 | 中 | 中 | **P2** |
| 团队协作 | 中 | 中 | 低 | **P3** |

### 3.2 P0 模块详细设计：智能工作流编排

**用户交互流程**：

```
用户："帮我把这个页面的所有商品信息录入到表格"

AI Planner 思考：
1. 当前页面是商品列表页
2. 目标：提取商品信息并录入表格
3. 步骤规划：
   - step 1: inspect 页面，发现商品列表容器
   - step 2: extract 所有商品名称和价格
   - step 3: navigate 到 Google Sheets
   - step 4: fill 表单，录入数据
   - step 5: submit 保存

生成 Workflow JSON：
{
  "id": "wf-xxx",
  "name": "商品信息录入",
  "trigger": { "type": "manual" },
  "steps": [
    { "id": "s1", "action": "inspect", "selector": ".product-list" },
    { "id": "s2", "action": "extract", "selector": ".product-item", "fields": ["name", "price"] },
    { "id": "s3", "action": "navigate", "url": "https://sheets.new" },
    { "id": "s4", "action": "fillForm", "data": "{{steps.s2.result}}" },
    { "id": "s5", "action": "click", "selector": "[aria-label='保存']" }
  ]
}

用户确认 → Executor 执行 → Monitor 报告结果
```

**技术实现**：

```typescript
// lib/workflow/planner.ts
export class WorkflowPlanner {
  async plan(userGoal: string, pageContext: PageContext): Promise<Workflow> {
    const prompt = `
用户目标：${userGoal}
当前页面：${pageContext.title} (${pageContext.url})
页面结构：${pageContext.domSnapshot}

请将用户目标拆解为可执行的浏览器操作步骤，输出 JSON 格式的工作流。
可用操作：navigate | click | type | extract | fillForm | screenshot | wait
`;
    const response = await this.llm.chat(prompt);
    return this.parseWorkflow(response);
  }
}
```

### 3.3 P0 模块详细设计：录制 → 工作流 AI 增强

**用户交互流程**：

```
1. 用户点击"录制"按钮
2. 正常操作页面（如：登录 → 点击报表 → 选择日期 → 点击导出）
3. 点击"停止录制"
4. 系统显示 RecordingEditor，展示录制的步骤序列
5. 用户点击"AI 优化"按钮
6. AI 分析步骤：
   - "检测到登录步骤，建议提取用户名/密码为参数"
   - "检测到日期选择，建议替换为动态日期（今天）"
   - "建议在点击导出后添加 wait 步骤等待下载完成"
7. 用户点击"转为工作流"
8. 生成可复用的 Workflow，保存到 VFS
```

---

## 四、资源需求评估

### 4.1 人力资源

| 角色 | 人数 | 投入周期 | 职责 |
|------|------|---------|------|
| **全栈开发（核心）** | 1-2 人 | 6 个月 | Workflow Engine、Planner、Executor |
| **前端开发** | 1 人 | 4 个月 | Workflow UI、可视化编辑器、录制增强 |
| **测试工程师** | 0.5 人 | 持续 | 自动化测试、E2E 测试 |
| **产品经理** | 0.5 人 | 持续 | 需求梳理、用户反馈、竞品跟踪 |

### 4.2 技术资源

| 资源 | 需求 | 成本 |
|------|------|------|
| **LLM API** | Planner 和 AI 优化需要 LLM 调用 | 依赖用户自有 API Key / Web Provider（免费） |
| **测试服务器** | OpenWebUI / Ollama 实例用于集成测试 | 本地部署，零成本 |
| **CI/CD** | GitHub Actions 已配置 | 现有资源 |
| **Chrome Web Store 开发者账号** | 已拥有 | 现有资源 |

### 4.3 时间资源

| 里程碑 | 时间 | 交付物 |
|--------|------|--------|
| **M1：工作流内核 MVP** | 第 1-2 个月 | Workflow Engine 基础版 + 手动编辑 JSON |
| **M2：智能规划 + 录制增强** | 第 2-3 个月 | AI Planner + 录制 → 工作流转化 |
| **M3：触发调度 + 市场** | 第 3-4 个月 | 定时任务 + 工作流市场（导入/导出） |
| **M4：视觉双模 + 自修复** | 第 4-6 个月 | VLM 辅助定位 + 异常自修复 |
| **M5：企业功能** | 第 6-9 个月 | 团队协作 + 云端执行（可选） |

---

## 五、里程碑规划

### 5.1 3 个月目标（MVP）

**目标**：让用户可以用一句话触发 5-10 步的跨页面自动化流程。

**关键结果**：
- [ ] Workflow Engine 支持顺序执行、条件分支、循环
- [ ] AI Planner 能根据自然语言生成简单 workflow（如"帮我报名这个活动"）
- [ ] 录制系统支持"AI 优化步骤"和"转为工作流"
- [ ] 5 个官方预置 workflow（如"批量填报""数据抓取""价格监控"）
- [ ] WAU 增长 +50%

### 5.2 6 个月目标（产品化）

**目标**：建立"浏览器自动化"的初步产品认知。

**关键结果**：
- [ ] 工作流市场上线，用户可分享/下载 workflow
- [ ] 定时任务稳定运行（支持 10+ 个定时 workflow）
- [ ] 视觉+DOM 双模定位处理 80% 的动态页面场景
- [ ] Chrome Web Store 评分 4.5+
- [ ] WAU 增长 +200%

### 5.3 12 个月目标（生态化）

**目标**：成为浏览器自动化领域的标准工具。

**关键结果**：
- [ ] MCP Server 模式：外部工具（n8n、Claude Desktop）可调用 CebianX
- [ ] 100+ 社区 workflow
- [ ] 企业版（SSO、审计日志、私有化部署）上线
- [ ] 月收入达到可持续水平

---

## 六、风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| **开发周期超期** | 高 | 高 | M1-M2 聚焦最小可用，砍掉非核心功能；采用敏捷迭代 |
| **用户不接受新定位** | 中 | 高 | 保留原有聊天功能，工作流作为"高级功能"渐进式引入 |
| **竞品快速跟进** | 高 | 中 | 建立社区生态（工作流市场）和录制数据壁垒 |
| **浏览器厂商限制 MV3** | 中 | 高 | 同时维护 Firefox MV2 版本；关注 Manifest V3 演进 |
| **LLM 规划不可靠** | 中 | 中 | Planner 输出必须经用户确认；提供手动编辑能力 |
| **资金/人力不足** | 中 | 高 | 优先开源核心能力，通过社区贡献降低人力需求 |

---

## 七、立即执行清单（本周）

| 序号 | 任务 | 负责人 | 完成标准 |
|------|------|--------|---------|
| 1 | 修复基础体验 bug（会话返回、文件上传、自动滚动） | 开发 | 三个 bug 全部解决，用户验证通过 |
| 2 | 统一产品定位文案 | 产品 | 所有对外材料更新为"浏览器原生 AI 工作流引擎" |
| 3 | 设计 Workflow DSL v0.1 | 架构 | JSON Schema 定义，支持 5 种基本操作 |
| 4 | 创建 workflow 分支 | 开发 | `git checkout -b feat/workflow-engine` |
| 5 | 用户调研：收集 10 个真实自动化需求 | 产品 | 文档化用户痛点和使用场景 |

---

*本规划基于战略分析报告（STRATEGIC_ANALYSIS.md）和 SWOT 分析（SWOT_ANALYSIS.md）制定，需根据市场反馈每季度修订。*
