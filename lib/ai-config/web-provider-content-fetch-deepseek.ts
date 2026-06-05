/**
 * ⑪.2 DeepSeek MAIN-world content-script adapter.
 *
 * Flow (mirrors chromeclaw's content-fetch-deepseek.ts):
 *  1. Read bearer token from localStorage['userToken'] (with fallbacks)
 *  2. fetch POST /api/v0/chat_session/create → get chat_session_id
 *  3. fetch POST /api/v0/chat/create_pow_challenge → get PoW challenge
 *  4. Solve PoW (sha256 path) — DeepSeekHashV1 will surface as a clear
 *     "unsupported algorithm" error so the bridge can ask the user to retry
 *     after a page reload (V1 needs WASM solver which we add in a follow-up).
 *  5. fetch POST /api/v0/chat/completion with x-ds-pow-response header →
 *     stream SSE chunks back via window.postMessage.
 *
 * Self-contained — chrome.scripting.executeScript serializes only the
 * function body, no module-scope imports survive.
 */
import type { ContentFetchRequest } from './web-provider-content-fetch-main';

export const deepseekMainWorldFetch = async (request: ContentFetchRequest): Promise<void> => {
  const { requestId, init } = request;
  const origin = window.location.origin;

  // ⑫ FIX: cross-world messaging via document CustomEvent
  // (window.postMessage doesn't cross the MAIN↔ISOLATED world boundary)
  // ⑫ providerId must be in the event detail — the ISOLATED bridge
  // filters by data.providerId === installed-providerId, and drops
  // anything that doesn't match. We capture it from the request so
  // every postToBridge call automatically includes it.
  const postToBridge = (data: Record<string, unknown>, _origin?: string): void => {
    document.dispatchEvent(new CustomEvent('ceb-web-provider-message', {
      detail: { ...data, providerId: request.providerId },
    }));
  };

  // ── Step 1: Bearer token from localStorage ──
  const extractBearerToken = async (): Promise<string> => {
    let bearer = '';
    try {
      const raw = localStorage.getItem('userToken');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed === 'string') bearer = parsed;
          else if (typeof parsed === 'object' && parsed !== null) {
            bearer = parsed.token ?? parsed.value ?? parsed.access_token ?? parsed.jwt ?? '';
          }
        } catch {
          bearer = raw;
        }
      }
    } catch {
      /* ignore */
    }
    if (!bearer) {
      try {
        for (const key of ['token', 'ds_token', 'auth_token', 'access_token', 'jwt']) {
          const val = localStorage.getItem(key);
          if (val && val.length > 10) {
            try {
              const parsed = JSON.parse(val);
              if (typeof parsed === 'string' && parsed.length > 10) bearer = parsed;
              else if (typeof parsed === 'object' && parsed !== null) {
                bearer = parsed.token ?? parsed.value ?? '';
              }
            } catch {
              bearer = val;
            }
            if (bearer) break;
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (!bearer) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || key === 'userToken') continue;
          const lk = key.toLowerCase();
          if (lk.includes('token') || lk.includes('auth') || lk.includes('jwt') || lk.includes('bearer')) {
            const val = localStorage.getItem(key);
            if (val && val.length > 10) {
              try {
                const parsed = JSON.parse(val);
                if (typeof parsed === 'string' && parsed.length > 10) bearer = parsed;
                else if (typeof parsed === 'object' && parsed !== null) {
                  bearer = parsed.token ?? parsed.value ?? '';
                }
              } catch {
                bearer = val;
              }
              if (bearer) break;
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    return bearer;
  };

  // ── Step 2: Parse prompt + chat id from stub body ──
  let dsPrompt = '';
  let existingChatId = '';
  try {
    const bodyObj = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
      string,
      string
    >;
    dsPrompt = bodyObj.prompt ?? '';
    existingChatId = bodyObj.chatId ?? '';
  } catch {
    /* defaults */
  }

  const bearer = await extractBearerToken();
  if (!bearer) {
    let utPreview = '(none)';
    try {
      const ut = localStorage.getItem('userToken');
      if (ut) utPreview = `len=${ut.length}`;
    } catch {
      /* ignore */
    }
    postToBridge(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `No auth token found for DeepSeek. userToken: ${utPreview}. Please visit ${origin}, log in, then reconnect via Settings → Web Providers.`,
      },
      origin,
    );
    return;
  }

  // ── Step 3: Extract version from page globals (best-effort) ──
  let clientVersion = '1.7.0';
  let appVersion = '20241129.1';
  try {
    const meta = document.querySelector('meta[name="version"]');
    if (meta?.getAttribute('content')) {
      appVersion = meta.getAttribute('content')!;
    }
    const nextData = (window as unknown as Record<string, unknown>).__NEXT_DATA__ as
      | { buildId?: string }
      | undefined;
    if (nextData?.buildId) {
      appVersion = nextData.buildId;
    }
    const w = window as unknown as Record<string, unknown>;
    const appVer = w.__APP_VERSION__ as string | undefined;
    if (appVer) appVersion = appVer;
    const clientVer = w.__CLIENT_VERSION__ as string | undefined;
    if (clientVer) clientVersion = clientVer;
  } catch {
    /* use defaults */
  }

  const dsHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: '*/*',
    Referer: `${origin}/`,
    Origin: origin,
    'x-client-platform': 'web',
    'x-client-version': clientVersion,
    'x-app-version': appVersion,
    Authorization: `Bearer ${bearer}`,
  };

  // ── Step 4: Create chat session if needed ──
  let chatSessionId = existingChatId;
  if (!chatSessionId) {
    try {
      const createRes = await fetch(`${origin}/api/v0/chat_session/create`, {
        method: 'POST',
        headers: dsHeaders,
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!createRes.ok) {
        const authHint =
          createRes.status === 401 || createRes.status === 403
            ? ' Please visit the page to verify your account, then log out and log back in via Settings → Web Providers.'
            : '';
        postToBridge(
          {
            type: 'WEB_LLM_ERROR',
            requestId,
            error: `Chat session creation failed: HTTP ${createRes.status}${authHint}`,
          },
          origin,
        );
        return;
      }
      const sessionData = (await createRes.json()) as Record<string, unknown>;
      if (sessionData.code !== undefined && sessionData.code !== 0) {
        postToBridge(
          {
            type: 'WEB_LLM_ERROR',
            requestId,
            error: `Chat session error: code=${sessionData.code}, msg=${sessionData.msg ?? 'unknown'}`,
          },
          origin,
        );
        return;
      }
      const bizOuter = sessionData.data as Record<string, unknown> | undefined;
      const biz = (bizOuter?.biz_data ?? bizOuter) as Record<string, string> | undefined;
      chatSessionId = biz?.id ?? biz?.chat_session_id ?? '';
    } catch (err) {
      postToBridge(
        { type: 'WEB_LLM_ERROR', requestId, error: `Chat session error: ${String(err)}` },
        origin,
      );
      return;
    }
  }

  // ── Step 5: PoW challenge ──
  type PowChallenge = {
    algorithm: string;
    challenge: string;
    difficulty: number;
    salt: string;
    signature: string;
    expire_at?: number;
  };

  let powChallenge: PowChallenge;
  try {
    const powRes = await fetch(`${origin}/api/v0/chat/create_pow_challenge`, {
      method: 'POST',
      headers: dsHeaders,
      credentials: 'include',
      body: JSON.stringify({ target_path: '/api/v0/chat/completion' }),
    });
    if (!powRes.ok) {
      postToBridge(
        {
          type: 'WEB_LLM_ERROR',
          requestId,
          error: `PoW request failed: HTTP ${powRes.status}`,
        },
        origin,
      );
      return;
    }
    const powData = (await powRes.json()) as Record<string, unknown>;
    if (powData.code !== undefined && powData.code !== 0) {
      postToBridge(
        {
          type: 'WEB_LLM_ERROR',
          requestId,
          error: `PoW API error: code=${powData.code}, msg=${powData.msg ?? 'unknown'}`,
        },
        origin,
      );
      return;
    }
    const dataObj = powData.data as Record<string, unknown> | undefined;
    const biz = dataObj?.biz_data as Record<string, unknown> | undefined;
    let raw: unknown = (biz as Record<string, unknown> | undefined)?.challenge ?? dataObj?.challenge ?? powData.challenge;
    if ((!raw || typeof raw !== 'object') && (biz as Record<string, unknown> | undefined)?.algorithm && (biz as Record<string, unknown> | undefined)?.salt) {
      raw = biz;
    }
    if (!raw || typeof raw !== 'object') {
      postToBridge(
        {
          type: 'WEB_LLM_ERROR',
          requestId,
          error: `PoW challenge missing in response`,
        },
        origin,
      );
      return;
    }
    const c = raw as Record<string, unknown>;
    if (
      typeof c.algorithm !== 'string' ||
      typeof c.challenge !== 'string' ||
      typeof c.difficulty !== 'number' ||
      typeof c.salt !== 'string' ||
      typeof c.signature !== 'string'
    ) {
      postToBridge(
        { type: 'WEB_LLM_ERROR', requestId, error: `PoW challenge missing required fields` },
        origin,
      );
      return;
    }
    powChallenge = c as unknown as PowChallenge;
  } catch (err) {
    postToBridge(
      { type: 'WEB_LLM_ERROR', requestId, error: `PoW challenge error: ${String(err)}` },
      origin,
    );
    return;
  }

  // ── Step 6: Solve PoW ──
  const solveSha256Pow = async (
    salt: string,
    challenge: string,
    difficulty: number,
  ): Promise<number> => {
    const targetDifficulty = difficulty > 64 ? Math.floor(Math.log2(difficulty)) : difficulty;
    const encoder = new TextEncoder();
    for (let nonce = 0; nonce < 1_000_000; nonce++) {
      const hashBuf = await crypto.subtle.digest(
        'SHA-256',
        encoder.encode(salt + challenge + nonce),
      );
      const hashArr = new Uint8Array(hashBuf);
      const hex = Array.from(hashArr, b => b.toString(16).padStart(2, '0')).join('');
      let zeroBits = 0;
      for (const ch of hex) {
        const val = parseInt(ch, 16);
        if (val === 0) zeroBits += 4;
        else {
          zeroBits += Math.clz32(val) - 28;
          break;
        }
      }
      if (zeroBits >= targetDifficulty) return nonce;
    }
    return -1;
  };

  let powAnswer: number;
  if (powChallenge.algorithm === 'sha256') {
    powAnswer = await solveSha256Pow(
      powChallenge.salt,
      powChallenge.challenge,
      powChallenge.difficulty,
    );
  } else if (powChallenge.algorithm === 'DeepSeekHashV1') {
    // WASM solver not bundled yet — ask the user to reload and retry.
    postToBridge(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `Unsupported PoW algorithm: ${powChallenge.algorithm}. DeepSeekHashV1 requires a WASM solver that is not bundled yet. Please reload the DeepSeek page and retry — if the algorithm rotates to sha256, the request will succeed.`,
      },
      origin,
    );
    return;
  } else {
    postToBridge(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `Unsupported PoW algorithm: ${powChallenge.algorithm}`,
      },
      origin,
    );
    return;
  }

  if (powAnswer < 0) {
    postToBridge(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `PoW solve failed (${powChallenge.algorithm})`,
      },
      origin,
    );
    return;
  }

  const powResponse = btoa(
    JSON.stringify({
      ...powChallenge,
      answer: powAnswer,
      target_path: '/api/v0/chat/completion',
    }),
  );

  // ── Step 7: Send completion request (SSE) ──
  const dsResponse = await fetch(`${origin}/api/v0/chat/completion`, {
    method: 'POST',
    headers: {
      ...dsHeaders,
      'x-ds-pow-response': powResponse,
    },
    credentials: 'include',
    body: JSON.stringify({
      chat_session_id: chatSessionId,
      parent_message_id: null,
      prompt: dsPrompt,
      ref_file_ids: [],
      thinking_enabled: true,
      search_enabled: false,
      preempt: false,
    }),
  });

  if (!dsResponse.ok) {
    postToBridge(
      {
        type: 'WEB_LLM_ERROR',
        requestId,
        error: `HTTP ${dsResponse.status}: ${dsResponse.statusText}`,
      },
      origin,
    );
    return;
  }

  const dsReader = dsResponse.body?.getReader();
  if (!dsReader) {
    postToBridge(
      { type: 'WEB_LLM_ERROR', requestId, error: 'No response body from DeepSeek' },
      origin,
    );
    return;
  }

  if (chatSessionId) {
    const idChunk = `data: ${JSON.stringify({ type: 'deepseek:chat_session_id', chat_session_id: chatSessionId })}\n\n`;
    postToBridge({ type: 'WEB_LLM_CHUNK', requestId, chunk: idChunk }, origin);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await dsReader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (buffer.includes('\n')) {
      const lineEnd = buffer.indexOf('\n');
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (line.startsWith('data: ')) {
        postToBridge(
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
      postToBridge({ type: 'WEB_LLM_CHUNK', requestId, chunk: `${line}\n\n` }, origin);
    }
  }
  if (buffer.trim().startsWith('data: ')) {
    postToBridge(
      { type: 'WEB_LLM_CHUNK', requestId, chunk: `${buffer.trim()}\n\n` },
      origin,
    );
  }
  postToBridge({ type: 'WEB_LLM_DONE', requestId }, origin);
};
