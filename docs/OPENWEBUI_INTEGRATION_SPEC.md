# CebianX 与 OpenWebUI API 集成方案

## 一、项目背景与目标

**"Hermes OpenWebUI" 即标准 OpenWebUI 项目**（GitHub: `open-webui/open-webui`，原 Ollama WebUI），使用 Nous Research Hermes 系列模型时的部署方案。它是一个自托管的 AI 对话界面，后端基于 Python/FastAPI，对外暴露 OpenAI 兼容的 REST API。

**集成目标**：将 CebianX 接入用户自托管的 OpenWebUI 后端，使其可作为 CebianX 的模型 Provider 之一，从而：
1. 利用 OpenWebUI 的本地/私有模型部署能力（Ollama、vLLM 等）
2. 复用 OpenWebUI 的知识库（RAG）、文件上传、管道（Pipelines）等后端能力
3. 为注重数据隐私的用户提供"完全本地运行"的选项

---

## 二、API 路由设计

### 2.1 设计原则

| 原则 | 说明 |
|------|------|
| **OpenAI 兼容** | 复用 OpenWebUI 的 `/api/chat/completions` 和 `/api/models` 端点，最小化适配成本 |
| **配置驱动** | 用户只需填写 OpenWebUI 的 Base URL 和 API Key，CebianX 自动发现和适配 |
| **能力协商** | 运行时检测 OpenWebUI 后端支持的功能（streaming、RAG、vision），动态调整行为 |
| **降级优雅** | 当 OpenWebUI 某功能不可用时，CebianX 自动降级（如关闭 RAG、切换为非流式） |

### 2.2 端点规划

| 端点 | 方法 | 用途 | CebianX 调用时机 |
|------|------|------|-----------------|
| `/api/models` | GET | 获取可用模型列表 | Provider 初始化时 |
| `/api/chat/completions` | POST | 聊天补全（流式/非流式） | 用户发送消息时 |
| `/api/files/` | POST | 上传文件用于 RAG | 用户上传附件时 |
| `/api/version` | GET | 健康检查和版本确认 | Provider 连接测试时 |

### 2.3 CebianX 内部新增模块

```
lib/ai-config/
├── providers/
│   └── openwebui-provider.ts      # OpenWebUI Provider 实现
├── types.ts                       # 扩展 Provider 类型定义
└── custom-models.ts               # 已存在，复用其模型管理机制
```

---

## 三、数据交互格式

### 3.1 请求格式（CebianX → OpenWebUI）

OpenWebUI 的 `/api/chat/completions` 与 OpenAI 兼容：

```typescript
interface OpenWebUIChatRequest {
  model: string;                    // 如 "hermes3:latest"、"qwen2.5:14b"
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{       // 支持多模态（图片+文本）
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string };
    }>;
  }>;
  stream?: boolean;                 // true = SSE 流式，false = 完整响应
  temperature?: number;
  max_tokens?: number;
  // OpenWebUI 特有扩展
  files?: Array<{                   // RAG 知识库文件引用
    type: 'collection' | 'file';
    id: string;
  }>;
}
```

### 3.2 响应格式（OpenWebUI → CebianX）

**流式响应（SSE）**：

```
data: {"id":"...","choices":[{"delta":{"content":"你好"},"index":0}]}
data: {"id":"...","choices":[{"delta":{"content":"！"},"index":0}]}
data: [DONE]
```

**非流式响应**：

```json
{
  "id": "chatcmpl-xxx",
  "choices": [{
    "message": { "role": "assistant", "content": "你好！" },
    "index": 0,
    "finish_reason": "stop"
  }]
}
```

### 3.3 CebianX 内部数据转换

CebianX 使用 `@earendil-works/pi-ai` 的内部消息格式，需做以下转换：

| pi-ai 格式 | OpenWebUI 格式 | 转换逻辑 |
|-----------|---------------|---------|
| `TextMessage` | `messages[].content` (string) | 直接传递 |
| `ImageMessage` | `messages[].content` (array) | base64 图片 → `{type: 'image_url', image_url: {url: 'data:image/png;base64,...'}}` |
| `ToolResultMessage` | `messages[].content` (string) | tool 结果序列化为文本 |
| `ThinkingMessage` | 不支持 | 过滤或作为 `<thinking>` 标签插入 |

---

## 四、认证机制与安全策略

### 4.1 认证方式

OpenWebUI 支持多种认证方式，CebianX 优先支持以下两种：

