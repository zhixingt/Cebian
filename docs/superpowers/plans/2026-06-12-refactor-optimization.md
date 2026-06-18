# CebianX 重构优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按优先级逐步重构 5 个核心问题：消息列表 memoization、MCP 断线重连、ErrorBoundary i18n、模型解析缓存、无障碍补全

**Architecture:** 小步重构，每步可验证，保持对外接口不变，先有测试再重构。每个 Task 产出独立可验证的变更。

**Tech Stack:** React 19, TypeScript, Vitest, WXT, Chrome MV3 Extension APIs

---

## Task 1: 消息列表提取 memo 组件 + 预计算索引

**Files:**
- Create: `components/chat/AssistantMessageItem.tsx`
- Create: `components/chat/ToolResultBubble.tsx`
- Modify: `entrypoints/sidepanel/pages/chat/index.tsx:190-418`
- Modify: `lib/message-helpers.ts` (新增 `buildToolResultIndex` 和 `buildTurnMetaMap`)
- Test: `__tests__/components/chat/AssistantMessageItem.test.tsx`

### Step 1: 在 message-helpers.ts 中新增预计算函数

在 `lib/message-helpers.ts` 末尾添加：

```typescript
/** Build a Map from toolCallId → ToolResultMessage for O(1) lookup */
export function buildToolResultIndex(messages: Message[]): Map<string, ToolResultMessage> {
  const map = new Map<string, ToolResultMessage>();
  for (const m of messages) {
    if ('role' in m && m.role === 'toolResult') {
      const tr = m as ToolResultMessage;
      if (tr.toolCallId) map.set(tr.toolCallId, tr);
    }
  }
  return map;
}

export interface TurnMeta {
  modelLabel?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Pre-compute turn-level token aggregation for each assistant message.
 *  Walks backward from each assistant msg to the nearest user msg, summing usage. */
export function buildTurnMetaMap(messages: Message[]): Map<number, TurnMeta> {
  const map = new Map<number, TurnMeta>();
  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    if (!('role' in msg) || msg.role !== 'assistant') continue;
    const am = msg as AssistantMessage;
    // Only compute for turn-closing messages (stopReason !== 'toolUse')
    if (am.stopReason === 'toolUse') continue;
    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
    for (let i = idx; i >= 0; i--) {
      const m = messages[i];
      if (!('role' in m)) continue;
      if (m.role === 'user') break;
      if (m.role === 'assistant') {
        const a = m as AssistantMessage;
        inputTokens += a.usage?.input ?? 0;
        outputTokens += a.usage?.output ?? 0;
        cacheReadTokens += a.usage?.cacheRead ?? 0;
        cacheWriteTokens += a.usage?.cacheWrite ?? 0;
      }
    }
    map.set(idx, {
      modelLabel: am.model,
      inputTokens: inputTokens || undefined,
      outputTokens: outputTokens || undefined,
      cacheReadTokens: cacheReadTokens || undefined,
      cacheWriteTokens: cacheWriteTokens || undefined,
    });
  }
  return map;
}
```

- [ ] **Step 1: 添加预计算函数到 message-helpers.ts**

### Step 2: 创建 ToolResultBubble 组件

创建 `components/chat/ToolResultBubble.tsx`：

```tsx
import { memo } from 'react';
import { UserMessageBubble } from './Message';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { uiToolRegistry } from '@/lib/tools/ui-registry';

export const ToolResultBubble = memo(function ToolResultBubble({
  msg,
  idx,
}: {
  msg: ToolResultMessage;
  idx: number;
}) {
  const info = uiToolRegistry.get(msg.toolName);
  if (info?.renderResultAsUserBubble && !msg.details?.cancelled) {
    const text = msg.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');
    if (text) {
      return <UserMessageBubble key={`tr-${idx}`}>{text}</UserMessageBubble>;
    }
  }
  return null;
});
```

- [ ] **Step 2: 创建 ToolResultBubble.tsx**

### Step 3: 创建 AssistantMessageItem 组件

