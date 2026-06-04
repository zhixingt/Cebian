// pw-content-fetch-e2e-v3.cjs
// Clean version of v2:
//  1. Tag each run with a unique runId; filter out stale listeners
//  2. Wrap window.fetch + Response to log the actual request/response
//  3. Log kimi-auth cookie presence before calling the adapter
//  4. Print a clear verdict per provider

const PW_PATH = 'D:/Project/CebianX/cebian-web-provider/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core';
const { chromium } = require(PW_PATH);
const fs = require('node:fs');

const CDP_URL = 'http://127.0.0.1:9333';
const BUNDLE_PATH = 'D:/Project/CebianX/cebian-web-provider/.output/chrome-mv3/background.js';
const PROVIDER_LOGIN_URLS = {
  deepseek: 'https://chat.deepseek.com/',
  kimi: 'https://www.kimi.com/',
  glm: 'https://chatglm.cn/',
};
const TIMEOUT_MS = 25_000;

/**
 * Auto-detect adapter function symbols from the mainWorldFetchByProvider
 * dispatch table. The table has the shape:
 *   <sym>={deepseek:{request:{type:`WEB_LLM_FETCH`},func:wyt},kimi:{...func:Tyt},glm:{...func:Ryt}}
 * Find each provider's func symbol independently (avoids needing to match
 * nested braces in a single regex).
 */
function detectAdapterSymbols(bundle) {
  // The dispatch table is the unique location of the pattern
  //   <provider>:{request:{type:`WEB_LLM_FETCH`},func:<symbol>}
  // (the backtick string `WEB_LLM_FETCH` and the literal `request:` key
  // are specific to mainWorldFetchByProvider — no other code uses them).
  const find = (providerName) => {
    const re = new RegExp(
      `\\b${providerName}:\\s*\\{\\s*request:\\s*\\{[^}]+\\}\\s*,\\s*func:\\s*(\\w+)\\s*\\}`,
      's',
    );
    const m = bundle.match(re);
    return m ? m[1] : null;
  };
  const deepseek = find('deepseek');
  const kimi = find('kimi');
  const glm = find('glm');
  if (!deepseek || !kimi || !glm) return null;
  return { deepseek, kimi, glm };
}

function extractAdapterSource(bundle, symbol) {
  const re = new RegExp(`\\b${symbol}\\s*=\\s*async\\s*(?:\\(?e\\)?\\s*=>|function\\s*\\(?e\\)?\\s*\\{)`, 'g');
  const m = re.exec(bundle);
  if (!m) return null;
  let i = bundle.indexOf('{', m.index);
  if (i < 0) return null;
  let depth = 0;
  let start = i;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let j = i; j < bundle.length; j++) {
    const c = bundle[j];
    const next = bundle[j + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; j++; } continue; }
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && next === '/') { inLineComment = true; j++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return `async (e) => { ${bundle.slice(start, j + 1)} }`; }
  }
  return null;
}

