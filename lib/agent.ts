import { Agent, type AgentOptions, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model, Message } from '@earendil-works/pi-ai';
import { providerCredentials, type OAuthCredential } from './storage';
import { getValidOAuthToken } from './oauth';
import { DEFAULT_SYSTEM_PROMPT } from './constants';
import { buildMemoryPrompt } from './memory/prompt-builder';

// ─── Agent factory ───

export interface CreateAgentOptions {
  model: Model<Api>;
  /** Session id — substituted into the system prompt as the agent's working directory. */
  sessionId: string;
  /**
   * Optional user-provided instructions appended to the built-in system prompt.
   * Intended for style/language/role tweaks; cannot override tool protocol or safety rules.
   */
  userInstructions: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  maxRounds: number;
  messages?: AgentMessage[];
  /** Session-specific tools array (includes per-session ask_user). */
  tools: AgentTool<any>[];
}

export async function createCebianAgent(options: CreateAgentOptions): Promise<Agent> {
  const {
    model,
    sessionId,
    userInstructions,
    thinkingLevel,
    maxRounds,
    messages = [],
    tools: agentTools,
  } = options;

  const basePrompt = DEFAULT_SYSTEM_PROMPT
    .replaceAll('{{SESSION_ID}}', sessionId);
  const trimmedInstructions = userInstructions.trim();
  const effectivePrompt = trimmedInstructions
    ? `${basePrompt}\n\n<user-instructions>\n${trimmedInstructions}\n</user-instructions>`
    : basePrompt;

  // 分层记忆注入：检索用户画像 + 会话摘要 + Agent 记忆，追加到 system prompt。
  // 失败时不阻塞 Agent 创建（返回空字符串，使用 effectivePrompt 兜底）。
  let memoryPrompt = '';
  try {
    memoryPrompt = await buildMemoryPrompt(sessionId);
  } catch (err) {
    console.warn('[Agent] Failed to build memory prompt:', err);
  }
  const finalPrompt = memoryPrompt
    ? `${effectivePrompt}\n\n${memoryPrompt}`
    : effectivePrompt;

  const agentOptions: AgentOptions = {
    initialState: {
      systemPrompt: finalPrompt,
      model,
      thinkingLevel,
      tools: agentTools,
      messages,
    },

    // Convert AgentMessages to LLM messages (filter out any custom types)
    convertToLlm: (msgs: AgentMessage[]): Message[] => {
      return msgs.filter((m): m is Message =>
        'role' in m && ['user', 'assistant', 'toolResult'].includes((m as Message).role),
      );
    },

    // Context window management: sliding window based on maxRounds
    transformContext: async (msgs: AgentMessage[]): Promise<AgentMessage[]> => {
      const limit = maxRounds * 3; // ~3 messages per round (user + assistant + potential toolResult)
      if (msgs.length <= limit) return msgs;
      return msgs.slice(-limit);
    },

    // Dynamic API key resolution (handles OAuth token refresh)
    getApiKey: async (provider: string): Promise<string | undefined> => {
      try {
        const creds = await providerCredentials.getValue();
        const cred = creds[provider];
        if (!cred) return undefined;

        if (cred.authType === 'apiKey') {
          return cred.apiKey;
        }

        if (cred.authType === 'oauth') {
          return getValidOAuthToken(provider, cred as OAuthCredential);
        }
      } catch (err) {
        console.error(`[Agent] Failed to get API key for ${provider}:`, err);
      }
      return undefined;
    },
  };

  return new Agent(agentOptions);
}
