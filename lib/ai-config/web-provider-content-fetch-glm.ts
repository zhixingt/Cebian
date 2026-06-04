/**
 * ⑪.4 GLM (chatglm.cn) MAIN-world content-script adapter.
 *
 * Flow (chatglm.cn is the domestic Zhihu GLM product; we mirror chromeclaw's
 * structure but with a simplified auth path that does NOT require the X-Sign
 * HMAC — the chatglm.cn SSE endpoint accepts cookie-based auth directly, so
 * we let the browser send cookies via `credentials: 'include'`.
 *
 * The X-Sign HMAC path is reserved for a future "GLM-Intl (chat.z.ai)"
 * provider since it needs telemetry + a derived key derived from the
 * GLM_HMAC_SECRET constant.
 *
 * Self-contained.
 */
import type { ContentFetchRequest } from './web-provider-content-fetch-main';

export const glmMainWorldFetch = async (request: ContentFetchRequest): Promise<void> => {
  const { requestId, init } = request;
  const origin = window.location.origin;

  if (!origin.includes('chatglm.cn')) {
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `GLM adapter requires chatglm.cn origin, got ${origin}`,
      },
      origin,
    );
    return;
  }

  let glmPrompt = '';
  let existingChatId = '';
  try {
    const bodyObj = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
      string,
      string
    >;
    glmPrompt = bodyObj.prompt ?? '';
    existingChatId = bodyObj.chatId ?? '';
  } catch {
    /* defaults */
  }

  // Build the body. GLM's SSE endpoint accepts the same shape as the
  // web chat UI, with a single user message in `messages`.
  const glmBody = JSON.stringify({
    model: 'glm-4-flash',  // sensible default; bridge can override via init.body
    stream: true,
    messages: [{ role: 'user', content: glmPrompt }],
    ...(existingChatId ? { conversation_id: existingChatId } : {}),
  });

  const glmResponse = await fetch(`${origin}/api/chat/v1/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: glmBody,
    credentials: 'include',
  });

  if (!glmResponse.ok) {
    let errorBody = '';
    try {
      errorBody = await glmResponse.text();
      if (errorBody.length > 500) errorBody = errorBody.slice(0, 500);
    } catch {
      /* ignore */
    }
    const authHint =
      glmResponse.status === 401 || glmResponse.status === 403
        ? ' Please visit chatglm.cn to verify your account.'
        : '';
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
    window.postMessage(
      { type: 'WEB_LLM_ERROR', requestId, error: 'No response body from GLM' },
      origin,
    );
    return;
  }

  if (existingChatId) {
    const idChunk = `data: ${JSON.stringify({ type: 'glm:chat_id', chat_id: existingChatId })}\n\n`;
    window.postMessage({ type: 'WEB_LLM_CHUNK', requestId, chunk: idChunk }, origin);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (buffer.includes('\n')) {
      const lineEnd = buffer.indexOf('\n');
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (line.startsWith('data: ')) {
        window.postMessage(
          { type: 'WEB_LLM_CHUNK', requestId, chunk: `${line}\n\n` },
          origin,
        );
      }
    }
  }
  const tail = decoder.decode();
  if (tail) buffer += tail;
  while (buffer.includes('\n')) {
    const lineEnd = buffer.indexOf('\n');
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (line.startsWith('data: ')) {
      window.postMessage({ type: 'WEB_LLM_CHUNK', requestId, chunk: `${line}\n\n` }, origin);
    }
  }
  if (buffer.trim().startsWith('data: ')) {
    window.postMessage(
      { type: 'WEB_LLM_CHUNK', requestId, chunk: `${buffer.trim()}\n\n` },
      origin,
    );
  }
  window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
};
