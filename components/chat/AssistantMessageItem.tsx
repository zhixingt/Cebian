import { memo } from 'react';
import {
  AgentMessage,
  AgentTextBlock,
  ThinkingBlock,
} from '@/components/chat/Message';
import { ToolCard } from '@/components/chat/ToolCard';
import { ToolCardWithUI } from '@/components/chat/ToolCardWithUI';
import { isMcpAppResult } from '@/lib/tools/mcp-tool';
import type { AssistantMessage, ToolResultMessage, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getToolLabel } from '@/lib/tools/tool-labels';
import { uiToolRegistry } from '@/lib/tools/ui-registry';
import type { TurnMeta } from '@/lib/message-helpers';
import type { PendingToolInfo } from '@/hooks/useBackgroundAgent';
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
  onDelete?: () => void;
  toolResultIndex: Map<string, ToolResultMessage>;
  pendingTools: Map<string, PendingToolInfo>;
  resolveTool: (toolName: string, response: unknown) => void;
}

export const AssistantMessageItem = memo(function AssistantMessageItem({
  idx,
  msg,
  isLast,
  isAgentRunning,
  effectiveRunning,
  showHeader,
  meta,
  copyText,
  canRetry,
  onRetry,
  onDelete,
  toolResultIndex,
  pendingTools,
  resolveTool,
}: AssistantMessageItemProps) {
  const thinkingBlocks = msg.content.filter(
    (b): b is ThinkingContent => b.type === 'thinking' && !!b.thinking?.trim(),
  );
  const text = msg.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolCalls = msg.content.filter((b): b is ToolCall => b.type === 'toolCall');

  const isStreaming = isLast && effectiveRunning;
  const isError = msg.stopReason === 'error';
  // Aborted: either user clicked stop while streaming (pi-agent-core
  // appends the marker naturally inside `handleRunFailure`), or
  // user clicked stop while retry was rebuilding (the background's
  // `handleRebuildAbort` appends the same shape manually). One
  // rendering rule covers both paths.
  const isAborted = msg.stopReason === 'aborted';

  return (
    <AgentMessage
      isStreaming={isStreaming}
      showHeader={showHeader}
      meta={meta}
      copyText={copyText}
      onRetry={onRetry}
      onDelete={onDelete}
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
      {/* Generic tool rendering */}
      {toolCalls.map((tc) => {
        const uiInfo = uiToolRegistry.get(tc.name);

        // Interactive tool — render via UI registry
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

        // Non-interactive tool — render as ToolCard
        const toolResult = toolResultIndex.get(tc.id);

        // MCP App branch: if the tool result carries a UI
        // resource reference (set by `createMCPAgentTool`
        // when the original tool declared `_meta.ui.resourceUri`),
        // swap to ToolCardWithUI for inline iframe render.
        // While the result is still in-flight, fall through
        // to ToolCard so the spinner shows — switching only
        // once we have something to feed the iframe.
        //
        // Use a structural guard rather than a cast: `details`
        // is `any` (per `ToolResultMessage<TDetails = any>`),
        // so a truthy check would let a corrupted IDB row or
        // an off-spec server's bogus payload reach the iframe
        // and produce a vague fetch failure downstream.
        if (toolResult?.details && isMcpAppResult(toolResult.details)) {
          // Synthesise the SDK's `CallToolResult` wire shape
          // from the existing message fields — we deliberately
          // don't persist a second copy on `details.mcpApp`,
          // see JSDoc on `MCPAppDetails` for the storage
          // motivation.
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
              // Real MCP tool name (e.g. `create_diagram`), not
              // the agent-runtime slug `mcp__drawio__create_diagram`.
              // The slug is sanitized for provider name limits;
              // the View receives this via `ui/notifications/tool-*`
              // and SEP-1865 expects the real name so apps that
              // dispatch on `tool` recognise it.
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
