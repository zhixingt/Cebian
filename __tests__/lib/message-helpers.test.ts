import { describe, expect, it } from 'vitest';
import {
  getAssistantText,
  getThinkingBlocks,
  getToolCalls,
  findToolResult,
  extractUserText,
  extractUserAttachments,
  truncateForRetry,
  buildToolResultIndex,
  buildTurnMetaMap,
} from '@/lib/message-helpers';
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall, ToolResultMessage, Message, ImageContent } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

function makeText(text: string): TextContent {
  return { type: 'text', text };
}

function makeThinking(thinking: string): ThinkingContent {
  return { type: 'thinking', thinking, thinkingSignature: 'sig' };
}

function makeToolCall(id: string, name: string): ToolCall {
  return { type: 'toolCall', id, name, arguments: {} };
}

function makeAssistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  } as AssistantMessage;
}

describe('getAssistantText', () => {
  it('extracts text blocks', () => {
    const msg = makeAssistant({ content: [makeText('hello'), makeText(' world')] });
    expect(getAssistantText(msg)).toBe('hello world');
  });

  it('ignores non-text blocks', () => {
    const msg = makeAssistant({ content: [makeText('a'), makeThinking('t'), makeToolCall('1', 'x')] });
    expect(getAssistantText(msg)).toBe('a');
  });

  it('returns empty string when no text', () => {
    expect(getAssistantText(makeAssistant({ content: [makeThinking('t')] }))).toBe('');
  });
});

describe('getThinkingBlocks', () => {
  it('returns non-empty thinking blocks', () => {
    const msg = makeAssistant({ content: [makeThinking('  reasoning  ')] });
    expect(getThinkingBlocks(msg)).toHaveLength(1);
  });

  it('skips empty thinking blocks', () => {
    const msg = makeAssistant({ content: [makeThinking('   ')] });
    expect(getThinkingBlocks(msg)).toHaveLength(0);
  });

  it('ignores text blocks', () => {
    const msg = makeAssistant({ content: [makeText('hi')] });
    expect(getThinkingBlocks(msg)).toHaveLength(0);
  });
});

describe('getToolCalls', () => {
  it('extracts tool calls', () => {
    const msg = makeAssistant({ content: [makeToolCall('1', 'a'), makeToolCall('2', 'b')] });
    expect(getToolCalls(msg)).toHaveLength(2);
  });

  it('returns empty array when none', () => {
    expect(getToolCalls(makeAssistant({ content: [makeText('hi')] }))).toHaveLength(0);
  });
});

describe('findToolResult', () => {
  it('finds matching tool result', () => {
    const tr: ToolResultMessage = { role: 'toolResult', toolCallId: 'abc', toolName: 'x', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 1 };
    const result = findToolResult([tr] as AgentMessage[], 'abc');
    expect(result).toBe(tr);
  });

  it('returns undefined when not found', () => {
    expect(findToolResult([] as AgentMessage[], 'x')).toBeUndefined();
  });
});

describe('extractUserText', () => {
  it('extracts from string content', () => {
    const msg: Message = { role: 'user', content: 'hello', timestamp: 1 };
    expect(extractUserText(msg)).toBe('hello');
  });

  it('extracts from text blocks', () => {
    const msg: Message = { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 };
    expect(extractUserText(msg)).toBe('hi');
  });

  it('extracts from user-request tag', () => {
    const msg: Message = { role: 'user', content: '<user-request>\n  inner text  \n</user-request>', timestamp: 1 };
    expect(extractUserText(msg)).toBe('inner text');
  });

  it('returns empty for non-user', () => {
    expect(extractUserText({ role: 'assistant', content: 'hi', timestamp: 1 } as any)).toBe('');
  });

  it('handles empty content', () => {
    expect(extractUserText({ role: 'user', content: '', timestamp: 1 })).toBe('');
  });
});

