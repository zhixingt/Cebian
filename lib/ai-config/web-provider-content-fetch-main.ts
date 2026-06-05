/**
 * ⑩ A-line architecture — HTTP-replay + session token (chromeclaw-style)
 * for Web providers (DeepSeek / Kimi / GLM / etc.).
 *
 * Why we're moving away from DOM-injection (⑧):
 *   - DOM-injection fights React/Lexical reconciler quirks (synthetic Enter
 *     events are ignored, contenteditable needs beforeinput, send buttons
 *     are hidden until content is set, ...)
 *   - chromeclaw's web provider has been production-tested with the same
 *     surface and works reliably: inject a content script into MAIN world
 *     that fetch()'s the real chat API with the user's session cookies /
 *     localStorage tokens, then streams SSE back.
 *
 * The flow mirrors chromeclaw's `web-llm-bridge.ts` exactly:
 *
 *   1. open (or focus) the provider's background tab at its loginUrl
 *   2. inject `installRelay` into ISOLATED world
 *   3. inject `mainWorldFetch` into MAIN world (serialized)
 *   4. relay -> postMessage request to MAIN
 *   5. MAIN runs provider-specific fetch (PoW / sentinel / HMAC / Connect-Protocol)
 *   6. MAIN posts back WEB_LLM_CHUNK / WEB_LLM_DONE / WEB_LLM_ERROR
 *   7. relay forwards via chrome.runtime.sendMessage to bridge
 *   8. bridge parses SSE, emits pi-ai stream events
 *
 * The contract between the SW and the content scripts (kept identical to
 * chromeclaw's) is documented in this file. The per-provider adapter just
 * implements `mainWorldFetch` — all boilerplate (pre-flight, template
 * substitution, keep-alive, SSE → postMessage forwarding) lives in the
 * shared `mainWorldFetch` runtime in this file.
 *
 * Public surface for the rest of the codebase:
 *   - `webProviderContentFetchMain` (this file): the shared content-script
 *     body that providers import and reference as `func: webProviderContentFetchMain`.
 *   - `ContentFetchRequest` type: the message shape that providers fill in.
 *   - `webProviderRelay` (separate file, in the same folder as the
 *     extension's relay): bridges MAIN ↔ SW.
 *
 * The SW side (analogous to chromeclaw's `web-llm-bridge.ts`) is the
 * existing `lib/ai-config/web-provider-stream.ts`, which already calls
 * `injectDomRelay`. The next ⑪.5 commit rewires it to inject this
 * content-fetch main + a small relay that forwards `WEB_LLM_*` messages.
 */
export interface ContentFetchRequest {
  type: 'WEB_LLM_FETCH';
  requestId: string;
  /**
   * ⑫: Provider id (e.g. 'glm', 'deepseek'). The ISOLATED bridge
   * filters incoming events by this field — events with a mismatched
   * providerId are dropped. Adapters must include it in every event.
   */
  providerId: string;
  /**
   * The fully-built `url` and `init` for the provider's main chat endpoint.
   * Providers fill this in from their own auth + body construction.
   * Optional — adapters that build the URL internally (Kimi/GLM/DeepSeek) ignore it.
   */
  url?: string;
  init: RequestInit;
  /**
   * Optional pre-flight request (e.g. Qwen's `create chat session`).
   * The JSON response is available to `url` for `{var}` substitution.
   */
  setupRequest?: { url: string; init: RequestInit };
  /** Treat `url` as a template (`{id}` is replaced from setup response). */
  urlTemplate?: boolean;
  /**
   * If the response uses a binary frame protocol, the bridge re-emits it
   * as `data: ...\n\n` so the existing SSE pipeline still works.
   *  - `connect-json`: 5-byte header [flags:1][len:4] then JSON payload
   *  - `gemini-chunks`: same envelope, different framing
   *  - `glm-intl`: same envelope, different framing
   *  - `deepseek`: same envelope, different framing
   *  - `chatgpt`: same envelope, different framing
   *  - `doubao`: same envelope, different framing
   *  - `rakuten`: same envelope, different framing
   */
  binaryProtocol?:
    | 'connect-json'
    | 'gemini-chunks'
    | 'glm-intl'
    | 'deepseek'
    | 'chatgpt'
    | 'doubao'
    | 'rakuten';
  /** When true, the request body is JSON-encoded into a binary frame first. */
  binaryEncodeBody?: boolean;
  /**
   * Provider-specific metadata passed from the bridge (e.g. persisted
   * deviceId for ChatGPT). Providers can ignore it.
   */
  providerMetadata?: Record<string, string>;
  /**
   * Retry counter (max 1). The bridge bumps this when the previous attempt
   * got a 403 and the page should be reloaded.
   */
  retryAttempt?: number;
  /**
   * ⑪.7: SW-provided Authorization header for cookies the MAIN world
   * can't see via `document.cookie` (HttpOnly cookies like Kimi's
   * `kimi-auth`). The SW reads them via `chrome.cookies.getAll` (which
   * CAN read HttpOnly) and passes the value here. Adapters that need
   * auth use this in preference to extracting from `document.cookie`.
   * Format: `'Bearer <token>'` (the adapter strips the prefix).
   */
  authHeader?: string;
}