| 方式 | 配置项 | 说明 |
|------|--------|------|
| **API Key** | `apiKey` | 用户在 OpenWebUI 设置中生成的个人 API Key |
| **JWT Token** | `jwtToken` | 用户登录后获取的 JWT（适用于无 API Key 的自托管实例） |

请求头统一携带：
```
Authorization: Bearer <apiKey_or_jwtToken>
Content-Type: application/json
```

### 4.2 安全策略

| 策略 | 实现方式 |
|------|---------|
| **HTTPS 强制** | 仅允许 `https://` 协议的 OpenWebUI URL，拒绝明文 HTTP |
| **URL 校验** | 用户输入的 URL 必须通过 `URL` 构造函数校验，且为合法 origin |
| **Token 存储** | 使用 `wxt/storage` 的 `storage:local` 加密存储，与现有 API Key 存储机制一致 |
| **CORS 代理** | 由于浏览器扩展的 CSP 限制，通过 Background Service Worker 的 `fetch` 发起请求（天然绕过 CORS） |
| **超时控制** | 请求超时 60 秒，流式响应每 30 秒需收到心跳（否则判定为断连） |

### 4.3 隐私合规

- 所有数据流向用户自托管的 OpenWebUI 实例，**不经过 CebianX 的服务器**
- 在 UI 中明确标注"数据发送至您配置的 OpenWebUI 地址"
- 支持本地模型（Ollama）时，数据完全不出内网

---

## 五、错误处理与异常恢复

### 5.1 错误分类与处理

| 错误码 | 场景 | CebianX 处理策略 |
|--------|------|-----------------|
| **401 Unauthorized** | API Key 无效或过期 | Toast 提示"API Key 无效，请检查配置"，引导用户到设置页面 |
| **404 Not Found** | OpenWebUI 地址错误或实例未运行 | Toast 提示"无法连接到 OpenWebUI，请检查地址和实例状态" |
| **429 Too Many Requests** | 请求频率过高 | 指数退避重试（1s → 2s → 4s → 8s，最多 3 次） |
| **500/502/503** | OpenWebUI 后端错误 | 立即失败，提示"OpenWebUI 服务暂时不可用" |
| **Network Error** | 网络中断或 CORS 问题 | 重试 1 次，仍失败则提示检查网络 |
| **Stream Parse Error** | SSE 数据解析失败 | 尝试切换到非流式模式重新请求 |
| **Model Not Found** | 请求的模型不存在 | 自动调用 `/api/models` 刷新模型列表，提示用户选择可用模型 |

### 5.2 异常恢复机制

```typescript
// 伪代码：请求异常恢复策略
async function chatWithOpenWebUI(request: ChatRequest): Promise<Stream> {
  try {
    return await fetchStream(request);
  } catch (err) {
    if (err.status === 429) {
      await exponentialBackoff();
      return await fetchStream(request);  // 重试一次
    }
    if (err.status === 404) {
      // 尝试自动检测 OpenWebUI 是否运行
      const health = await checkHealth();
      if (!health.ok) {
        throw new UserFacingError('OpenWebUI 实例未运行，请检查');
      }
    }
    if (err.type === 'stream-parse-error') {
      // 降级为非流式
      return await fetchNonStream(request);
    }
    throw err;
  }
}
```

---

## 六、性能优化与扩展性

### 6.1 性能优化

| 优化点 | 方案 | 预期收益 |
|--------|------|---------|
| **模型列表缓存** | `/api/models` 结果缓存 5 分钟，减少重复请求 | 模型切换时响应更快 |
| **连接预热** | Provider 激活时预先发送 `/api/version` 探测 | 首次对话无延迟 |
| **流式响应缓冲** | SSE 数据块累积到 50ms 或 256 字节再渲染 | 减少 React re-render 次数，提升流畅度 |
| **图片压缩** | 上传图片前压缩至最大 2MB | 减少传输时间和内存占用 |
| **长连接复用** | SW 层面复用 fetch 连接（HTTP/1.1 keep-alive） | 减少 TCP 握手开销 |

### 6.2 扩展性考虑

| 维度 | 方案 |
|------|------|
| **多实例支持** | 用户可配置多个 OpenWebUI 地址（如本地 Ollama + 远程 vLLM），按模型名自动路由 |
| **功能探测** | 启动时探测后端能力（是否支持 vision、RAG、tools），动态调整可用功能 |
| **管道（Pipelines）** | 支持 OpenWebUI 的 Pipelines 功能，用户可选择不同的处理管道（如翻译管道、代码审查管道） |
| **知识库集成** | 用户可选择 OpenWebUI 中已上传的知识库集合，CebianX 在请求中自动附加 `files` 参数 |