创建 `components/chat/AssistantMessageItem.tsx`，将 chat/index.tsx 第 199-394 行的 assistant 消息渲染逻辑提取为 memo 组件。组件接收预计算好的 props（不再在渲染时计算）：

```tsx
import { memo, type ReactNode } from 'react';
import { AgentMessage, AgentTextBlock, ThinkingBlock } from './Message';
import { ToolCard } from './ToolCard';
import { ToolCardWithUI } from './ToolCardWithUI';
import { isMcpAppResult } from '@/lib/tools/mcp-tool';
import { getToolLabel } from '@/lib/tools/tool-labels';
import { uiToolRegistry } from '@/lib/tools/ui-registry';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TurnMeta } from '@/lib/message-helpers';
import { t } from '@/lib/i18n';

interface AssistantMessageItemProps {
  idx: number;
  msg: AssistantMessage;
  isLast: boolean;
  isAgentRunning: boolean;
  effectiveRunning: boolean;
  showHeader: boolean;
  meta: TurnMeta | undefined;
  copyText: string | undefined;
  canRetry: boolean;
  onRetry: (() => void) | undefined;
  toolResultIndex: Map<string, ToolResultMessage>;
  pendingTools: Map<string, { toolCallId: string }>;
  resolveTool: (toolName: string, response: unknown) => void;
}

export const AssistantMessageItem = memo(function AssistantMessageItem({
  idx, msg, isLast, isAgentRunning, effectiveRunning,
  showHeader, meta, copyText, canRetry, onRetry,
  toolResultIndex, pendingTools, resolveTool,
}: AssistantMessageItemProps) {
  const isStreaming = isLast && effectiveRunning;
  const isError = msg.stopReason === 'error';
  const isAborted = msg.stopReason === 'aborted';
  const thinkingBlocks = msg.content.filter(
    (b): b is Extract<typeof b, { type: 'thinking' }> => b.type === 'thinking' && !!b.thinking?.trim(),
  );
  const text = msg.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('');
  const toolCalls = msg.content.filter(
    (b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall',
  );

  return (
    <AgentMessage
      key={`asst-${idx}`}
      isStreaming={isStreaming}
      showHeader={showHeader}
      meta={meta}
      copyText={copyText}
      onRetry={onRetry}
    >
      {thinkingBlocks.map((block, i) => (
        <ThinkingBlock key={`t-${idx}-${i}`} content={block.thinking} isLive={isStreaming} />
      ))}
      {text && <AgentTextBlock content={text} />}
      {isError && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mt-2 whitespace-pre-wrap break-all">
          {msg.errorMessage ?? t('chat.session.modelError')}
        </div>
      )}
      {isAborted && (
        <div className="text-xs text-muted-foreground/80 italic mt-2">
          {t('chat.session.cancelled')}
        </div>
      )}
      {toolCalls.map((tc) => {
        const uiInfo = uiToolRegistry.get(tc.name);
        if (uiInfo) {
          const pending = pendingTools.get(tc.name);
          const isPending = !!pending && pending.toolCallId === tc.id;
          const toolResult = toolResultIndex.get(tc.id);
          return (
            <uiInfo.Component
              key={`tool-${tc.id}`}
              toolCallId={tc.id}
              args={tc.arguments}
              isPending={isPending}
              toolResult={toolResult}
              onResolve={isPending ? (response: any) => resolveTool(tc.name, response) : undefined}
            />
          );
        }
        const toolResult = toolResultIndex.get(tc.id);
        if (toolResult?.details && isMcpAppResult(toolResult.details)) {
          const synthesizedToolResult: CallToolResult = {
            content: toolResult.content as CallToolResult['content'],
            ...(toolResult.details.structured !== undefined
              ? { structuredContent: toolResult.details.structured as Record<string, unknown> }
              : {}),
            isError: toolResult.isError,
          };
          return (
            <ToolCardWithUI
              key={`tool-${tc.id}`}
              label={getToolLabel(tc.name, tc.arguments)}
              toolName={toolResult.details.tool}
              serverId={toolResult.details.server.id}
              mcpApp={toolResult.details.mcpApp}
              toolResult={synthesizedToolResult}
            />
          );
        }
        const status = toolResult
          ? (toolResult.isError ? 'error' : 'done')
          : 'running';
        const label = getToolLabel(tc.name, tc.arguments);
        const argsStr = JSON.stringify(tc.arguments, null, 2);
        const resultText = toolResult
          ? toolResult.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('\n') || undefined
          : undefined;
        const resultImages = toolResult
          ? toolResult.content
              .filter((b): b is { type: 'image'; data: string; mimeType: string } => b.type === 'image')
          : undefined;
        return (
          <ToolCard
            key={`tool-${tc.id}`}
            label={label}
            status={status}
            args={argsStr}
            result={resultText}
            images={resultImages}
          />
        );
      })}
    </AgentMessage>
  );
});
```