describe('extractUserAttachments', () => {
  it('extracts images from content blocks', () => {
    const img: ImageContent = { type: 'image', data: 'base64', mimeType: 'image/png' };
    const msg: Message = { role: 'user', content: [img], timestamp: 1 };
    const att = extractUserAttachments(msg);
    expect(att.images).toHaveLength(1);
    expect(att.images[0].mimeType).toBe('image/png');
  });

  it('extracts elements from attachments block', () => {
    const msg: Message = { role: 'user', content: '<attachments>\n<selected-element selector="body"/>\n</attachments>', timestamp: 1 };
    const att = extractUserAttachments(msg);
    expect(att.elements).toHaveLength(1);
    expect(att.elements[0].selector).toBe('body');
  });

  it('extracts files from attachments block', () => {
    const msg: Message = { role: 'user', content: '<attachments>\n<attached-file name="a.txt" type="text/plain">\n</attachments>', timestamp: 1 };
    const att = extractUserAttachments(msg);
    expect(att.files).toHaveLength(1);
    expect(att.files[0].name).toBe('a.txt');
  });

  it('extracts recordings from attachments block', () => {
    const msg: Message = { role: 'user', content: '<attachments>\n<recording name="r.json" mime="application/json" event-count="3" duration-ms="1000">\n{}\n</recording>\n</attachments>', timestamp: 1 };
    const att = extractUserAttachments(msg);
    expect(att.recordings).toHaveLength(1);
    expect(att.recordings[0].name).toBe('r.json');
    expect(att.recordings[0].eventCount).toBe(3);
    expect(att.recordings[0].durationMs).toBe(1000);
  });

  it('returns empty for non-user', () => {
    expect(extractUserAttachments({ role: 'assistant', content: 'hi' } as any)).toEqual({ images: [], elements: [], files: [], recordings: [] });
  });

  it('handles non-string non-array content in extractUserText', () => {
    const msg = { role: 'user' as const, content: 123 as any, timestamp: 1 };
    expect(extractUserText(msg)).toBe('');
  });
});

describe('truncateForRetry', () => {
  it('truncates to last user message', () => {
    const msgs = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'toolResult' },
      { role: 'user' },
      { role: 'assistant' },
    ];
    expect(truncateForRetry(msgs)).toEqual(msgs.slice(0, 4));
  });

  it('returns null when no user', () => {
    expect(truncateForRetry([{ role: 'assistant' }])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(truncateForRetry([])).toBeNull();
  });
});

describe('buildToolResultIndex', () => {
  it('indexes tool results by toolCallId', () => {
    const tr: ToolResultMessage = { role: 'toolResult', toolCallId: 'a', toolName: 'x', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 1 };
    const map = buildToolResultIndex([tr]);
    expect(map.get('a')).toBe(tr);
  });

  it('ignores non-toolResult messages', () => {
    const map = buildToolResultIndex([{ role: 'user', content: 'hi' } as any]);
    expect(map.size).toBe(0);
  });
});

describe('buildTurnMetaMap', () => {
  it('aggregates token usage per turn', () => {
    const am1 = makeAssistant({ usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 5, totalTokens: 35, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const am2 = makeAssistant({ usage: { input: 5, output: 15, cacheRead: 2, cacheWrite: 0, totalTokens: 22, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const messages: Message[] = [
      { role: 'user', content: 'hi', timestamp: 1 },
      am1,
      { role: 'user', content: 'again', timestamp: 2 },
      am2,
    ];
    const map = buildTurnMetaMap(messages);
    expect(map.get(1)?.inputTokens).toBe(10);
    expect(map.get(1)?.outputTokens).toBe(20);
    expect(map.get(3)?.inputTokens).toBe(5);
    expect(map.get(3)?.outputTokens).toBe(15);
  });

  it('skips toolUse stop reason', () => {
    const am = makeAssistant({ stopReason: 'toolUse', usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const map = buildTurnMetaMap([{ role: 'user', content: 'hi', timestamp: 1 }, am]);
    expect(map.size).toBe(0);
  });
});
