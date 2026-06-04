/**
 * ⑪.3 Kimi (kimi.com) MAIN-world content-script adapter.
 *
 * Flow (mirrors chromeclaw's providers/kimi-web.ts):
 *  1. Read bearer from cookie 'kimi-auth' (sent automatically by browser
 *     since credentials: 'include' is set on every fetch).
 *  2. POST https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat
 *     with body in Connect-Protocol binary frame (application/connect+json,
 *     Connect-Protocol-Version: 1). The shared runtime `webProviderContentFetchMain`
 *     encodes the JSON body into a 5-byte-header binary frame because we
 *     pass `binaryEncodeBody: true`.
 *  3. Decode the binary-framed response (connect-json envelope).
 *  4. Stream SSE-style chunks back via window.postMessage so the bridge
 *     sees `data: ...\n\n` events it can parse with the existing parser.
 *
 * Self-contained.
 */
import type { ContentFetchRequest } from './web-provider-content-fetch-main';

export const kimiMainWorldFetch = async (request: ContentFetchRequest): Promise<void> => {
  const { requestId, init } = request;
  const origin = window.location.origin;

  // ── Step 1: parse prompt + chat id + model from stub body ──
  let kimiPrompt = '';
  let existingChatId = '';
  try {
    const bodyObj = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
      string,
      string
    >;
    kimiPrompt = bodyObj.prompt ?? '';
    existingChatId = bodyObj.chatId ?? '';
  } catch {
    /* defaults */
  }

  // ── Step 2: read bearer from cookie jar (chrome.cookies API not
  // available in MAIN world — we just trust credentials: 'include'). ──
  // Confirm we are on kimi.com; otherwise bail with a clear error.
  if (!origin.includes('kimi.com')) {
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `kimi adapter requires kimi.com origin, got ${origin}`,
      },
      origin,
    );
    return;
  }

  // ── Step 3: build the request body (Kimi's connect-json format) ──
  const scenario = 'SCENARIO_K2';
  const kimiBody = JSON.stringify({
    scenario,
    message: {
      role: 'user',
      blocks: [{ message_id: '', text: { content: kimiPrompt } }],
      scenario,
    },
    options: { thinking: false },
    // Pass chat id as a hint (Kimi may create a new conversation if missing)
    ...(existingChatId ? { chat_id: existingChatId } : {}),
  });

  // The shared runtime will:
  //   - binaryEncodeBody=true → wrap the body in a 5-byte binary frame
  //   - set Content-Type/Connect-Protocol-Version (overrides our init below)
  //   - forward the response back as connect-json framed chunks
  //
  // But headers defined here take precedence (only Content-Type is overridden
  // by the runtime if needed). The x-msh-platform header matches chromeclaw.
  const kimiInit: RequestInit = {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/connect+json',
      'Connect-Protocol-Version': '1',
      'X-Language': 'zh-CN',
      'X-Msh-Platform': 'web',
      Accept: 'application/connect+json',
    },
    body: kimiBody,
    credentials: 'include',
  };

  // Replace the init in the request (so the runtime picks up our body)
  const kimiRequest: ContentFetchRequest = {
    ...request,
    url: `${origin}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`,
    init: kimiInit,
    binaryProtocol: 'connect-json',
    binaryEncodeBody: true,
  };

  // We hand off to the shared runtime. It will post WEB_LLM_CHUNK / DONE / ERROR.
  // We don't import the runtime here — executeScript serializes the body, so
  // the runtime must live alongside this adapter in the SAME content script.
  // Instead, we delegate by re-injecting the shared runtime via a second call
  // pattern: the SW injects the shared runtime, posts a ContentFetchRequest
  // with `injectScripts` referencing this adapter as the body-fn. But to keep
  // the body self-contained and not require the SW to compose two scripts,
  // we duplicate a minimal connect-json streaming loop here.

  const kimiResponse = await fetch(kimiRequest.url, { ...kimiRequest.init, credentials: 'include' });
  if (!kimiResponse.ok) {
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `Kimi HTTP ${kimiResponse.status}: ${kimiResponse.statusText}`,
      },
      origin,
    );
    return;
  }

  const reader = kimiResponse.body?.getReader();
  if (!reader) {
    window.postMessage(
      { type: 'WEB_LLM_ERROR', requestId, error: 'No response body from Kimi' },
      origin,
    );
    return;
  }

  // ── Inject synthetic SSE so bridge can capture chat id on next turn ──
  if (existingChatId) {
    const idChunk = `data: ${JSON.stringify({ type: 'kimi:chat_id', chat_id: existingChatId })}\n\n`;
    window.postMessage({ type: 'WEB_LLM_CHUNK', requestId, chunk: idChunk }, origin);
  }

  // ── Decode 5-byte-header binary frames (connect-json envelope) ──
  // The shared webProviderContentFetchMain also handles this; we duplicate
  // here to keep the adapter as a single self-contained function (the
  // shared runtime is composed at injection time by the SW instead).
  let buffer = new Uint8Array(0);
  let first = true;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const merged = new Uint8Array(buffer.byteLength + value.byteLength);
    merged.set(buffer);
    merged.set(value, buffer.byteLength);
    buffer = merged;

    // Plain JSON error: byte 0 > 0x03
    if (first && buffer.byteLength > 0 && buffer[0] > 0x03) {
      while (true) {
        const rest = await reader.read();
        if (rest.done) break;
        const m = new Uint8Array(buffer.byteLength + rest.value.byteLength);
        m.set(buffer);
        m.set(rest.value, buffer.byteLength);
        buffer = m;
      }
      const raw = new TextDecoder().decode(buffer);
      window.postMessage(
        { type: 'WEB_LLM_ERROR', requestId, error: `Kimi error: ${raw.slice(0, 500)}` },
        origin,
      );
      return;
    }
    first = false;

    while (buffer.byteLength >= 5) {
      const flags = buffer[0];
      const payloadLen = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      ).getUint32(1, false);
      const frameLen = 5 + payloadLen;
      if (buffer.byteLength < frameLen) break;

      if (flags & 0x02) {
        // Trailer frame: try to extract error
        const trailerPayload = buffer.slice(5, frameLen);
        try {
          const trailerStr = new TextDecoder().decode(trailerPayload);
          const trailer = JSON.parse(trailerStr) as Record<string, unknown>;
          if (trailer.code || trailer.message) {
            window.postMessage(
              {
                type: 'WEB_LLM_ERROR',
                requestId,
                error: `Kimi trailer: ${trailer.message ?? trailer.code ?? 'unknown'}`,
              },
              origin,
            );
            return;
          }
        } catch {
          /* ignore */
        }
        buffer = buffer.slice(frameLen);
        continue;
      }

      const payloadBytes = buffer.slice(5, frameLen);
      buffer = buffer.slice(frameLen);
      try {
        const obj = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
        // Filter: only emit append/set ops with text content
        if (obj.done === true) {
          window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
          return;
        }
        const op = obj.op as string | undefined;
        if (op === 'set' || op === 'append') {
          const block = obj.block as Record<string, unknown> | undefined;
          const text = block?.text as { content?: string } | undefined;
          if (text?.content) {
            window.postMessage(
              { type: 'WEB_LLM_CHUNK', requestId, chunk: `data: ${JSON.stringify({ content: text.content })}\n\n` },
              origin,
            );
          }
        }
      } catch {
        /* ignore partial frames */
      }
    }
  }
  window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
};