- [ ] **Step 3: 创建 AssistantMessageItem.tsx**

### Step 4: 重构 chat/index.tsx 使用新组件

将 `messages.map()` 回调从 228 行缩减为约 30 行。在 map 外预计算 `toolResultIndex` 和 `turnMetaMap`：

```tsx
// 在 messages.map() 之前添加预计算
const toolResultIndex = useMemo(() => buildToolResultIndex(messages), [messages]);
const turnMetaMap = useMemo(() => buildTurnMetaMap(messages), [messages]);

// 简化后的 map 回调
{!sessionLoading && messages.map((msg, idx) => {
  if (!('role' in msg)) return null;

  if (msg.role === 'user') {
    return <UserMessageBubble key={`user-${idx}`} msg={msg} />;
  }

  if (msg.role === 'assistant') {
    const assistantMsg = msg as AssistantMessage;
    const isLast = idx === messages.length - 1;
    const turnEnded = !isLast || !isAgentRunning;
    const isTurnClosing = turnEnded && assistantMsg.stopReason !== 'toolUse';
    const plainText = assistantMsg.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text).join('').trim();
    const copyText = isTurnClosing && plainText.length > 0 ? plainText : undefined;
    const canRetry = isLast && isTurnClosing && !isAgentRunning;

    // showHeader: true only for first assistant in a consecutive group
    let showHeader = true;
    for (let i = idx - 1; i >= 0; i--) {
      const prev = messages[i];
      if (!('role' in prev)) continue;
      if (prev.role === 'toolResult') {
        const tr = prev as ToolResultMessage;
        const info = uiToolRegistry.get(tr.toolName);
        if (info?.renderResultAsUserBubble && !tr.details?.cancelled) break;
        continue;
      }
      if (prev.role === 'assistant') showHeader = false;
      break;
    }

    return (
      <AssistantMessageItem
        key={`asst-${idx}`}
        idx={idx}
        msg={assistantMsg}
        isLast={isLast}
        isAgentRunning={isAgentRunning}
        effectiveRunning={effectiveRunning}
        showHeader={showHeader}
        meta={turnMetaMap.get(idx)}
        copyText={copyText}
        canRetry={canRetry}
        onRetry={canRetry ? retry : undefined}
        toolResultIndex={toolResultIndex}
        pendingTools={pendingTools}
        resolveTool={resolveTool}
      />
    );
  }

  if (msg.role === 'toolResult') {
    return <ToolResultBubble key={`tr-${idx}`} msg={msg as ToolResultMessage} idx={idx} />;
  }

  return null;
})}
```

- [ ] **Step 4: 重构 chat/index.tsx**

### Step 5: 构建验证

Run: `cd D:\Project\CebianX\cebian-web-provider && npx wxt build`
Expected: 构建成功，无错误

- [ ] **Step 5: 构建验证**

### Step 6: 运行测试

Run: `cd D:\Project\CebianX\cebian-web-provider && npx vitest run`
Expected: 385/385 通过

- [ ] **Step 6: 运行测试**

---

## Task 2: MCPClient 断线检测 + 指数退避重连

**Files:**
- Modify: `lib/mcp/client.ts`
- Modify: `lib/mcp/manager.ts`
- Test: `__tests__/lib/mcp/client-reconnect.test.ts`

