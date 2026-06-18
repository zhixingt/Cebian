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