/**
 * Shared MAIN-world runtime for all web providers. Mirrors chromeclaw's
 * `content-fetch-main.ts` shape: pre-flight setup + template substitution,
 * keep-alive telemetry (anti "stale tab" detection), binary envelope
 * decoder (for Connect-Protocol providers), and SSE postMessage forwarding.
 *
 * The function is **self-contained** — chrome.scripting.executeScript
 * serializes only the function body, so no imports / closures survive.
 */
export const webProviderContentFetchMain = async (request: ContentFetchRequest): Promise<void> => {
  const {
    requestId,
    setupRequest,
    urlTemplate,
    binaryProtocol,
    binaryEncodeBody,
  } = request;
  let { url, init } = request;
  // The shared runtime always needs a URL. Adapters that build the URL
  // internally (Kimi/GLM/DeepSeek) don't use this runtime — they have
  // their own self-contained implementations. If a caller hands us a
  // request without a url, fail loudly rather than silently making
  // a fetch() to `undefined`.
  if (!url) {
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: 'webProviderContentFetchMain requires `url` in the request; adapters that build the URL internally should not delegate here.',
      },
      window.location.origin,
    );
    return;
  }
  const origin = window.location.origin;

  // ── Keep-alive (anti "inactive tab" detection, esp. ChatGPT). ──
  // Most providers (DeepSeek / Kimi / GLM) don't need this, but it's
  // cheap and only adds a mousemove every 30s.
  const keepAliveInterval = setInterval(() => {
    try {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: Math.random() * window.innerWidth,
          clientY: Math.random() * window.innerHeight,
        }),
      );
    } catch {
      /* non-fatal */
    }
  }, 30_000);

  try {
    // ── Setup (pre-flight) request + template substitution ──
    let setupData: Record<string, unknown> | undefined;
    if (setupRequest) {
      const setupResp = await fetch(setupRequest.url, {
        ...setupRequest.init,
        credentials: 'include',
      });
      if (!setupResp.ok) {
        window.postMessage(
          {
            type: 'WEB_LLM_ERROR',
            requestId,
            error: `Setup request failed: HTTP ${setupResp.status}: ${setupResp.statusText}. ${setupResp.status === 401 || setupResp.status === 403 ? `Please visit ${origin} to verify your account.` : ''}`,
          },
          origin,
        );
        return;
      }
      setupData = (await setupResp.json()) as Record<string, unknown>;

      if (urlTemplate && setupData) {
        const flat = (obj: Record<string, unknown>, prefix = ''): [string, string][] => {
          const out: [string, string][] = [];
          for (const [k, v] of Object.entries(obj)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (typeof v === 'string' || typeof v === 'number') {
              out.push([key, String(v)]);
              out.push([k, String(v)]);
            } else if (v && typeof v === 'object' && !Array.isArray(v)) {
              out.push(...flat(v as Record<string, unknown>, key));
            }
          }
          return out;
        };
        for (const [k, v] of flat(setupData)) {
          url = url.replaceAll(`{${k}}`, v);
        }
        if (typeof init.body === 'string') {
          let body = init.body;
          for (const [k, v] of flat(setupData)) {
            body = body.replaceAll(`{${k}}`, v);
          }
          init = { ...init, body };
        }
      }
    }

    // ── Binary envelope encoding for the request body ──
    if (binaryProtocol === 'connect-json' && binaryEncodeBody && typeof init.body === 'string') {
      const payload = new TextEncoder().encode(init.body);
      const frame = new ArrayBuffer(5 + payload.byteLength);
      const view = new DataView(frame);
      view.setUint8(0, 0x00);
      view.setUint32(1, payload.byteLength, false);
      new Uint8Array(frame, 5).set(payload);
      init = { ...init, body: frame };
    }

    const response = await fetch(url, { ...init, credentials: 'include' });
    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
        if (errorBody.length > 500) errorBody = errorBody.slice(0, 500);
      } catch {
        /* ignore */
      }
      const authHint =
        response.status === 401 || response.status === 403
          ? ` Please visit ${origin} to verify your account.`
          : '';
      window.postMessage(
        {
          type: 'WEB_LLM_ERROR',
          requestId,
          error: `HTTP ${response.status}: ${response.statusText}${errorBody ? ` — ${errorBody}` : ''}${authHint}`,
        },
        origin,
      );
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      window.postMessage(
        { type: 'WEB_LLM_ERROR', requestId, error: 'No response body' },
        origin,
      );
      return;
    }

    if (binaryProtocol === 'connect-json') {
      // Decode 5-byte binary frames; for non-frame responses (e.g. plain
      // JSON error), detect byte 0 > 0x03 and parse the entire body as JSON.
      let buffer = new Uint8Array(0);
      let isFirstChunk = true;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(buffer.byteLength + value.byteLength);
        merged.set(buffer);
        merged.set(value, buffer.byteLength);
        buffer = merged;

        if (isFirstChunk && buffer.byteLength > 0 && buffer[0] > 0x03) {
          while (true) {
            const rest = await reader.read();
            if (rest.done) break;
            const m = new Uint8Array(buffer.byteLength + rest.value.byteLength);
            m.set(buffer);
            m.set(rest.value, buffer.byteLength);
            buffer = m;
          }
          const raw = new TextDecoder().decode(buffer);
          try {
            const e = JSON.parse(raw) as Record<string, unknown>;
            const err = (e.message ?? e.error ?? e.code ?? raw.slice(0, 200)) as string;
            window.postMessage(
              { type: 'WEB_LLM_ERROR', requestId, error: `Connect error: ${err}` },
              origin,
            );
          } catch {
            window.postMessage(
              { type: 'WEB_LLM_ERROR', requestId, error: `Connect error: ${raw.slice(0, 500)}` },
              origin,
            );
          }
          return;
        }
        isFirstChunk = false;

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
            buffer = buffer.slice(frameLen);
            continue;
          }
          const payloadBytes = buffer.slice(5, frameLen);
          buffer = buffer.slice(frameLen);
          const json = new TextDecoder().decode(payloadBytes);
          window.postMessage(
            { type: 'WEB_LLM_CHUNK', requestId, chunk: `data: ${json}\n\n` },
            origin,
          );
        }
      }
      window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
    } else {
      // Standard SSE text streaming — forward chunks unchanged.
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        window.postMessage({ type: 'WEB_LLM_CHUNK', requestId, chunk }, origin);
      }
      const tail = decoder.decode();
      if (tail) {
        window.postMessage({ type: 'WEB_LLM_CHUNK', requestId, chunk: tail }, origin);
      }
      window.postMessage({ type: 'WEB_LLM_DONE', requestId }, origin);
    }
  } catch (err) {
    window.postMessage(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: err instanceof Error ? err.message : String(err),
      },
      origin,
    );
  } finally {
    clearInterval(keepAliveInterval);
  }
};
