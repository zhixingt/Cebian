import type { WebProvider, WebProviderUserOverrides } from '../types';

/**
 * ③+④: per-preset chat API descriptor. Tells the relay how to talk to the
 * provider's web session. Optional in T2; T3 will populate for the 3 built-in
 * providers. If undefined, the provider is cookie-captured but cannot be used
 * for chat (set chatApi = null via A2 to skip; not exposed in MVP).
 */
export interface WebProviderChatApi {
  /** Provider域的 chat endpoint（绝对 URL） */
  endpoint: string;
  /** HTTP method */
  method: 'POST' | 'GET';
  /** 流格式 */
  streamFormat: 'sse' | 'jsonl';
  /** 提取 delta text 的 JSON 路径（点号分隔，e.g. 'choices.0.delta.content'） */
  deltaPath: string;
  /** 提取 reasoning text 的 JSON 路径（可选） */
  reasoningPath?: string;
  /** 提取 stop reason 的 JSON 路径（可选） */
  stopReasonPath?: string;
  /** 请求 body 模板（{{messages}} {{system}} 占位；多轮 conversationId 缓存是 ⑦ 范围，本里程碑固定传全量历史） */
  bodyTemplate: string;
  /** 额外请求头（cookie 由 MAIN-world fetch 自动带，这里只填 x-*） */
  extraHeaders?: Record<string, string>;
  /** 流结束信号（'data: [DONE]' 或自定义） */
  endSignal: string;
  /** 是否支持 images（决定 Model.image: false 标记）。MVP 全部为 false */
  supportsImages: false;
}

/**
 * Built-in web AI provider presets.
 * Adding a new preset = append an entry here + add 3 i18n keys.
 * User-defined presets are a future feature; not supported in MVP.
 */
export interface WebProviderPreset {
  /** Unique id, matches WebProvider['presetId'] */
  id: WebProvider['presetId'];

  /** Display name (i18n key, resolved at render time) */
  displayNameKey: string;

  /** Short description (i18n key) */
  descriptionKey: string;

  /** Official website URL (target of the "Open" button) */
  loginUrl: string;

  /** Default Model ID */
  defaultModelId: string;

  /** Recommended capability flags; user can override */
  defaultSupportsToolCalls: boolean;
  defaultSupportsReasoning: boolean;

  /** ⭐ ②: cookie domain for `chrome.cookies.getAll({ domain })` */
  cookieDomain: string;

  /** ⭐ ②: cookie names whose presence indicates a logged-in session. ANY name match → has session. */
  sessionIndicators: string[];

  /** ⭐ ②: also check localStorage (for providers like Kimi that store tokens there) */
  useLocalStorageFallback: boolean;

  /** ⭐ ②: optional URL to exchange refresh_token for access_token (GLM only) */
  refreshUrl?: string;

  /** ⭐ ③+④: per-preset chat API descriptor (optional in T2; T3 populates) */
  chatApi?: WebProviderChatApi;
}

