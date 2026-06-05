// devtools-capture.cjs — REUSABLE real-request capture tool
//
// Captures the actual API call a provider page makes (so we can diff
// against what our adapter sends). Works for any provider — just pass
// the tab URL pattern to match.
//
// Usage:
//   node scripts/devtools-capture.cjs                       # capture all active providers
//   node scripts/devtools-capture.cjs --provider chatglm.cn   # only GLM
//   node scripts/devtools-capture.cjs --out ./capture.json
//
// Connects to Chrome at CDP_URL (default http://127.0.0.1:9333),
// subscribes to Network.requestWillBeSent + Network.responseReceived,
// waits for the user to interact with the target page (or auto-types
// a probe message), then dumps every captured request to a JSON file.
//
// This is the tool that helped diagnose:
//   - Kimi: real request body shape (SCENARIO_K2D5, tools, parent_id)
//   - GLM/DeepSeek: world-boundary messaging issues
//   - DeepSeek: PoW algorithm rotation
//
// Run chrome with remote debugging first:
//   chrome.exe --remote-debugging-port=9333

const PW_PATH = 'D:/Project/CebianX/cebian-web-provider/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(PW_PATH);

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9333';
const args = process.argv.slice(2);
const providerArg = args.find(a => a.startsWith('--provider='))?.split('=')[1]
  || args[args.indexOf('--provider') + 1];
const outArg = args.find(a => a.startsWith('--out='))?.split('=')[1]
  || args[args.indexOf('--out') + 1]
  || path.join(process.cwd(), `capture-${Date.now()}.json`);
const waitMs = parseInt(args.find(a => a.startsWith('--wait='))?.split('=')[1]
  || args[args.indexOf('--wait') + 1] || '15000', 10);
const autoType = args.includes('--type');

const PROVIDER_TABS = [
  { id: 'kimi', pattern: /^https?:\/\/(www\.)?kimi\.com\/chat\//, urlMatch: 'kimi.gateway.chat' },
  { id: 'glm', pattern: /^https?:\/\/(www\.)?chatglm\.cn\//, urlMatch: 'chatglm' },
  { id: 'deepseek', pattern: /^https?:\/\/(www\.)?chat\.deepseek\.com\//, urlMatch: 'deepseek' },
];

(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const pages = context.pages();

  // Filter tabs by provider (if --provider given) or by open URL
  const targets = providerArg
    ? pages.filter(p => p.url().includes(providerArg))
    : pages.filter(p => PROVIDER_TABS.some(t => t.pattern.test(p.url())));

  if (targets.length === 0) {
    console.error('No matching tabs found. Open the provider page first.');
    process.exit(1);
  }

  console.log(`Found ${targets.length} target tab(s).`);
  for (const p of targets) console.log(`  - ${p.url()}`);

  // Subscribe to network events for each target
  const captured = {};
  for (const page of targets) {
    const provider = PROVIDER_TABS.find(t => t.pattern.test(page.url()));
    const providerId = provider?.id || 'unknown';
    captured[providerId] = [];

    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');

    cdp.on('Network.requestWillBeSent', (params) => {
      const url = params.request.url;
      if (provider?.urlMatch && !url.includes(provider.urlMatch)) return;
      // Only capture POST to API endpoints
      if (params.request.method !== 'POST') return;
      captured[providerId].push({
        phase: 'request',
        url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData,
        timestamp: params.timestamp,
        initiator: params.initiator,
      });
    });

    cdp.on('Network.responseReceived', (params) => {
      if (provider?.urlMatch && !params.response.url.includes(provider.urlMatch)) return;
      captured[providerId].push({
        phase: 'response',
        url: params.response.url,
        status: params.response.status,
        headers: params.response.headers,
        mimeType: params.response.mimeType,
      });
    });
  }

  if (autoType) {
    // Auto-interact: type a probe message in the first input found
    for (const page of targets) {
      try {
        const input = await page.$('div[contenteditable="true"], textarea, input[type="text"]');
        if (input) {
          await input.click();
          await page.keyboard.type('capture probe', { delay: 30 });
          await page.keyboard.press('Enter');
        }
      } catch (e) { /* ignore */ }
    }
  }

  console.log(`\nWaiting ${waitMs / 1000}s for network traffic${autoType ? ' (auto-typed probe)' : ''}...`);
  console.log('Tip: open the target provider page and send a message.');
  await new Promise(r => setTimeout(r, waitMs));

  // Dedupe by URL (keep only the last request for each unique URL)
  const deduped = {};
  for (const [pid, events] of Object.entries(captured)) {
    const byUrl = {};
    for (const e of events) {
      if (e.phase === 'request') byUrl[e.url] = e;
    }
    // Add response status by matching URL
    for (const e of events) {
      if (e.phase === 'response' && byUrl[e.url]) {
        byUrl[e.url].responseStatus = e.status;
        byUrl[e.url].responseHeaders = e.headers;
      }
    }
    deduped[pid] = Object.values(byUrl);
  }

  const out = {
    capturedAt: new Date().toISOString(),
    cdpUrl: CDP_URL,
    tabs: targets.map(p => p.url()),
    requests: deduped,
  };

  fs.writeFileSync(outArg, JSON.stringify(out, null, 2));
  console.log(`\n✓ Captured ${Object.values(deduped).reduce((a, b) => a + b.length, 0)} request(s) to ${outArg}`);
  for (const [pid, reqs] of Object.entries(deduped)) {
    console.log(`  ${pid}: ${reqs.length} request(s)`);
    for (const r of reqs) {
      console.log(`    ${r.method} ${r.url.slice(0, 80)}... (${r.responseStatus || 'pending'})`);
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
