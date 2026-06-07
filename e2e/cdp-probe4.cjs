// 探针 5：在 about:blank 里加载扩展 sidepanel 触发 SW
const WebSocket = require('ws');
const http = require('http');

function getList() {
  return new Promise((res) => {
    http.get('http://127.0.0.1:9333/json/list', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); });
  });
}

(async () => {
  const targets = await getList();
  const page = targets.find(t => t.type === 'page' && t.url.startsWith('about:blank'));
  if (!page) { console.log('NO_PAGE'); return; }
  console.log('Connecting to:', page.webSocketDebuggerUrl);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) {
      events.push(m);
    }
  });
  const send = (method, params={}) => new Promise(res => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({id: myId, method, params}));
  });

  await send('Runtime.enable');
  await send('Page.enable');

  // 直接导航到 sidepanel（headless 模式下应该可以）
  console.log('\nNavigating to sidepanel.html...');
  await send('Page.navigate', { url: 'chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome/sidepanel.html' });
  await new Promise(r => setTimeout(r, 3000));

  // 查 targets 是否出现
  const targets2 = await getList();
  console.log('Targets after nav:');
  for (const t of targets2) console.log('-', t.type, '|', t.url);

  // 1. 在当前 page 查 chrome API
  const r1 = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ url: location.href, hasChrome: typeof chrome !== 'undefined', runtimeId: chrome?.runtime?.id })`,
    returnByValue: true,
  });
  console.log('\n1. Page state:', r1.result?.result?.value);

  // 2. 读 storage
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => { try { const all = await chrome.storage.local.get(null); return JSON.stringify({ count: Object.keys(all).length, keys: Object.keys(all) }); } catch(e) { return 'ERR: ' + e.message; } })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('2. storage keys:', r2.result?.result?.value);

  // 3. ping SW
  const r3 = await send('Runtime.evaluate', {
    expression: `new Promise(resolve => { try { chrome.runtime.sendMessage({ type: 'PING' }, r => { try { resolve('REPLY: ' + JSON.stringify(r).substring(0, 200)); } catch(e) { resolve('CB_ERR: ' + (chrome.runtime.lastError?.message || e.message)); } }); setTimeout(() => resolve('TIMEOUT'), 5000); } catch(e) { resolve('SEND_ERR: ' + e.message); } })`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('3. SW reply:', r3.result?.result?.value);

  // 4. 看 events
  console.log('\n=== Events received ===');
  for (const e of events) console.log('-', e.method);

  ws.close();
})().catch(e => console.error('ERR:', e.message));
