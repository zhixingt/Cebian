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

  // ── Step 2: read bearer from cookie jar. The `kimi-auth` cookie is
  // HttpOnly, so `document.cookie` in MAIN world returns nothing useful.
  // The SW reads it via `chrome.cookies.getAll` (which CAN read HttpOnly)
  // and passes the value as `request.authHeader = 'Bearer <token>'`.
  // chromeclaw's buildRequest does the same: it pulls the `kimi-auth`
  // cookie value and forwards it as `Authorization: Bearer …`, because
  // the Kimi chat endpoint requires the bearer header, not just a
  // first-party cookie. ──
  let kimiAuth = '';
  if (request.authHeader && request.authHeader.startsWith('Bearer ')) {
    kimiAuth = request.authHeader.slice('Bearer '.length).trim();
  } else {
    // Fallback: try document.cookie (works if the cookie is non-HttpOnly)
    try {
      const m = document.cookie.match(/(?:^|;\s*)kimi-auth=([^;]*)/);
      if (m) kimiAuth = decodeURIComponent(m[1]);
    } catch {
      /* ignore */
    }
  }

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
  // ⑪.7: REAL scenario name is `SCENARIO_K2D5`, NOT `SCENARIO_K2`.
  // Discovered via CDP Network interception of the user's actual Kimi
  // frontend (June 2026). chromeclaw's reference was outdated — using
  // the wrong name caused the server to return
  // `{error:{code:"invalid_argument"}}` on every request.
  const scenario = 'SCENARIO_K2D5';
  // ⑪.7: ALWAYS include chat_id (use existingChatId if we have one from
  // a prior turn, else mint a new UUID for the server to create a new
  // conversation).
  const chatId = existingChatId || crypto.randomUUID();
  // ⑪.7: REAL Kimi frontend sends `message_id: ""` (empty string) for
  // client-generated blocks, NOT a UUID. Using a UUID here was
  // triggering the server's `invalid_argument` validation rejection.
  // The `blockId` is preserved as a local variable for any callers
  // that want it but the wire format uses empty string.
  const blockId = crypto.randomUUID();
  // ⑪.7: For the FIRST message of a new conversation, the real Kimi
  // frontend sends `parent_id: ""` (empty string), not a UUID. The
  // chatId-as-parent_id guess was wrong. Subsequent messages in the
  // same conversation would use the previous assistant message's UUID
  // — but for first-message case, empty string is correct.
  // ⑪.7: REAL Kimi frontend does NOT include `device_id` in the
  // body (they put it in headers like GLM does, but Kimi apparently
  // doesn't). Drop it from the body. The server was likely rejecting
  // it as an unknown field.
  // ⑪.7: `tools` array — at minimum the frontend includes
  // `TOOL_TYPE_SEARCH` even when search is disabled (empty object).
  // Server rejects requests without the `tools` field.
  // ⑪.7: DevTools capture showed the real Kimi frontend sends
  // `parent_id: "<prev-msg-UUID>"` for REPLIES. For the FIRST
  // message of a new conversation, there is no previous message —
  // the semantics should be "no parent" rather than "empty string
  // parent_id". Try `parent_id: null` (JSON null) instead of `""`
  // — the server may reject empty string as an invalid UUID format
  // for a field that should be nullable.
  const kimiBody = JSON.stringify({
    chat_id: chatId,
    scenario,
    tools: [{ type: 'TOOL_TYPE_SEARCH', search: {} }],
    message: {
      parent_id: null,
      role: 'user',
      blocks: [{ message_id: '', text: { content: kimiPrompt } }],
      scenario,
    },
    options: { thinking: false },
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
      ...(kimiAuth ? { Authorization: `Bearer ${kimiAuth}` } : {}),
    },
    body: kimiBody,
    credentials: 'include',
  };

  // Replace the init in the request (so the runtime picks up our body).
  // Note: NO `: ContentFetchRequest` type annotation — `url` is optional
  // in that interface, and annotating would widen `kimiRequest.url` to
  // `string | undefined`. We want the literal type with `url: string`
  // so the subsequent `fetch(kimiRequest.url, ...)` is type-safe.
  // ⑪.7: CRITICAL — `x-msh-session-id` is NOT a random value, it is
  // the `ssid` CLAIM from the `kimi-auth` JWT payload. Discovered by
  // base64-decoding the captured Bearer token — the JWT payload
  // contains `"ssid":"1730314642785969028"` which matches the real
  // Kimi frontend's x-msh-session-id exactly. Generating a random
  // number (Date.now() + random) does NOT pass server validation;
  // the session id must correspond to a real server-issued session.
  //
  // JWT format: `header.payload.signature` (base64url encoded).
  // We only need the payload; decode + JSON.parse + extract ssid.
  let sessionId = '';
  if (kimiAuth) {
    try {
      const parts = kimiAuth.split('.');
      if (parts.length >= 2) {
        // base64url → base64 (replace - with +, _ with /, add padding)
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const json = atob(padded);
        const payload = JSON.parse(json) as Record<string, unknown>;
        if (typeof payload.ssid === 'string') sessionId = payload.ssid;
      }
    } catch { /* malformed JWT — fall through to no session id */ }
  }
  if (sessionId) {
    (kimiInit.headers as Record<string, string>)['x-msh-session-id'] = sessionId;
  }

  // ⑪.7: CRITICAL — Send the request body as PLAIN JSON, NOT wrapped
  // in a 5-byte connect-json envelope. chromeclaw's `kimi-web.ts`
  // reference sends plain JSON (the binary envelope is only for
  // response streaming, not request). My previous adapter used
  // `binaryEncodeBody: true` which wrapped the body in a 5-byte
  // header — the server likely rejected the envelope-wrapped
  // payload as malformed (returning `invalid_argument` on every
  // request, even with the correct scenario/tools/parent_id shape).
  // Keep `binaryProtocol: 'connect-json'` so the RESPONSE is still
  // parsed as a 5-byte framed stream.
  const kimiRequest = {
    ...request,
    url: `${origin}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`,
    init: kimiInit,
    binaryProtocol: 'connect-json' as const,
    binaryEncodeBody: false as const,
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
  let bytesRead = 0;  // ⑪.7: track total bytes read; 0 = empty body
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
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
        // Trailer frame: try to extract error. Kimi's actual trailer
        // format is `{"error":{"code":"...","message":"..."}}` (nested),
        // not the top-level `{code, message}` shape that chromeclaw used.
        // Check both.
        const trailerPayload = buffer.slice(5, frameLen);
        try {
          const trailerStr = new TextDecoder().decode(trailerPayload);
          const trailer = JSON.parse(trailerStr) as Record<string, unknown>;
          const nestedError = trailer.error as Record<string, unknown> | undefined;
          const errCode = (trailer.code as string | undefined) ?? nestedError?.code as string | undefined;
          const errMsg = (trailer.message as string | undefined) ?? nestedError?.message as string | undefined;
          if (errCode || errMsg) {
            window.postMessage(
              {
                type: 'WEB_LLM_ERROR',
                requestId,
                error: `Kimi trailer: ${errMsg ?? errCode ?? 'unknown'}${errCode ? ` (code=${errCode})` : ''}`,
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
  // ⑪.7: If the server returned 200 OK but the body was completely empty,
  // don't silently emit DONE with 0 chunks — the user would see a chat
  // panel with no response and no error, which is undebuggable. Surface
  // a clear error pointing at the most likely server-side causes so the
  // user (or the next devtools session) can investigate.
  if (bytesRead === 0) {
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `Kimi returned 200 OK but the response body was empty. ` +
               `This usually means: (1) the server is rate-limiting the session, ` +
               `(2) the connect-json envelope format has changed, or ` +
               `(3) the endpoint has drifted. ` +
               `Retry after reloading the Kimi tab, or capture a working request from DevTools to compare.`,
      },
      origin,
    );
    return;
  }
  window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
};