### Step 1: MCPClient 添加 onDisconnect 回调 + transport 事件监听

在 `lib/mcp/client.ts` 的 `MCPClient` 类中：

1. 构造函数新增 `onDisconnect?: () => void` 可选回调参数
2. 在 `connect()` 成功后，监听 SDK Client 的 `onclose` 事件：

```typescript
export class MCPClient {
  private readonly config: MCPServerConfig;
  private readonly onDisconnect?: () => void;
  private client?: Client;
  private transport?: Transport;
  private connected = false;

  constructor(config: MCPServerConfig, opts?: { onDisconnect?: () => void }) {
    this.config = config;
    this.onDisconnect = opts?.onDisconnect;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    // ... existing transport/client creation ...
    try {
      await this.client.connect(this.transport);
      this.connected = true;
      // 监听断开事件
      this.client.onclose = () => {
        if (this.connected) {
          this.connected = false;
          this.client = undefined;
          this.transport = undefined;
          this.onDisconnect?.();
        }
      };
    } catch (err) {
      // ... existing error handling ...
    }
  }
}
```

3. 在 `close()` 中设置标志防止 `onclose` 触发重连：

```typescript
async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false; // 先设 false，防止 onclose 回调
    try {
      await this.client?.close();
    } finally {
      this.client = undefined;
      this.transport = undefined;
    }
  }
```

- [ ] **Step 1: MCPClient 添加断线检测**

### Step 2: MCPManager 添加指数退避重连

在 `lib/mcp/manager.ts` 的 `ServerEntry` 接口中添加重连状态：

```typescript
interface ServerEntry {
  config: MCPServerConfig;
  client: MCPClient;
  throttle: ServerThrottle;
  toolCache?: { tools: MCPTool[]; fetchedAt: number };
  connecting?: Promise<void>;
  refreshingTools?: Promise<MCPTool[]>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  reconnectAttempts: number;
}
```

在 `upsert()` 中创建 `MCPClient` 时传入 `onDisconnect` 回调：

```typescript
private upsert(config: MCPServerConfig): void {
  const existing = this.entries.get(config.id);
  if (!existing) {
    this.entries.set(config.id, {
      config,
      client: new MCPClient(config, {
        onDisconnect: () => this.handleDisconnect(config.id),
      }),
      throttle: new ServerThrottle(),
      reconnectAttempts: 0,
    });
    return;
  }
  // ... existing material change logic ...
  if (material || enabledChanged) {
    this.clearReconnect(existing);
    void this.closeEntry(existing);
    existing.client = new MCPClient(config, {
      onDisconnect: () => this.handleDisconnect(config.id),
    });
    // ... rest unchanged ...
  }
  existing.config = config;
}
```

添加重连方法：

```typescript
private static readonly MAX_RECONNECT_ATTEMPTS = 5;
private static readonly RECONNECT_BASE_MS = 1000;
private static readonly RECONNECT_MAX_MS = 30000;

private handleDisconnect(serverId: string): void {
  const entry = this.entries.get(serverId);
  if (!entry) return;
  if (!entry.config.enabled) return;
  entry.toolCache = undefined;
  entry.connecting = undefined;
  this.notify();
  this.scheduleReconnect(entry);
}

private scheduleReconnect(entry: ServerEntry): void {
  this.clearReconnect(entry);
  if (entry.reconnectAttempts >= MCPManager.MAX_RECONNECT_ATTEMPTS) return;
  const delay = Math.min(
    MCPManager.RECONNECT_BASE_MS * Math.pow(2, entry.reconnectAttempts),
    MCPManager.RECONNECT_MAX_MS,
  );
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = undefined;
    entry.reconnectAttempts += 1;
    void this.ensureConnected(entry).then(() => {
      entry.reconnectAttempts = 0;
      this.notify();
    }).catch(() => {
      this.scheduleReconnect(entry);
    });
  }, delay);
}

private clearReconnect(entry: ServerEntry): void {
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = undefined;
  }
}
```

在 `closeEntry` 和 `reconcile` 中调用 `clearReconnect`。

