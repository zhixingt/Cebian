/**
 * 页面变化监控：注入到页面中，使用 MutationObserver 检测 DOM 变化，
 * 通过 chrome.runtime.sendMessage 通知 sidepanel。
 *
 * 注入方式：chrome.scripting.executeScript({ func: startPageWatcher })
 * 停止方式：chrome.scripting.executeScript({ func: stopPageWatcher })
 *
 * ⚠️ 关键约束：这三个函数通过 executeScript({ func: ... }) 注入页面执行，
 * 因此必须是完全自包含的（所有变量和辅助函数必须定义在函数内部）。
 * 模块级别的变量和函数不会被 Chrome 一起注入到页面中。
 */

// Type augmentation for the in-page watcher state. Compile-time only
// (erased in JS output), so it doesn't interfere with executeScript injection.
declare global {
  interface Window {
    __cebWatcher?: {
      observer: MutationObserver;
      state: {
        changeCount: number;
        timer: ReturnType<typeof setTimeout> | null;
        cooldownTimer: ReturnType<typeof setTimeout> | null;
      };
    };
  }
}

/** 启动页面监控（完全自包含，不依赖模块级变量） */
export function startPageWatcher(): string {
  // 使用 window 全局对象存储状态，避免闭包变量在注入后丢失引用
  if (window.__cebWatcher) return 'already_watching';

  // ── 辅助函数（全部内联在函数内部）──────────────────────────────
  const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'LINK', 'META',
    'SVG', 'PATH', 'G', 'RECT', 'CIRCLE', 'LINE', 'POLYGON',
  ]);

  const IGNORED_PATTERNS = [
    /ads?/i, /advert/i, /analytics/i, /tracking/i, /stat/i,
    /banner/i, /popup/i, /modal/i, /toast/i, /tooltip/i,
    /spinner/i, /loading/i, /skeleton/i,
    /animation/i, /transition/i, /fade/i, /slide/i,
  ];

  function shouldIgnoreNode(node: Node): boolean {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
    if (!el || !(el instanceof Element)) return false;
    if (IGNORED_TAGS.has(el.tagName)) return true;
    const classId = `${el.className ?? ''} ${el.id ?? ''}`;
    for (const pattern of IGNORED_PATTERNS) {
      if (pattern.test(classId)) return true;
    }
    return false;
  }

  // ── 状态变量（挂载到 window 对象，确保 stopPageWatcher 能访问）──
  const state = {
    changeCount: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
    cooldownTimer: null as ReturnType<typeof setTimeout> | null,
  };

  const observer = new MutationObserver((mutations) => {
    if (state.cooldownTimer) return;

    let significantChanges = 0;
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (!shouldIgnoreNode(node)) significantChanges++;
        }
        for (const node of m.removedNodes) {
          if (!shouldIgnoreNode(node)) significantChanges++;
        }
      } else if (m.type === 'characterData') {
        const parent = m.target.parentElement;
        if (parent && !shouldIgnoreNode(parent)) {
          significantChanges += 1;
        }
      }
    }

    if (significantChanges === 0) return;
    state.changeCount += significantChanges;

    if (state.timer) return;
    state.timer = setTimeout(() => {
      const count = state.changeCount;
      state.changeCount = 0;
      state.timer = null;
      if (count < 12) return;
      try {
        chrome.runtime.sendMessage({
          type: 'page_change_detected',
          changeCount: count,
        });
      } catch {
        // 扩展上下文已失效时静默忽略
      }
      state.cooldownTimer = setTimeout(() => {
        state.cooldownTimer = null;
      }, 30000);
    }, 8000);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.__cebWatcher = { observer, state };
  return 'watching';
}

/** 停止页面监控（完全自包含） */
export function stopPageWatcher(): string {
  const watcher = window.__cebWatcher;
  if (!watcher) return 'not_watching';
  watcher.observer.disconnect();
  if (watcher.state.timer) clearTimeout(watcher.state.timer);
  if (watcher.state.cooldownTimer) clearTimeout(watcher.state.cooldownTimer);
  delete window.__cebWatcher;
  return 'stopped';
}

/** 查询监控状态（完全自包含） */
export function getPageWatcherStatus(): boolean {
  return !!window.__cebWatcher;
}
