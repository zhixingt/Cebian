/**
 * ⑪.4 GLM (chatglm.cn) MAIN-world content-script adapter — ⑪.6 rewrite.
 *
 * Every helper, constant, and dependency is inlined into the exported
 * function body. This is REQUIRED because chrome.scripting.executeScript
 * serializes only the function body — any reference to module-scope
 * symbols (constants, helpers) would become undefined at runtime
 * (the "ryt is not defined" bug from the ⑧ selector-fix round).
 *
 * What this adapter does:
 *   1. Read chatglm_token + chatglm_refresh_token from document.cookie
 *   2. If no auth token but refresh token exists, call the refresh
 *      endpoint inline (best-effort, 1 try)
 *   3. Build a real GLM request:
 *        - URL: /chatglm/backend-api/assistant/stream
 *        - Body: { assistant_id, conversation_id, project_id,
 *                  chat_type: 'user_chat', meta_data, messages: [...] }
 *        - Headers: Authorization + 10+ X-* headers including
 *                   X-Sign = MD5(timestamp-nonce-secret) where
 *                   timestamp has a checksum digit
 *   4. Read SSE response, dedupe cumulative text deltas
 *      (parts[0].content[0].text contains the FULL accumulated text
 *      every event, so we must subtract prevText to get the delta)
 *   5. Forward deltas to the bridge via window.postMessage
 *
 * Reference: chromeclaw-research/.../providers/{glm-shared,glm-signing}.ts
 */
import type { ContentFetchRequest } from './web-provider-content-fetch-main';