- [ ] **Step 2: MCPManager 添加指数退避重连**

### Step 3: 构建验证

Run: `cd D:\Project\CebianX\cebian-web-provider && npx wxt build`
Expected: 构建成功

- [ ] **Step 3: 构建验证**

### Step 4: 运行测试

Run: `cd D:\Project\CebianX\cebian-web-provider && npx vitest run`
Expected: 全部通过

- [ ] **Step 4: 运行测试**

---

## Task 3: ErrorBoundary i18n + 重试限制

**Files:**
- Modify: `entrypoints/sidepanel/ErrorBoundary.tsx`
- Modify: `locales/zh_CN.yml` (通过 PowerShell 追加)
- Modify: `locales/en.yml` (通过 PowerShell 追加)
- Modify: `locales/zh_TW.yml` (通过 PowerShell 追加)

### Step 1: 追加 i18n 键值到三个 yml 文件

使用 PowerShell 命令追加（保持 UTF-8 BOM 编码）：

**zh_CN.yml:**
```yaml
errorBoundary:
  title: "界面异常"
  unknownError: "未知错误"
  retry: "重试"
  reload: "重新加载"
  retryLimit: "已达到重试上限，请重新加载"
```

**en.yml:**
```yaml
errorBoundary:
  title: "UI Error"
  unknownError: "Unknown error"
  retry: "Retry"
  reload: "Reload"
  retryLimit: "Retry limit reached, please reload"
```

**zh_TW.yml:**
```yaml
errorBoundary:
  title: "介面異常"
  unknownError: "未知錯誤"
  retry: "重試"
  reload: "重新載入"
  retryLimit: "已達到重試上限，請重新載入"
```

- [ ] **Step 1: 追加 i18n 键值**

### Step 2: 重构 ErrorBoundary 使用 chrome.i18n + 重试限制

```tsx
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const MAX_RETRIES = 3;

function i18n(key: string): string {
  return chrome.i18n.getMessage(key) || key;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error, prevState: State): Partial<State> {
    return { hasError: true, error, retryCount: prevState.retryCount + 1 };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught rendering error:', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  handleFullReload = () => {
    location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const err = this.state.error;
      const errorType = err?.constructor?.name ?? 'Error';
      const message = err?.message ?? i18n('errorBoundary_unknownError');
      const stackLines = err?.stack?.split('\n').slice(1, 4).join('\n') ?? '';
      const canRetry = this.state.retryCount < MAX_RETRIES;

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', padding: 20,
          fontFamily: 'system-ui', overflow: 'auto',
        }}>
          <div style={{ maxWidth: 520, textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#dc2626' }}>
              {i18n('errorBoundary_title')}
            </h2>
            <p style={{ margin: '0 0 8px', color: '#666', lineHeight: 1.6 }}>
              <code style={{
                background: '#fef2f2', padding: '2px 6px',
                borderRadius: 3, fontSize: 13, color: '#dc2626',
              }}>
                {errorType}: {message}
              </code>
            </p>
            {stackLines && (
              <pre style={{
                margin: '0 0 12px', padding: 8, background: '#f8f9fa',
                borderRadius: 6, fontSize: 11, textAlign: 'left',
                overflowX: 'auto', maxHeight: 120, color: '#555',
              }}>
                {stackLines}
              </pre>
            )}
            {!canRetry && (
              <p style={{ margin: '0 0 8px', color: '#888', fontSize: 13 }}>
                {i18n('errorBoundary_retryLimit')}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {canRetry && (
                <button
                  onClick={this.handleReload}
                  style={{
                    padding: '8px 20px', background: '#2563eb', color: '#fff',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
                  }}
                >
                  {i18n('errorBoundary_retry')}
                </button>
              )}
              <button
                onClick={this.handleFullReload}
                style={{
                  padding: '8px 16px', background: '#f3f4f6', color: '#666',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}
              >
                {i18n('errorBoundary_reload')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 2: 重构 ErrorBoundary**

### Step 3: 构建验证

Run: `cd D:\Project\CebianX\cebian-web-provider && npx wxt build`
Expected: 构建成功

- [ ] **Step 3: 构建验证**

### Step 4: 运行测试

Run: `cd D:\Project\CebianX\cebian-web-provider && npx vitest run`
Expected: 全部通过

- [ ] **Step 4: 运行测试**

---

## Task 4: agent-manager 模型解析缓存

**Files:**
- Modify: `entrypoints/background/agent-manager.ts`

### Step 1: 添加内存缓存 + storage 变更监听

在 `AgentManager` 类中添加：

```typescript
private cachedModelObj: {
  activeModel: ActiveModel | null;
  credentials: ProviderCredentials;
  customProviders: CustomProviderConfig[];
  result: { model: Model<Api>; api: Api } | null;
} | null = null;