---

## 七、实现步骤与技术选型

### 7.1 实现步骤（预计 2-3 周）

**第 1 周：基础接入**
1. 创建 `lib/ai-config/providers/openwebui-provider.ts`
2. 实现模型列表获取（`/api/models`）
3. 实现聊天补全（`/api/chat/completions`，支持流式和非流式）
4. 实现连接测试（`/api/version`）
5. 在 Settings UI 中添加 OpenWebUI 配置面板

**第 2 周：功能完善**
1. 实现附件上传（通过 OpenWebUI `/api/files/` 或直接作为 base64 传入 messages）
2. 实现错误处理和降级策略
3. 实现模型列表缓存和连接预热
4. 添加 i18n 国际化文本

**第 3 周：测试与优化**
1. 编写单元测试（mock OpenWebUI API）
2. 编写 E2E 测试（连接真实 OpenWebUI 实例）
3. 性能测试（大文件上传、长流式响应）
4. 文档编写

### 7.2 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| HTTP 客户端 | 原生 `fetch`（通过 SW） | Chrome MV3 标准 API，无需额外依赖 |
| SSE 解析 | 自建 EventSource 解析器 | OpenWebUI SSE 格式标准，无需复杂库 |
| 图片处理 | 现有 `lib/attachments.ts` | 复用前端提取和压缩逻辑 |
| 配置存储 | `wxt/storage` | 与现有 Provider 配置机制一致 |
| 类型校验 | TypeScript 接口 + 运行时类型守卫 | 轻量，无需引入 Zod 等额外库 |

### 7.3 关键代码结构

```typescript
// lib/ai-config/providers/openwebui-provider.ts

export interface OpenWebUIConfig {
  baseUrl: string;           // 如 "https://openwebui.home.local"
  apiKey?: string;           // 可选，若 OpenWebUI 未开启认证可为空
  model?: string;            // 默认模型，如 "hermes3:latest"
}

export class OpenWebUIProvider implements ModelProvider {
  constructor(private config: OpenWebUIConfig) {}

  async listModels(): Promise<Model[]> {
    const res = await bgFetch(`${this.config.baseUrl}/api/models`, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` }
    });
    const data = await res.json();
    return data.data.map((m: any) => ({
      id: m.id,
      name: m.name,
      provider: 'openwebui',
      capabilities: { chat: true, vision: m.meta?.capabilities?.vision ?? false }
    }));
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const response = await bgFetch(`${this.config.baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        messages: this.toOpenWebUIMessages(request.messages),
        stream: true
      })
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          const chunk = JSON.parse(data);
          yield { content: chunk.choices[0]?.delta?.content ?? '' };
        }
      }
    }
  }

  private toOpenWebUIMessages(messages: Message[]): any[] {
    return messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : this.serializeContent(m.content)
    }));
  }
}
```

---

## 八、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| OpenWebUI API 变更 | 中 | 高 | 封装抽象层，API 变更时只需修改适配器 |
| 用户自托管实例不可达 | 高 | 中 | 提供连接测试和详细错误提示 |
| 本地模型性能不足 | 中 | 中 | 在 UI 中提示"本地模型响应可能较慢" |
| RAG/Files 功能复杂度高 | 中 | 中 | 第一阶段仅支持基础聊天，RAG 作为二期功能 |
| 与现有 Provider 体系冲突 | 低 | 中 | 严格遵循现有 `ModelProvider` 接口，复用 `custom-models.ts` |

---

## 九、与现有架构的集成点

| 集成点 | 文件 | 修改内容 |
|--------|------|---------|
| Provider 注册 | `lib/ai-config/custom-models.ts` | 添加 `openwebui` provider 类型 |
| Provider 工厂 | `lib/ai-config/web-provider-models.ts` 或新建 | 根据配置创建 `OpenWebUIProvider` 实例 |
| Settings UI | `components/settings/` | 添加 OpenWebUI 配置表单 |
| 模型选择器 | `components/chat/ModelSelector.tsx` | 显示 OpenWebUI 模型列表 |
| i18n | `locales/*.yml` | 添加 OpenWebUI 相关翻译 |

---

*本方案基于 OpenWebUI v0.6.x API 设计，具体实现时需根据实际版本调整端点和参数。*