export const glmMainWorldFetch = async (request: ContentFetchRequest): Promise<void> => {
  // ── Inlined constants (cannot be module-scope — would be undefined
  //    when this function is serialized via chrome.scripting.executeScript) ──
  const GLM_SIGN_SECRET = '8a1317a7468aa3ad86e997d08f3f31cb';
  const GLM_DEVICE_ID_KEY = '__cebGlmDeviceId__';
  const GLM_REFRESH_URL_SUFFIX = '/chatglm/user-api/user/refresh';
  const GLM_STREAM_URL_SUFFIX = '/chatglm/backend-api/assistant/stream';
  const GLM_ASSISTANT_ID = '65940acff94777010aa6b796';

  // MD5 K constants (64 × floor(2^32 * abs(sin(i+1))))
  const MD5_K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
    0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
    0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
    0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
    0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  // ── Inlined helpers (cannot be module-scope) ──
  const md5Hex = (input: string): string => {
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 0; i < 4; i++) bytes.push((bitLen >>> (i * 8)) & 0xff);
    for (let i = 0; i < 4; i++) bytes.push(0);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const toHex = (n: number) => {
      const u = n >>> 0;
      return (
        ((u & 0xff).toString(16).padStart(2, '0')) +
        (((u >>> 8) & 0xff).toString(16).padStart(2, '0')) +
        (((u >>> 16) & 0xff).toString(16).padStart(2, '0')) +
        (((u >>> 24) & 0xff).toString(16).padStart(2, '0'))
      );
    };
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const w = new Int32Array(16);
      for (let j = 0; j < 16; j++) {
        w[j] =
          bytes[offset + j * 4] |
          (bytes[offset + j * 4 + 1] << 8) |
          (bytes[offset + j * 4 + 2] << 16) |
          (bytes[offset + j * 4 + 3] << 24);
      }
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f: number, g: number;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const temp = d; d = c; c = b;
        const sum = ((a + f) | 0) + ((MD5_K[i] + w[g]) | 0);
        const rot = MD5_S[i];
        b = (b + ((sum << rot) | (sum >>> (32 - rot)))) | 0;
        a = temp;
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }
    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
  };

  const generateGlmSign = (): { timestamp: string; nonce: string; sign: string } => {
    const now = Date.now();
    const digits = now.toString();
    const len = digits.length;
    const digitArr = digits.split('').map(Number);
    const sum = digitArr.reduce((acc, v) => acc + v, 0) - digitArr[len - 2];
    const checkDigit = sum % 10;
    const timestamp = digits.substring(0, len - 2) + checkDigit + digits.substring(len - 1);
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const sign = md5Hex(`${timestamp}-${nonce}-${GLM_SIGN_SECRET}`);
    return { timestamp, nonce, sign };
  };

  const readCookie = (name: string): string => {
    try {
      const m = document.cookie.match(
        new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`),
      );
      if (!m) return '';
      try { return decodeURIComponent(m[1]); } catch { return m[1]; }
    } catch { return ''; }
  };

  const getOrCreateDeviceId = (): string => {
    try {
      const cached = localStorage.getItem(GLM_DEVICE_ID_KEY);
      if (cached && /^[0-9a-f-]{36}$/i.test(cached)) return cached;
    } catch { /* ignore */ }
    const fresh = crypto.randomUUID();
    try { localStorage.setItem(GLM_DEVICE_ID_KEY, fresh); } catch { /* ignore */ }
    return fresh;
  };

  const refreshGlmToken = async (refreshUrl: string, refreshToken: string): Promise<string | null> => {
    const { timestamp, nonce, sign } = generateGlmSign();
    try {
      const resp = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${refreshToken}`,
          'App-Name': 'chatglm',
          'X-App-Platform': 'pc',
          'X-App-Version': '0.0.1',
          'X-Device-Id': getOrCreateDeviceId(),
          'X-Request-Id': crypto.randomUUID(),
          'X-Sign': sign,
          'X-Nonce': nonce,
          'X-Timestamp': timestamp,
        },
        body: JSON.stringify({}),
        credentials: 'include',
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as Record<string, unknown>;
      const result = data?.result as Record<string, unknown> | undefined;
      return (
        (result?.access_token as string | undefined) ??
        (result?.accessToken as string | undefined) ??
        (data?.accessToken as string | undefined) ??
        null
      );
    } catch { return null; }
  };

  // ── Main logic ──
  const { requestId, init } = request;
  const origin = window.location.origin;

  if (!origin.includes('chatglm.cn')) {
    window.postMessage(
      { type: 'WEB_LLM_ERROR', requestId, error: `GLM adapter requires chatglm.cn origin, got ${origin}` },
      origin,
    );
    return;
  }

  let glmPrompt = '';
  let existingChatId = '';
  try {
    const bodyObj = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, string>;
    glmPrompt = bodyObj.prompt ?? '';
    existingChatId = bodyObj.chatId ?? '';
  } catch { /* defaults */ }

  let authToken = readCookie('chatglm_token');
  const refreshToken = readCookie('chatglm_refresh_token');

  if (!authToken && refreshToken) {
    const refreshed = await refreshGlmToken(`${origin}${GLM_REFRESH_URL_SUFFIX}`, refreshToken);
    if (refreshed) authToken = refreshed;
  }

  if (!authToken) {
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `No chatglm_token (and refresh failed) for GLM. Please visit chatglm.cn to log in, then reconnect via Settings → Web Providers.`,
      },
      origin,
    );
    return;
  }

  const deviceId = getOrCreateDeviceId();
  const { timestamp, nonce, sign } = generateGlmSign();
  const glmHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${authToken}`,
    'App-Name': 'chatglm',
    'X-App-Platform': 'pc',
    'X-App-Version': '0.0.1',
    'X-App-fr': 'default',
    'X-Device-Brand': '',
    'X-Device-Id': deviceId,
    'X-Device-Model': '',
    'X-Lang': 'zh',
    'X-Request-Id': crypto.randomUUID(),
    'X-Sign': sign,
    'X-Nonce': nonce,
    'X-Timestamp': timestamp,
  };

  const glmBody = JSON.stringify({
    assistant_id: GLM_ASSISTANT_ID,
    conversation_id: existingChatId,
    project_id: '',
    chat_type: 'user_chat',
    meta_data: {
      cogview: { rm_label_watermark: false },
      is_test: false,
      input_question_type: 'xxxx',
      channel: '',
      draft_id: '',
      chat_mode: '',
      is_networking: false,
      quote_log_id: '',
      platform: 'pc',
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: glmPrompt }] }],
  });

  const glmResponse = await fetch(`${origin}${GLM_STREAM_URL_SUFFIX}`, {
    method: 'POST',
    headers: glmHeaders,
    body: glmBody,
    credentials: 'include',
  });

  if (!glmResponse.ok) {
    let errorBody = '';
    try {
      errorBody = await glmResponse.text();
      if (errorBody.length > 500) errorBody = errorBody.slice(0, 500);
    } catch { /* ignore */ }
    const authHint = glmResponse.status === 401 || glmResponse.status === 403
      ? ' Please visit chatglm.cn to verify your account.' : '';
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `GLM HTTP ${glmResponse.status}: ${glmResponse.statusText}${errorBody ? ` — ${errorBody}` : ''}${authHint}`,
      },
      origin,
    );
    return;
  }

  const reader = glmResponse.body?.getReader();
  if (!reader) {
    window.postMessage({ type: 'WEB_LLM_ERROR', requestId, error: 'No response body from GLM' }, origin);
    return;
  }

  if (existingChatId) {
    const idChunk = `data: ${JSON.stringify({ type: 'glm:chat_id', chat_id: existingChatId })}\n\n`;
    window.postMessage({ type: 'WEB_LLM_CHUNK', requestId, chunk: idChunk }, origin);
  }

  let buffer = '';
  let prevText = '';
  let prevThink = '';
  let prevLogicId = '';
  const decoder = new TextDecoder();
  const flushSse = (): string | null => {
    const idx = buffer.indexOf('\n\n');
    if (idx < 0) return null;
    const block = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return '';
    const data = dataLines.join('\n');
    if (data === '[DONE]') return '__DONE__';
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(data) as Record<string, unknown>; } catch { return ''; }
    if (parsed.error) {
      const err = parsed.error as Record<string, unknown>;
      throw new Error((err.message as string | undefined) ?? 'GLM error');
    }
    const parts = parsed.parts as Array<{
      logic_id?: string;
      content?: Array<{ type?: string; text?: string; think?: string }>;
    }> | undefined;
    if (!parts || parts.length === 0) return '';
    const logicId = parts[0]?.logic_id;
    if (logicId && logicId !== prevLogicId) {
      prevLogicId = logicId; prevText = ''; prevThink = '';
    }
    const content = parts[0]?.content?.[0];
    if (!content) return '';
    if (content.type === 'think' && typeof content.think === 'string') {
      const fullThink = content.think;
      if (fullThink.length <= prevThink.length) return '';
      const delta = fullThink.slice(prevThink.length);
      prevThink = fullThink;
      return `<think>${delta}</think>`;
    }
    if (content.type === 'text' && typeof content.text === 'string') {
      const fullText = content.text;
      if (fullText.length <= prevText.length) return '';
      const delta = fullText.slice(prevText.length);
      prevText = fullText;
      return delta;
    }
    return '';
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let guard = 0;
      while (guard++ < 100) {
        try {
          const out = flushSse();
          if (out === null) break;
          if (out === '__DONE__') {
            window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
            return;
          }
          if (out) {
            window.postMessage(
              { type: 'WEB_LLM_CHUNK', requestId, chunk: `data: ${JSON.stringify({ content: out })}\n\n` },
              origin,
            );
          }
        } catch (err) {
          window.postMessage(
            {
              type: 'WEB_LLM_ERROR',
              requestId,
              error: `GLM SSE parse: ${err instanceof Error ? err.message : String(err)}`,
            },
            origin,
          );
          return;
        }
      }
    }
    const tail = decoder.decode();
    if (tail) buffer += tail;
    let guard = 0;
    while (guard++ < 10) {
      const out = flushSse();
      if (out === null) break;
      if (out === '__DONE__') {
        window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
        return;
      }
      if (out) {
        window.postMessage(
          { type: 'WEB_LLM_CHUNK', requestId, chunk: `data: ${JSON.stringify({ content: out })}\n\n` },
          origin,
        );
      }
    }
    window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
  } catch (err) {
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `GLM stream: ${err instanceof Error ? err.message : String(err)}`,
      },
      origin,
    );
  }
};