private clearModelCache(): void {
  this.cachedModelObj = null;
}
```

在 `resolveModelObj()` 开头添加缓存检查：

```typescript
private async resolveModelObj(sessionId: string): Promise<{ model: Model<Api>; api: Api }> {
  const activeModelVal = await activeModelStorage.getValue();
  const credentialsVal = await providerCredentialsStorage.getValue();
  const customProvidersVal = await customProvidersStorage.getValue();

  // 缓存命中
  if (this.cachedModelObj
    && this.cachedModelObj.activeModel === activeModelVal
    && this.cachedModelObj.credentials === credentialsVal
    && this.cachedModelObj.customProviders === customProvidersVal) {
    return this.cachedModelObj.result!;
  }

  // ... existing resolution logic, store result in cache ...
  const result = { model, api };
  this.cachedModelObj = {
    activeModel: activeModelVal,
    credentials: credentialsVal,
    customProviders: customProvidersVal,
    result,
  };
  return result;
}
```

在 `background/index.ts` 中监听 storage 变更清除缓存：

```typescript
// 在 background 初始化时添加
activeModel.watch(() => agentManager.clearModelCache());
providerCredentials.watch(() => agentManager.clearModelCache());
customProviders.watch(() => agentManager.clearModelCache());
```

- [ ] **Step 1: 添加模型解析缓存**

### Step 2: 构建验证

Run: `cd D:\Project\CebianX\cebian-web-provider && npx wxt build`
Expected: 构建成功

- [ ] **Step 2: 构建验证**

### Step 3: 运行测试

Run: `cd D:\Project\CebianX\cebian-web-provider && npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 运行测试**

---

## Task 5: 无障碍补全

**Files:**
- Modify: `components/chat/ChatInput.tsx` (添加 aria-label)
- Modify: `components/chat/QuickActionsBar.tsx` (添加 role="toolbar")
- Modify: `components/chat/RecordButton.tsx` (添加 aria-label)

### Step 1: ChatInput 工具栏按钮添加 aria-label

在 `ChatInput.tsx` 中，将所有工具栏按钮的 `title` 属性同步添加为 `aria-label`：

- 元素选取按钮：添加 `aria-label={title}`
- 截图按钮：添加 `aria-label={title}`
- 文件上传按钮：添加 `aria-label={title}`
- 移动端模式按钮：添加 `aria-label={title}`
- 附件删除按钮：添加 `aria-label={t('chat.attachments.remove')}`

- [ ] **Step 1: ChatInput aria-label 补全**

### Step 2: QuickActionsBar 添加 role="toolbar"

在 `QuickActionsBar.tsx` 的容器 div 上添加 `role="toolbar" aria-label={t('chat.quickActions.label')}`

- [ ] **Step 2: QuickActionsBar role 补全**

### Step 3: RecordButton 添加 aria-label

在 `RecordButton.tsx` 中将 `title` 同步添加为 `aria-label`

- [ ] **Step 3: RecordButton aria-label 补全**

### Step 4: 构建验证

Run: `cd D:\Project\CebianX\cebian-web-provider && npx wxt build`
Expected: 构建成功

- [ ] **Step 4: 构建验证**

### Step 5: 运行测试

Run: `cd D:\Project\CebianX\cebian-web-provider && npx vitest run`
Expected: 全部通过

- [ ] **Step 5: 运行测试**
