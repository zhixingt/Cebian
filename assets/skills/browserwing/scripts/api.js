/**
 * BrowserWing API wrapper - 统一封装 HTTP 调用，供 run_skill 使用。
 *
 * 入参 (args):
 *   - action: string  必选，对应下方 switch 分支
 *   - 其余字段随 action 变化（见各分支的解构）
 *
 * 返回值: BrowserWing JSON 响应体
 */

const BASE_URL = 'http://127.0.0.1:8080/api/v1/executor';

async function bwRequest(endpoint, body, method) {
  const url = BASE_URL + endpoint;
  const init = {
    method: method || 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }
  const resp = await bgFetch(url, init);
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(
      `BrowserWing ${endpoint} failed: HTTP ${resp.status} - ${data.detail || data.message || text}`
    );
  }
  return data;
}

const { action } = args;

switch (action) {
  // ===== Navigation =====
  case 'navigate': {
    const { url } = args;
    if (!url) throw new Error('navigate requires "url"');
    module.exports = await bwRequest('/navigate', { url });
    break;
  }

  case 'goBack': {
    module.exports = await bwRequest('/go-back');
    break;
  }

  case 'goForward': {
    module.exports = await bwRequest('/go-forward');
    break;
  }

  case 'reload': {
    module.exports = await bwRequest('/reload');
    break;
  }

  // ===== Element Interaction =====
  case 'snapshot': {
    module.exports = await bwRequest('/snapshot', null, 'GET');
    break;
  }

  case 'click': {
    const { identifier } = args;
    if (!identifier) throw new Error('click requires "identifier"');
    module.exports = await bwRequest('/click', { identifier });
    break;
  }

  case 'type': {
    const { identifier, text } = args;
    if (!identifier || text === undefined) throw new Error('type requires "identifier" and "text"');
    module.exports = await bwRequest('/type', { identifier, text });
    break;
  }

  case 'select': {
    const { identifier, value } = args;
    if (!identifier || value === undefined) throw new Error('select requires "identifier" and "value"');
    module.exports = await bwRequest('/select', { identifier, value });
    break;
  }

  case 'hover': {
    const { identifier } = args;
    if (!identifier) throw new Error('hover requires "identifier"');
    module.exports = await bwRequest('/hover', { identifier });
    break;
  }

  case 'pressKey': {
    const { key } = args;
    if (!key) throw new Error('pressKey requires "key"');
    module.exports = await bwRequest('/press-key', { key });
    break;
  }

  case 'wait': {
    const { identifier, state, timeout } = args;
    if (!identifier || !state) throw new Error('wait requires "identifier" and "state"');
    module.exports = await bwRequest('/wait', { identifier, state, timeout });
    break;
  }

  // ===== Data Extraction =====
  case 'extract': {
    const { selector, fields, multiple } = args;
    if (!selector) throw new Error('extract requires "selector"');
    module.exports = await bwRequest('/extract', { selector, fields, multiple });
    break;
  }

  case 'getText': {
    const { identifier } = args;
    if (!identifier) throw new Error('getText requires "identifier"');
    module.exports = await bwRequest('/get-text', { identifier });
    break;
  }

  case 'getValue': {
    const { identifier } = args;
    if (!identifier) throw new Error('getValue requires "identifier"');
    module.exports = await bwRequest('/get-value', { identifier });
    break;
  }

  case 'pageInfo': {
    module.exports = await bwRequest('/page-info', null, 'GET');
    break;
  }

  case 'pageText': {
    module.exports = await bwRequest('/page-text', null, 'GET');
    break;
  }

  case 'pageContent': {
    module.exports = await bwRequest('/page-content', null, 'GET');
    break;
  }

  // ===== Page Analysis =====
  case 'clickableElements': {
    module.exports = await bwRequest('/clickable-elements', null, 'GET');
    break;
  }

  case 'inputElements': {
    module.exports = await bwRequest('/input-elements', null, 'GET');
    break;
  }

  // ===== Advanced Operations =====
  case 'screenshot': {
    const { fullPage } = args;
    module.exports = await bwRequest('/screenshot', { fullPage });
    break;
  }

  case 'evaluate': {
    const { expression } = args;
    if (!expression) throw new Error('evaluate requires "expression"');
    module.exports = await bwRequest('/evaluate', { expression });
    break;
  }

  case 'batch': {
    const { operations } = args;
    if (!Array.isArray(operations)) throw new Error('batch requires "operations" array');
    module.exports = await bwRequest('/batch', { operations });
    break;
  }

  case 'fillForm': {
    const { url, data } = args;
    if (!url || !data) throw new Error('fillForm requires "url" and "data"');
    module.exports = await bwRequest('/fill-form', { url, data });
    break;
  }

  case 'scrollToBottom': {
    module.exports = await bwRequest('/scroll-to-bottom');
    break;
  }

  case 'resize': {
    const { width, height } = args;
    if (!width || !height) throw new Error('resize requires "width" and "height"');
    module.exports = await bwRequest('/resize', { width, height });
    break;
  }

  case 'tabs': {
    const { action: tabAction, ...tabParams } = args;
    if (!tabAction) throw new Error('tabs requires "action"');
    module.exports = await bwRequest('/tabs', { action: tabAction, ...tabParams });
    break;
  }

  // ===== Monitoring & Debug =====
  case 'consoleMessages': {
    const { clear } = args;
    module.exports = await bwRequest('/console-messages', { clear }, 'GET');
    break;
  }

  case 'networkRequests': {
    const { clear } = args;
    module.exports = await bwRequest('/network-requests', { clear }, 'GET');
    break;
  }

  case 'handleDialog': {
    const { accept, promptText } = args;
    module.exports = await bwRequest('/handle-dialog', { accept, promptText });
    break;
  }

  case 'fileUpload': {
    const { selector, filePath } = args;
    if (!selector || !filePath) throw new Error('fileUpload requires "selector" and "filePath"');
    module.exports = await bwRequest('/file-upload', { selector, filePath });
    break;
  }

  case 'drag': {
    const { source, target } = args;
    if (!source || !target) throw new Error('drag requires "source" and "target"');
    module.exports = await bwRequest('/drag', { source, target });
    break;
  }

  case 'closePage': {
    module.exports = await bwRequest('/close-page');
    break;
  }

  // ===== Help =====
  case 'help': {
    const { command } = args;
    const endpoint = command ? `/help?command=${encodeURIComponent(command)}` : '/help';
    module.exports = await bwRequest(endpoint, null, 'GET');
    break;
  }

  default:
    throw new Error(
      `Unknown action "${action}". Supported: navigate, goBack, goForward, reload, snapshot, click, type, select, hover, pressKey, wait, extract, getText, getValue, pageInfo, pageText, pageContent, clickableElements, inputElements, screenshot, evaluate, batch, fillForm, scrollToBottom, resize, tabs, consoleMessages, networkRequests, handleDialog, fileUpload, drag, closePage, help`
    );
}