async function runProviderE2E(page, providerId, adapterSource) {
  const result = { provider: providerId, url: page.url(), events: [], requests: [], responses: [], summary: null };
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    // Install CLEAN observer with runId tagging
    await page.evaluate((rid) => {
      // Wipe any previous run state
      try { window.__cebPrevObserver && window.removeEventListener('message', window.__cebPrevObserver); } catch {}
      window.__cebE2EEvents = [];
      window.__cebE2ERunId = rid;
      const obs = (ev) => {
        if (!ev.data || typeof ev.data !== 'object') return;
        if (typeof ev.data.type === 'string' && ev.data.type.startsWith('WEB_LLM_')) {
          const d = { runId: rid, ...ev.data };
          if (typeof d.chunk === 'string' && d.chunk.length > 300) {
            d.chunk = d.chunk.slice(0, 300) + `... [truncated ${d.chunk.length - 300} chars]`;
          }
          window.__cebE2EEvents.push(d);
        }
      };
      window.__cebPrevObserver = obs;
      window.addEventListener('message', obs);

      // Wrap fetch to log requests. We RE-WRAP on every run (not just once)
      // because the wrapper closure captures `rid` — if we skip re-wrapping,
      // the closure's `rid` is from the first test run, and the per-run
      // filter at read time would drop the current run's requests.
      // The previous wrapper (if any) is captured as `__cebPrevFetch` and
      // we delegate to it, so we don't break nested wrapping.
      const prevFetch = window.__cebFetchWrapped ? window.fetch : null;
      const origFetch = prevFetch || window.fetch;
      window.fetch = function (...args) {
        const [url, init] = args;
        const reqInfo = { runId: rid, url: typeof url === 'string' ? url : url.url, method: (init && init.method) || 'GET', headers: init && init.headers ? JSON.parse(JSON.stringify(init.headers)) : undefined, bodyPreview: undefined, ts: Date.now() };
        if (init && init.body) {
          if (typeof init.body === 'string') reqInfo.bodyPreview = init.body.length > 200 ? init.body.slice(0, 200) + '...' : init.body;
          else if (init.body instanceof ArrayBuffer) reqInfo.bodyPreview = `[ArrayBuffer ${init.body.byteLength}B]`;
          else reqInfo.bodyPreview = `[${typeof init.body}]`;
        }
        window.__cebRequests = window.__cebRequests || [];
        window.__cebRequests.push(reqInfo);
        return origFetch.apply(this, args).then((resp) => {
          const respInfo = { runId: rid, status: resp.status, statusText: resp.statusText, url: reqInfo.url, contentType: resp.headers.get('content-type') || '', bodyPreview: undefined, ts: Date.now() };
          window.__cebResponses = window.__cebResponses || [];
          window.__cebResponses.push(respInfo);
          // ⑪.7: Clone the response and read the first 500 bytes for diagnosis.
          // The adapter still gets the original `resp` (so its reader works).
          // .clone() reads the body without consuming the original stream.
          if (resp.body && typeof resp.clone === 'function') {
            resp.clone().text().then((text) => {
              const len = text.length;
              respInfo.bodyLength = len;
              respInfo.bodyPreview = len > 500 ? text.slice(0, 500) + `... [+${len - 500} chars]` : text;
              // Replace the pushed entry so the read-back at end-of-test sees the body
              const idx = window.__cebResponses.findIndex((r) => r === respInfo);
              if (idx >= 0) window.__cebResponses[idx] = { ...respInfo };
            }).catch(() => { /* ignore */ });
          }
          return resp;
        });
      };
      window.__cebFetchWrapped = true;
    }, runId);

    // Probe cookies (for kimi-auth, chatglm_token, userToken) BEFORE the call
    const cookies = await page.evaluate(() => {
      const out = {};
      const all = document.cookie || '';
      for (const m of all.matchAll(/(?:^|;\s*)([^=]+)=([^;]*)/g)) {
        out[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
      }
      return out;
    });
    result.cookies = cookies;

    // ⑪.7: Probe ALL cookies (including HttpOnly) via Playwright's
    // context.cookies() API — the SW uses the same chrome.cookies.getAll
    // to read HttpOnly cookies like Kimi's `kimi-auth`. document.cookie
    // (above) can't see HttpOnly, so we need this second probe to
    // simulate the SW's view.
    const allCookies = await page.context().cookies(...(function () {
      if (providerId === 'kimi') return ['https://www.kimi.com'];
      if (providerId === 'glm') return ['https://chatglm.cn'];
      if (providerId === 'deepseek') return ['https://chat.deepseek.com'];
      return [];
    })());
    result.allCookies = allCookies.map(c => ({ name: c.name, httpOnly: c.httpOnly, len: c.value.length }));

    // For Kimi, extract `kimi-auth` from the full cookie list and add
    // it as `authHeader` on the stub request — simulating what the SW
    // will do at runtime via chrome.cookies.getAll.
    let authHeader = null;
    if (providerId === 'kimi') {
      const kimiAuth = allCookies.find(c => c.name === 'kimi-auth')?.value;
      if (kimiAuth) authHeader = `Bearer ${kimiAuth}`;
      result.authHeader = authHeader ? 'present' : 'absent';
    }

    // Build stub request
    const stub = {
      type: 'WEB_LLM_FETCH',
      requestId: runId,
      url: '',
      init: { method: 'POST', body: JSON.stringify({ prompt: '你好', chatId: '' }) },
      ...(authHeader ? { authHeader } : {}),
    };

    // Call adapter
    const callExpr = `
      (async () => {
        const __adapter = ${adapterSource};
        try {
          await __adapter(${JSON.stringify(stub)});
        } catch (err) {
          window.__cebE2EEvents.push({
            runId: ${JSON.stringify(runId)},
            type: 'WEB_LLM_CLIENT_EXCEPTION',
            requestId: ${JSON.stringify(runId)},
            error: (err && err.message) || String(err),
          });
        }
      })()
    `;
    await page.evaluate(callExpr);

    await page.waitForTimeout(TIMEOUT_MS);

    // Read events (filter to current runId) + requests + responses
    const collected = await page.evaluate((rid) => {
      return {
        events: (window.__cebE2EEvents || []).filter(e => e.runId === rid),
        requests: (window.__cebRequests || []).filter(r => r.runId === rid),
        responses: (window.__cebResponses || []).filter(r => r.runId === rid),
      };
    }, runId);

    result.events = collected.events;
    result.requests = collected.requests;
    result.responses = collected.responses;

    const chunkCount = result.events.filter(e => e.type === 'WEB_LLM_CHUNK').length;
    const done = result.events.find(e => e.type === 'WEB_LLM_DONE');
    const error = result.events.find(e => e.type === 'WEB_LLM_ERROR' || e.type === 'WEB_LLM_CLIENT_EXCEPTION');
    const firstChunk = result.events.find(e => e.type === 'WEB_LLM_CHUNK')?.chunk;
    result.summary = {
      chunkCount,
      done: !!done,
      error: error ? error.error : null,
      firstChunkPreview: firstChunk,
      requestCount: result.requests.length,
      responseStatuses: result.responses.map(r => r.status),
    };
  } catch (err) {
    result.fatal = err && err.message ? err.message : String(err);
  }
  return result;
}