export const WEB_PROVIDER_PRESETS: readonly WebProviderPreset[] = [
  {
    id: 'glm',
    displayNameKey: 'webProviders.presets.glm.name',
    descriptionKey: 'webProviders.presets.glm.description',
    loginUrl: 'https://chatglm.cn',
    defaultModelId: 'GLM-4.6',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
    cookieDomain: 'chatglm.cn',
    // Unverified guesses. User can override via A2 if wrong.
    sessionIndicators: ['chatglm_refresh_token', 'chatglm_token'],
    useLocalStorageFallback: false,
    // GLM requires token exchange (chromeclaw confirms).
    refreshUrl: 'https://chatglm.cn/api/v1/auth/refresh',
    // ⭐ ③+④ T3: PLACEHOLDER endpoint + body — T1 (DevTools research) will replace with real values.
    // Assumes OpenAI-compatible SSE format. If GLM uses a different shape, T1 will adjust.
    chatApi: {
      endpoint: 'https://chatglm.cn/api/chat',
      method: 'POST',
      streamFormat: 'sse',
      deltaPath: 'choices.0.delta.content',
      stopReasonPath: 'choices.0.finish_reason',
      bodyTemplate: '{"model":"GLM-4.6","messages":{{messages}},"stream":true}',
      endSignal: 'data: [DONE]',
      supportsImages: false,
    },
  },
  {
    id: 'kimi',
    displayNameKey: 'webProviders.presets.kimi.name',
    descriptionKey: 'webProviders.presets.kimi.description',
    loginUrl: 'https://kimi.com',
    defaultModelId: 'kimi-k2-0905-preview',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: false,
    cookieDomain: 'kimi.moonshot.cn',
    // Unverified; kimi uses localStorage per chromeclaw
    sessionIndicators: ['kimi-auth'],
    useLocalStorageFallback: true,
    // No refresh exchange for Kimi
    // ⭐ ③+④ T3: PLACEHOLDER — T1 (DevTools research) will replace with real Kimi endpoint.
    chatApi: {
      endpoint: 'https://kimi.moonshot.cn/api/chat',
      method: 'POST',
      streamFormat: 'sse',
      deltaPath: 'choices.0.delta.content',
      stopReasonPath: 'choices.0.finish_reason',
      bodyTemplate: '{"model":"kimi-k2-0905-preview","messages":{{messages}},"stream":true}',
      endSignal: 'data: [DONE]',
      supportsImages: false,
    },
  },
  {
    id: 'deepseek',
    displayNameKey: 'webProviders.presets.deepseek.name',
    descriptionKey: 'webProviders.presets.deepseek.description',
    loginUrl: 'https://chat.deepseek.com',
    defaultModelId: 'deepseek-chat',
    defaultSupportsToolCalls: true,
    defaultSupportsReasoning: true,
    cookieDomain: 'chat.deepseek.com',
    // Django-style sessionid guess; user can override via A2
    sessionIndicators: ['sessionid'],
    useLocalStorageFallback: false,
    // ⭐ ③+④ T3: PLACEHOLDER — T1 (DevTools research) will replace with real DeepSeek endpoint.
    chatApi: {
      endpoint: 'https://chat.deepseek.com/api/v0/chat/completions',
      method: 'POST',
      streamFormat: 'sse',
      deltaPath: 'choices.0.delta.content',
      stopReasonPath: 'choices.0.finish_reason',
      bodyTemplate: '{"model":"deepseek-chat","messages":{{messages}},"stream":true,"stream_options":{"include_usage":true}}',
      endSignal: 'data: [DONE]',
      supportsImages: false,
    },
  },
] as const;

/**
 * A2 KEY ONE: merge preset values with user's overrides.
 * User wins on every field that has an override; others fall through to preset.
 * The returned `source` object indicates which fields came from where.
 *
 * Usage:
 *   const effective = resolveEffectiveConfig(provider, preset);
 *   chrome.cookies.getAll({ domain: effective.cookieDomain });
 *   effective.sessionIndicators.some(name => cookieMap[name]);
 */
export function resolveEffectiveConfig(
  provider: WebProvider,
  preset: WebProviderPreset,
): WebProviderPreset & { source: Record<keyof WebProviderUserOverrides, 'preset' | 'user'> } {
  const u = provider.userOverrides ?? {};
  return {
    ...preset,
    cookieDomain: u.cookieDomain ?? preset.cookieDomain,
    sessionIndicators: u.sessionIndicators ?? preset.sessionIndicators,
    useLocalStorageFallback: u.useLocalStorageFallback ?? preset.useLocalStorageFallback,
    refreshUrl: u.refreshUrl ?? preset.refreshUrl,
    source: {
      cookieDomain: u.cookieDomain !== undefined ? 'user' : 'preset',
      sessionIndicators: u.sessionIndicators !== undefined ? 'user' : 'preset',
      useLocalStorageFallback: u.useLocalStorageFallback !== undefined ? 'user' : 'preset',
      refreshUrl: u.refreshUrl !== undefined ? 'user' : 'preset',
    },
  };
}
