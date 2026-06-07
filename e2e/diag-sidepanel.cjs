// E2E 诊断：捕获所有 SW 消息 + 看最后 5 个流事件
const orig = window.chrome?.runtime?.onMessage;
console.log('=== BEFORE ===');
console.log('Has chrome.runtime?', !!window.chrome?.runtime);

// 监听
if (window.chrome?.runtime?.onMessage?.addListener) {
  const handler = (msg, sender, sendResponse) => {
    console.log('[chrome.runtime.onMessage]', msg?.type, msg?.error || msg?.chunk || msg?.eventType || JSON.stringify(msg).substring(0, 200));
  };
  window.chrome.runtime.onMessage.addListener(handler);
  console.log('Listener registered');
}

// 看最近 sidepanel 状态
const last5 = (await chrome.storage.local.get(null))['local:webProviders'];
console.log('=== webProviders (last value) ===', JSON.stringify(last5, null, 2));