(async () => {
  const t0 = Date.now();
  console.log('[e2e] reading bundle…');
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
  console.log(`[e2e] bundle: ${(bundle.length / 1024).toFixed(0)} KB`);

  const adapterSyms = detectAdapterSymbols(bundle);
  if (!adapterSyms) { console.error('[e2e] FATAL: dispatch table not found in bundle'); process.exit(1); }
  console.log(`[e2e] auto-detected dispatch ${adapterSyms._dispatchSymbol} = { deepseek:${adapterSyms.deepseek}, kimi:${adapterSyms.kimi}, glm:${adapterSyms.glm} }`);

  const adapters = {};
  for (const providerId of ['deepseek', 'kimi', 'glm']) {
    const symbol = adapterSyms[providerId];
    const src = extractAdapterSource(bundle, symbol);
    if (!src) { console.error(`[e2e] FATAL: cannot extract ${providerId} (${symbol})`); process.exit(1); }
    adapters[providerId] = src;
    console.log(`[e2e] ${providerId} (${symbol}): ${src.length} chars`);
  }

  console.log(`[e2e] connecting to CDP at ${CDP_URL}…`);
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();
  const findByPattern = (re) => pages.find(p => re.test(p.url()));
  let dsPage = findByPattern(/^https?:\/\/(www\.)?chat\.deepseek\.com\//);
  let kimiPage = findByPattern(/^https?:\/\/(www\.)?kimi\.com\/chat\//);
  let glmPage = findByPattern(/^https?:\/\/(www\.)?chatglm\.cn\//);

  if (!dsPage) { dsPage = await context.newPage(); try { await dsPage.goto(PROVIDER_LOGIN_URLS.deepseek, { waitUntil: 'domcontentloaded', timeout: 15_000 }); } catch (e) {} }
  if (!glmPage) { glmPage = await context.newPage(); try { await glmPage.goto(PROVIDER_LOGIN_URLS.glm, { waitUntil: 'domcontentloaded', timeout: 15_000 }); } catch (e) {} }
  if (!kimiPage) { kimiPage = await context.newPage(); try { await kimiPage.goto(PROVIDER_LOGIN_URLS.kimi, { waitUntil: 'domcontentloaded', timeout: 15_000 }); } catch (e) {} }

  const results = {};
  for (const [providerId, page] of [
    ['kimi', kimiPage],
    ['glm', glmPage],
    ['deepseek', dsPage],
  ]) {
    if (!page) { results[providerId] = { provider: providerId, fatal: 'no page' }; continue; }
    console.log(`\n[e2e] === ${providerId.toUpperCase()} ===`);
    console.log(`[e2e] url: ${page.url()}`);
    const r = await runProviderE2E(page, providerId, adapters[providerId]);
    results[providerId] = r;
    const s = r.summary;
    if (s) {
      console.log(`[e2e] ${providerId}: cookies=${Object.keys(r.cookies || {}).join(',') || '(none)'}`);
      console.log(`[e2e] ${providerId}: reqs=${s.requestCount} resp_statuses=${s.responseStatuses.join(',') || '(none)'} chunks=${s.chunkCount} done=${s.done} error=${s.error || 'none'}`);
      if (s.firstChunkPreview) console.log(`[e2e] ${providerId} first chunk: ${s.firstChunkPreview.slice(0, 240)}`);
    } else {
      console.log(`[e2e] ${providerId}: no summary (fatal=${r.fatal || 'n/a'})`);
    }
  }

  // Detail dump
  console.log('\n[e2e] === REQUEST DUMP (per provider) ===');
  for (const providerId of ['kimi', 'glm', 'deepseek']) {
    const r = results[providerId];
    if (!r || !r.requests || r.requests.length === 0) {
      console.log(`\n[${providerId}] (no requests captured)`);
      continue;
    }
    console.log(`\n[${providerId}] ${r.requests.length} request(s):`);
    for (let i = 0; i < r.requests.length; i++) {
      const q = r.requests[i];
      const resp = r.responses[i];
      console.log(`  [req ${i}] ${q.method} ${q.url}`);
      if (q.headers) console.log(`         headers: ${JSON.stringify(q.headers).slice(0, 280)}`);
      if (q.bodyPreview) console.log(`         body: ${JSON.stringify(q.bodyPreview).slice(0, 200)}`);
      if (resp) {
        let bodyInfo = '';
        if (typeof resp.bodyLength === 'number') {
          bodyInfo = `  bodyLen=${resp.bodyLength}`;
          if (resp.bodyPreview) bodyInfo += `  bodyPreview=${JSON.stringify(resp.bodyPreview).slice(0, 400)}`;
        }
        console.log(`         → ${resp.status} ${resp.statusText} (${resp.contentType})${bodyInfo}`);
      }
    }
  }

  console.log('\n[e2e] === EVENT LOG (per provider) ===');
  for (const providerId of ['kimi', 'glm', 'deepseek']) {
    const r = results[providerId];
    if (!r || !r.events || r.events.length === 0) {
      console.log(`\n[${providerId}] (no events)`);
      continue;
    }
    console.log(`\n[${providerId}] ${r.events.length} event(s):`);
    for (let i = 0; i < Math.min(6, r.events.length); i++) {
      const e = r.events[i];
      console.log(`  [ev ${i}] ${e.type}${e.error ? ` err=${JSON.stringify(e.error).slice(0, 180)}` : ''}`);
      if (e.chunk) console.log(`         chunk=${JSON.stringify(e.chunk).slice(0, 240)}`);
    }
    if (r.events.length > 6) console.log(`  ... +${r.events.length - 6} more`);
  }

  // Verdict
  console.log('\n[e2e] === VERDICT ===');
  let allOk = true;
  for (const providerId of ['kimi', 'glm', 'deepseek']) {
    const r = results[providerId];
    const s = r.summary;
    const ok = s && s.chunkCount > 0 && s.done && !s.error;
    const tag = ok ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${providerId}: ${tag}${s && s.error ? ` — ${s.error.slice(0, 200)}` : ''}`);
    if (!ok) allOk = false;
  }
  console.log(`\n[e2e] TOTAL: ${((Date.now() - t0) / 1000).toFixed(1)}s — ${allOk ? 'ALL 3 GREEN' : 'failures'}`);

  await browser.close();
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('[e2e] FATAL', e); process.exit(1); });
