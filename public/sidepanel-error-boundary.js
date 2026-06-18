/**
 * sidepanel-error-boundary.js — Classic (non-module) error boundary script.
 *
 * Loaded via <script src> (NOT type="module") in sidepanel.html, BEFORE any
 * module scripts. Captures ALL unhandled errors (not just ReferenceError)
 * during both module loading and runtime, logs them to localStorage for
 * post-mortem analysis, and renders a recovery UI.
 */
window.__sidepanelCrash = null;
window.__sidepanelErrorLog = [];

// ─── Global cn() fallback for cross-chunk ReferenceError safety ───
//
// Rolldown code-splitting may separate lib/utils.ts (exporting cn) into
// its own chunk. Consumer chunks that call cn() can lose the ES module
// import during optimization → "ReferenceError: cn is not defined".
//
// This fallback is registered BEFORE any module script loads. The Vite
// plugin cebian:fix-cn-cross-chunk rewrites call sites from cn(...)
// to (__cebCn||cn)(...), so if the ES module import is available it's
// used; otherwise this fallback catches the call.
(function () {
  function clsx(a) {
    var r = [], args = arguments;
    for (var i = 0; i < args.length; i++) {
      var v = args[i];
      if (!v) continue;
      var t = typeof v;
      if (t === 'string' || t === 'number') { r.push(v); }
      else if (Array.isArray(v)) { r.push(clsx.apply(null, v)); }
      else if (t === 'object' && v !== null) {
        if (Object.prototype.toString.call(v) === '[object Object]') {
          for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && v[k]) r.push(k);
        } else {
          r.push(String(v));
        }
      }
    }
    return r.join(' ');
  }
  function twmerge(a) {
    var s = clsx(a).split(/\s+/), m = {}, o = [];
    for (var i = 0; i < s.length; i++) {
      var c = s[i]; if (!c || c[0] === '!' || (c in m)) continue;
      m[c] = 1; o.push(c);
    }
    return o.join(' ');
  }
  window.__cebCn = function () { return twmerge(clsx.apply(null, arguments)); };
})();

function logError(type, detail) {
  var entry = { type: type, ts: Date.now(), detail: detail };
  window.__sidepanelErrorLog.push(entry);
  try {
    var existing = JSON.parse(localStorage.getItem('__ceb_crash_log') || '[]');
    existing.push(entry);
    if (existing.length > 50) existing = existing.slice(-50);
    localStorage.setItem('__ceb_crash_log', JSON.stringify(existing));
  } catch (_) {}
  console.error('[SidepanelBoundary]', type, detail);
}

window.addEventListener('error', function (e) {
  var detail = {
    message: e.error ? e.error.message : e.message,
    stack: e.error ? e.error.stack : null,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    errorType: e.error ? e.error.constructor.name : 'Unknown',
  };
  logError('window.error', detail);
  window.__sidepanelCrash = detail;
  e.preventDefault();

  var root = document.getElementById('root');
  if (!root || root.hasAttribute('data-crash')) return;
  root.setAttribute('data-crash', '1');

  var errorInfo = detail.errorType + ': ' + detail.message;
  var stackPreview = detail.stack ? detail.stack.split('\n').slice(0, 3).join('\n') : '';

  root.innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;padding:20px;font-family:system-ui;overflow:auto">' +
    '<div style="max-width:560px;text-align:center">' +
    '<h2 style="margin:0 0 12px;font-size:18px;color:#dc2626">界面异常</h2>' +
    '<p style="margin:0 0 8px;color:#666;line-height:1.6">' +
    '<code style="background:#fef2f2;padding:2px 6px;border-radius:3px;font-size:13px;color:#dc2626">' + errorInfo.replace(/</g, '&lt;') + '</code></p>' +
    (stackPreview ? '<pre style="margin:0 0 12px;padding:8px;background:#f8f9fa;border-radius:6px;font-size:11px;text-align:left;overflow-x:auto;max-height:120px;color:#555">' + stackPreview.replace(/</g, '&lt;') + '</pre>' : '') +
    '<p style="margin:0 0 16px;color:#888;font-size:13px">错误已记录到 localStorage，可打开控制台查看详情</p>' +
    '<div style="display:flex;gap:8px;justify-content:center">' +
    '<button onclick="location.reload()" style="padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">重新加载</button>' +
    '<button onclick="localStorage.removeItem(\'__ceb_crash_log\');this.textContent=\'已清除\'" style="padding:8px 16px;background:#f3f4f6;color:#666;border:none;border-radius:6px;cursor:pointer;font-size:13px">清除日志</button>' +
    '</div></div></div>';
});

window.addEventListener('unhandledrejection', function (e) {
  var reason = e.reason;
  var detail = {
    errorType: reason ? reason.constructor.name : 'Unknown',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : null,
  };
  logError('unhandledrejection', detail);
  e.preventDefault();
});
