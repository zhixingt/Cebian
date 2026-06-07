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

  const side = targets.find(t => t.url.includes('sidepanel.html'));
  if (!side) { console.log('NO_SIDEPANEL_TARGET'); return; }
  console.log('Sidepanel WS:', side.webSocketDebuggerUrl);

  const ws = new WebSocket(side.webSocketDebuggerUrl);
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

  // 1. 查 chrome.runtime.id 是否能拿到
  const r1 = await send('Runtime.evaluate', {
    expression: `(() => { try { return JSON.stringify({ hasChrome: typeof chrome !== 'undefined', runtimeId: chrome?.runtime?.id, url: location.href, title: document.title, bodyLen: (document.body?.innerText||'').length }); } catch(e) { return 'ERR:' + e.message; } })()`,
    returnByValue: true,
  });
  console.log('runtime check:', r1.result?.result?.value);

  // 2. 读 chrome.storage.local 的所有 key
  const r2 = await send('Runtime.evaluate', {
    expression: `(async () => { try { const all = await chrome.storage.local.get(null); return JSON.stringify({ keys: Object.keys(all), sample: Object.fromEntries(Object.entries(all).slice(0,3)) }); } catch(e) { return 'ERR:' + e.message; } })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('storage.local:', r2.result?.result?.value);

  // 3. 查扩展是否能 ping SW
  const r3 = await send('Runtime.evaluate', {
    expression: `new Promise(resolve => { try { chrome.runtime.sendMessage({type:'PING'}, (resp) => { try { resolve('SW_REPLY: ' + JSON.stringify(resp)); } catch(e) { resolve('SW_ERR_CALLBACK: ' + e.message); } }); setTimeout(() => resolve('SW_TIMEOUT'), 5000); } catch(e) { resolve('SEND_ERR: ' + e.message); } })`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('SW ping:', r3.result?.result?.value);

  ws.close();
})().catch(e => console.error('ERR:', e.message));
