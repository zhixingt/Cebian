// 探针 3：raw CDP 给 sidepanel page target 注入 JS
const WebSocket = require('ws');
const http = require('http');

function getList() {
  return new Promise((res) => {
    http.get('http://127.0.0.1:9337/json/list', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); });
  });
}

(async () => {
  const targets = await getList();
  console.log('=== All targets ===');
  for (const t of targets) console.log('-', t.type, '|', t.url);

  // 选 sidepanel target
  const side = targets.find(t => t.url.includes('nkeimhogjdpnpccoofpliimaahmaaome/sidepanel.html'));
  if (!side) { console.log('NO_SIDEPANEL_TARGET'); return; }
  console.log('Connecting to:', side.webSocketDebuggerUrl);

  const ws = new WebSocket(side.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) {
      // console.log('[event]', m.method, JSON.stringify(m.params).substring(0, 200));
    }
  });
  const send = (method, params={}) => new Promise(res => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({id: myId, method, params}));
  });

  // 等 5 秒让页面加载
  await new Promise(r => setTimeout(r, 5000));

  // 启用 Runtime
  await send('Runtime.enable');

  // 1. 查页面 URL + chrome.runtime.id
  const r1 = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ url: location.href, title: document.title, hasChrome: typeof chrome !== 'undefined', runtimeId: (typeof chrome !== 'undefined') ? (chrome.runtime?.id || 'no-id') : 'no-chrome', hasStorage: !!(chrome?.storage?.local), hasSendMessage: !!(chrome?.runtime?.sendMessage) })`,
    returnByValue: true,
  });
  console.log('Page state:', r1.result?.result?.value);

  // 2. 读 storage.local
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => { try { const all = await chrome.storage.local.get(null); return JSON.stringify({ keys: Object.keys(all), activeModel: all['local:activeModel'] || all.activeModel, webProviders: all['webProviders'] || 'not-direct' }); } catch(e) { return 'ERR: ' + e.message; } })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('Storage:', r2.result?.result?.value);

  // 3. 等 3 秒看是否有 storage write
  await new Promise(r => setTimeout(r, 3000));
  const r3 = await send('Runtime.evaluate', {
    expression: `(async () => { try { const all = await chrome.storage.local.get(null); return JSON.stringify({ keys: Object.keys(all), count: Object.keys(all).length }); } catch(e) { return 'ERR: ' + e.message; } })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('Storage after 3s:', r3.result?.result?.value);

  ws.close();
})().catch(e => console.error('ERR:', e.message));
