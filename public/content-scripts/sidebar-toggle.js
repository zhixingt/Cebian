/**
 * 侧边栏折叠时注入到页面右上角的展开按钮（VS Code 风格）。
 * 由 background 通过 chrome.scripting.executeScript 注入。
 */

const BUTTON_ID = 'cebianx-sidebar-toggle';

function getIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function createButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.title = '展开 CebianX 侧边栏 (Ctrl+Shift+X)';
  // 面板展开图标
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>`;

  const dark = getIsDark();
  Object.assign(btn.style, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    zIndex: '2147483647',
    width: '28px',
    height: '28px',
    padding: '0',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
    borderRadius: '6px',
    background: dark ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.85)',
    color: dark ? '#aaa' : '#666',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: '0.35',
    transition: 'opacity 0.2s, background 0.2s, transform 0.15s',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.opacity = '1';
    btn.style.background = dark ? 'rgba(50,50,50,0.95)' : 'rgba(255,255,255,0.98)';
    btn.style.transform = 'scale(1.1)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.opacity = '0.35';
    btn.style.background = dark ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.85)';
    btn.style.transform = 'scale(1)';
  });

  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'expand-sidebar' });
    removeButton();
  });

  return btn;
}

function removeButton(): void {
  const el = document.getElementById(BUTTON_ID);
  if (el) el.remove();
}

function showButton(): void {
  if (!document.getElementById(BUTTON_ID)) {
    document.body.appendChild(createButton());
  }
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'cebianx:show-toggle') {
    showButton();
  } else if (msg?.type === 'cebianx:hide-toggle') {
    removeButton();
  }
});

// 初始化：检查折叠状态
chrome.storage.local.get('local:sidebarCollapsedFlag', (result) => {
  if (result?.['local:sidebarCollapsedFlag'] === true) {
    showButton();
  }
});

// 监听存储变化
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'local:sidebarCollapsedFlag' in changes) {
    if (changes['local:sidebarCollapsedFlag']?.newValue === true) {
      showButton();
    } else {
      removeButton();
    }
  }
});
