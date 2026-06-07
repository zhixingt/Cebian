// 探针 4：headless 模式下注入 sidepanel 验证 chrome.storage
const WebSocket = require('ws');
const http = require('http');

function getList() {
  return new Promise((res) => {
    http.get('http://127.0.0.1:9333/json/list', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); });
  });
}

(async () => {
  const targets = await getList();
  console.log('=== All targets ===');
  for (const t of targets) console.log('-', t.type, '|', t.url);

  // 选 background page
  const bg = targets.find(t => t.type === 'background_page' && t.url.includes('nkeimhog'));
  if (!bg) { console.log('NO_BG'); return; }
  console.log('\nConnecting to BG:', bg.webSocketDebuggerUrl);

  const ws = new WebSocket(bg.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params={}) => new Promise(res => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({id: myId, method, params}));
  });

  await send('Runtime.enable');
  // 1. 基础状态
  const r1 = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ url: location.href, hasChrome: typeof chrome !== 'undefined', runtimeId: chrome?.runtime?.id, hasStorage: !!(chrome?.storage?.local), hasSendMessage: !!(chrome?.runtime?.sendMessage) })`,
    returnByValue: true,
  });
  console.log('\n1. Page state:', r1.result?.result?.value);

  if (!r1.result?.result?.value?.includes('"hasChrome":true')) {
    console.log('CHROME API NOT AVAILABLE in this target');
    ws.close();
    return;
  }

  // 2. 读 storage.local
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => { try { const all = await chrome.storage.local.get(null); return JSON.stringify({ count: Object.keys(all).length, keys: Object.keys(all) }); } catch(e) { return 'ERR: ' + e.message; } })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('2. storage.local keys:', r2.result?.result?.value);

  // 3. Ping SW
  const r3 = await send('Runtime.evaluate', {
    expression: `new Promise(resolve => { try { chrome.runtime.sendMessage({ type: 'WEB_PROVIDER_LIST' }, r => { try { resolve('REPLY: ' + JSON.stringify(r).substring(0, 300)); } catch(e) { resolve('CB_ERR: ' + e.message); } }); setTimeout(() => resolve('TIMEOUT'), 5000); } catch(e) { resolve('SEND_ERR: ' + e.message); } })`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('3. SW message reply:', r3.result?.result?.value);

  // 4. ping 一个不存在的消息类型，看 SW 是否响应（说明 SW 是活的）
  const r4 = await send('Runtime.evaluate', {
    expression: `new Promise(resolve => { try { chrome.runtime.sendMessage({ type: 'PING' }, r => { try { resolve('REPLY: ' + JSON.stringify(r).substring(0, 200)); } catch(e) { resolve('CB_ERR: ' + e.message + ' (lastErr: ' + chrome.runtime.lastError?.message + ')'); } }); setTimeout(() => resolve('TIMEOUT'), 3000); } catch(e) { resolve('SEND_ERR: ' + e.message); } })`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('4. SW ping reply:', r4.result?.result?.value);

  ws.close();
})().catch(e => console.error('ERR:', e.message));
