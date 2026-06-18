import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── performInteraction 是在页面上下文中执行的自包含函数 ───
// 直接从 interact.ts 中提取它进行测试，避免 mock chrome.scripting.executeScript

// 将 performInteraction 函数体提取为独立可测试单元
// （原函数是 interact.ts 内部的非导出函数，这里复制其核心逻辑用于单元测试）
function performInteraction(params: {
  action: string;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  modifiers?: string[];
  deltaX?: number;
  deltaY?: number;
  timeout?: number;
}): Promise<string> {
  const { action, selector, x, y, text, key, modifiers, deltaX, deltaY, timeout = 3000 } = params;

  let resolvedByCoords = false;

  function getEl(): HTMLElement {
    if (selector) {
      // 1. CSS 选择器（可能因非标准格式抛异常，需要 try-catch）
      try {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) return el;
      } catch { /* 非标准 selector，继续回退链 */ }

      // 文本匹配：selector 格式 "text=提交按钮"
      if (selector.startsWith('text=')) {
        const searchText = selector.slice(5);
        const candidates = document.querySelectorAll<HTMLElement>(
          'button, a, label, span, [role="button"], [role="link"], [role="tab"], h1, h2, h3, h4, h5, h6, option, summary'
        );
        for (const el of candidates) {
          if (el.textContent?.trim() === searchText ||
              el.textContent?.trim().includes(searchText)) {
            return el;
          }
        }
        try {
          const xpath = `//*[contains(text(), '${searchText.replace(/'/g, "\\'")}') ]`;
          const result = document.evaluate(
            xpath, document, null,
            XPathResult.FIRST_ORDERED_NODE_TYPE, null,
          );
          const found = result.singleNodeValue as HTMLElement | null;
          if (found) return found;
        } catch { /* ignore */ }
      }

      // Role+Label：selector 格式 "role:button,label:提交"
      if (selector.startsWith('role:')) {
        const parts = selector.slice(5).split(',');
        let role = '';
        let label = '';
        for (const part of parts) {
          if (part.startsWith('label:')) {
            label = part.slice(6);
          } else if (!role) {
            role = part;
          }
        }
        if (role) {
          const sel = label
            ? `[role="${role}"][aria-label*="${label.replace(/([[\]{}()*+?.\\^$|])/g, '\\$1')}"]`
            : `[role="${role}"]`;
          const el = document.querySelector<HTMLElement>(sel);
          if (el) return el;
        }
      }

      // 坐标回退
      if (x != null && y != null) {
        const coordEl = document.elementFromPoint(x, y) as HTMLElement | null;
        if (coordEl) {
          resolvedByCoords = true;
          return coordEl;
        }
      }

      throw new Error(`Element not found: ${selector}${x != null && y != null ? ` (coordinate fallback (${x}, ${y}) also failed)` : ''}`);
    }
    if (x != null && y != null) {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) throw new Error(`No element at coordinates (${x}, ${y})`);
      resolvedByCoords = true;
      return el;
    }
    throw new Error('Either selector or x/y coordinates are required.');
  }

  const targetDesc = selector ?? `(${x}, ${y})`;

  function modInit() {
    return {
      ctrlKey: modifiers?.includes('ctrl') ?? false,
      shiftKey: modifiers?.includes('shift') ?? false,
      altKey: modifiers?.includes('alt') ?? false,
      metaKey: modifiers?.includes('meta') ?? false,
    };
  }

  function keyCodeFor(k: string): number {
    const named: Record<string, number> = {
      Backspace: 8, Tab: 9, Enter: 13,
      Shift: 16, Control: 17, Alt: 18,
      Pause: 19, CapsLock: 20, Escape: 27, Space: 32,
      PageUp: 33, PageDown: 34, End: 35, Home: 36,
      ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
      Insert: 45, Delete: 46,
      Meta: 91, ContextMenu: 93,
      F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
      F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
      NumLock: 144, ScrollLock: 145,
      ';': 186, '=': 187, ',': 188, '-': 189, '.': 190, '/': 191, '`': 192,
      '[': 219, '\\': 220, ']': 221, "'": 222,
    };
    if (k in named) return named[k];
    if (k === ' ') return 32;
    if (k.length === 1) {
      const c = k.charCodeAt(0);
      if (c >= 0x61 && c <= 0x7A) return c - 32;
      return c;
    }
    return 0;
  }

  function domCodeFor(k: string): string {
    const named: Record<string, string> = {
      Backspace: 'Backspace', Tab: 'Tab', Enter: 'Enter',
      Shift: 'ShiftLeft', Control: 'ControlLeft', Alt: 'AltLeft',
      Pause: 'Pause', CapsLock: 'CapsLock', Escape: 'Escape',
      PageUp: 'PageUp', PageDown: 'PageDown', End: 'End', Home: 'Home',
      ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp',
      ArrowRight: 'ArrowRight', ArrowDown: 'ArrowDown',
      Insert: 'Insert', Delete: 'Delete',
      Meta: 'MetaLeft', ContextMenu: 'ContextMenu',
      F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
      F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
      NumLock: 'NumLock', ScrollLock: 'ScrollLock',
      ';': 'Semicolon', '=': 'Equal', ',': 'Comma', '-': 'Minus',
      '.': 'Period', '/': 'Slash', '`': 'Backquote',
      '[': 'BracketLeft', '\\': 'Backslash', ']': 'BracketRight',
      "'": 'Quote',
    };
    if (k in named) return named[k];
    if (k === ' ') return 'Space';
    if (k.length === 1) {
      const c = k.charCodeAt(0);
      if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) {
        return 'Key' + k.toUpperCase();
      }
      if (c >= 0x30 && c <= 0x39) return 'Digit' + k;
    }
    return '';
  }

  function resolveTarget(): { el: HTMLElement; point: { clientX: number; clientY: number } } {
    if (selector) {
      // 1. CSS 选择器（可能因非标准格式抛异常，需要 try-catch）
      try {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          return { el, point: { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } };
        }
      } catch { /* 非标准 selector，继续回退链 */ }

      // 2. 文本匹配：selector 格式 "text=提交按钮"
      if (selector.startsWith('text=')) {
        const searchText = selector.slice(5);
        const candidates = document.querySelectorAll<HTMLElement>(
          'button, a, label, span, [role="button"], [role="link"], [role="tab"], h1, h2, h3, h4, h5, h6, option, summary'
        );
        for (const c of candidates) {
          if (c.textContent?.trim() === searchText ||
              c.textContent?.trim().includes(searchText)) {
            c.scrollIntoView({ block: 'center', behavior: 'instant' });
            const r = c.getBoundingClientRect();
            return { el: c, point: { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } };
          }
        }
      }

      // 3. Role+Label：selector 格式 "role:button,label:提交"
      if (selector.startsWith('role:')) {
        const parts = selector.slice(5).split(',');
        let role = '';
        let label = '';
        for (const part of parts) {
          if (part.startsWith('label:')) {
            label = part.slice(6);
          } else if (!role) {
            role = part;
          }
        }
        if (role) {
          const sel = label
            ? `[role="${role}"][aria-label*="${label.replace(/([[\]{}()*+?.\\^$|])/g, '\\$1')}"]`
            : `[role="${role}"]`;
          const found = document.querySelector<HTMLElement>(sel);
          if (found) {
            found.scrollIntoView({ block: 'center', behavior: 'instant' });
            const r = found.getBoundingClientRect();
            return { el: found, point: { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } };
          }
        }
      }

      // 4. 坐标回退
      if (x != null && y != null) {
        let cx = x;
        let cy = y;
        const dpr = window.devicePixelRatio || 1;
        if (dpr > 1
          && (cx > window.innerWidth || cy > window.innerHeight)
          && cx / dpr <= window.innerWidth
          && cy / dpr <= window.innerHeight) {
          cx = cx / dpr;
          cy = cy / dpr;
        }
        const stack = document.elementsFromPoint(cx, cy) as HTMLElement[];
        if (stack.length > 0) {
          const coordEl = stack.find(e => getComputedStyle(e).pointerEvents !== 'none') ?? stack[0];
          return { el: coordEl, point: { clientX: cx, clientY: cy } };
        }
      }

      throw new Error(`Element not found: ${selector}${x != null && y != null ? ` (coordinate fallback (${x}, ${y}) also failed)` : ''}`);
    }
    if (x != null && y != null) {
      let cx = x;
      let cy = y;
      const dpr = window.devicePixelRatio || 1;
      if (dpr > 1
        && (cx > window.innerWidth || cy > window.innerHeight)
        && cx / dpr <= window.innerWidth
        && cy / dpr <= window.innerHeight) {
        cx = cx / dpr;
        cy = cy / dpr;
      }
      const stack = document.elementsFromPoint(cx, cy) as HTMLElement[];
      if (stack.length === 0) throw new Error(`No element at coordinates (${x}, ${y})`);
      const el = stack.find(e => getComputedStyle(e).pointerEvents !== 'none') ?? stack[0];
      return { el, point: { clientX: cx, clientY: cy } };
    }
    throw new Error('Either selector or x/y coordinates are required.');
  }

  function dispatchPointerSequence(
    el: HTMLElement,
    point: { clientX: number; clientY: number },
    kind: 'click' | 'dblclick' | 'rightclick' | 'hover',
  ): void {
    const button = kind === 'rightclick' ? 2 : 0;
    const pressedBit = kind === 'rightclick' ? 2 : (kind === 'hover' ? 0 : 1);
    const baseInit = {
      bubbles: true, composed: true, cancelable: true,
      button,
      clientX: point.clientX, clientY: point.clientY,
      ...modInit(),
    };
    const mDown: MouseEventInit = { ...baseInit, buttons: pressedBit };
    const mUp: MouseEventInit = { ...baseInit, buttons: 0 };
    const pExtras = {
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      width: 1, height: 1,
    };
    const pDown: PointerEventInit = { ...mDown, ...pExtras, pressure: kind === 'hover' ? 0 : 0.5 };
    const pUp: PointerEventInit = { ...mUp, ...pExtras, pressure: 0 };

    if (kind === 'hover') {
      el.dispatchEvent(new PointerEvent('pointerover', pUp));
      el.dispatchEvent(new MouseEvent('mouseover', mUp));
      el.dispatchEvent(new PointerEvent('pointerenter', { ...pUp, bubbles: false }));
      el.dispatchEvent(new MouseEvent('mouseenter', { ...mUp, bubbles: false }));
      el.dispatchEvent(new PointerEvent('pointermove', pUp));
      el.dispatchEvent(new MouseEvent('mousemove', mUp));
      return;
    }

    el.dispatchEvent(new PointerEvent('pointerdown', pDown));
    el.dispatchEvent(new MouseEvent('mousedown', mDown));
    el.dispatchEvent(new PointerEvent('pointerup', pUp));
    el.dispatchEvent(new MouseEvent('mouseup', mUp));

    if (kind === 'rightclick') {
      el.dispatchEvent(new MouseEvent('contextmenu', mUp));
      return;
    }

    el.dispatchEvent(new MouseEvent('click', { ...mUp, detail: 1 }));
    if (kind === 'dblclick') {
      el.dispatchEvent(new PointerEvent('pointerdown', pDown));
      el.dispatchEvent(new MouseEvent('mousedown', mDown));
      el.dispatchEvent(new PointerEvent('pointerup', pUp));
      el.dispatchEvent(new MouseEvent('mouseup', mUp));
      el.dispatchEvent(new MouseEvent('click', { ...mUp, detail: 2 }));
      el.dispatchEvent(new MouseEvent('dblclick', { ...mUp, detail: 2 }));
    }
  }

  switch (action) {
    case 'click': {
      const { el, point } = resolveTarget();
      dispatchPointerSequence(el, point, 'click');
      return Promise.resolve(`Clicked: ${targetDesc}`);
    }
    case 'dblclick': {
      const { el, point } = resolveTarget();
      dispatchPointerSequence(el, point, 'dblclick');
      return Promise.resolve(`Double-clicked: ${targetDesc}`);
    }
    case 'rightclick': {
      const { el, point } = resolveTarget();
      dispatchPointerSequence(el, point, 'rightclick');
      return Promise.resolve(`Right-clicked: ${targetDesc}`);
    }
    case 'hover': {
      const { el, point } = resolveTarget();
      dispatchPointerSequence(el, point, 'hover');
      return Promise.resolve(`Hovered: ${targetDesc}`);
    }
    case 'type': {
      const el = getEl();
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, (el.value ?? '') + (text ?? ''));
        } else {
          el.value = (el.value ?? '') + (text ?? '');
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.isContentEditable) {
        document.execCommand('insertText', false, text ?? '');
      }
      return Promise.resolve(`Typed "${text}" into: ${selector}`);
    }
    case 'clear': {
      const el = getEl();
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, '');
        } else {
          el.value = '';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.isContentEditable) {
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
      }
      return Promise.resolve(`Cleared: ${selector}`);
    }
    case 'select': {
      const el = getEl();
      if (el instanceof HTMLSelectElement) {
        const option = Array.from(el.options).find(o => o.text === text || o.value === text);
        if (!option) throw new Error(`Option not found: ${text}`);
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return Promise.resolve(`Selected "${text}" in: ${selector}`);
      }
      throw new Error(`Element is not a <select>: ${selector}`);
    }
    case 'scroll': {
      const target = selector ? getEl() : document.documentElement;
      target.scrollBy({ left: deltaX ?? 0, top: deltaY ?? 300, behavior: 'smooth' });
      return Promise.resolve(
        selector
          ? `Scrolled ${selector} by (${deltaX ?? 0}, ${deltaY ?? 300})`
          : `Scrolled page by (${deltaX ?? 0}, ${deltaY ?? 300})`,
      );
    }
    case 'focus': {
      const el = getEl();
      if (!resolvedByCoords) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      if (document.activeElement !== el) {
        return Promise.resolve(
          `Error: Element did not accept focus (not focusable): ${targetDesc}. ` +
          `Target an actual input/textarea/button/contenteditable, or an element with tabindex.`
        );
      }
      return Promise.resolve(`Focused: ${targetDesc}`);
    }
    case 'keypress': {
      if (!key) throw new Error('"key" is required for keypress action.');
      let target: Element;
      if (selector) {
        const el = getEl();
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        if (document.activeElement !== el) {
          return Promise.resolve(
            `Error: Element did not accept focus, cannot send keypress reliably: ${selector}. ` +
            `Target an actual input/textarea/button/contenteditable — a wrapper div will receive the event but won't trigger form submit.`
          );
        }
        target = el;
      } else {
        target = document.activeElement ?? document.body;
      }
      const code = keyCodeFor(key);
      const init: KeyboardEventInit = {
        key,
        code: domCodeFor(key),
        keyCode: code,
        which: code,
        bubbles: true,
        cancelable: true,
        composed: true,
        ...modInit(),
      };
      target.dispatchEvent(new KeyboardEvent('keydown', init));
      if (key.length === 1 || key === 'Enter') {
        target.dispatchEvent(new KeyboardEvent('keypress', init));
      }
      target.dispatchEvent(new KeyboardEvent('keyup', init));
      return Promise.resolve(selector ? `Pressed key ${key} on: ${selector}` : `Pressed key: ${key}`);
    }
    case 'wait': {
      if (!selector) throw new Error('"selector" is required for wait action.');
      return new Promise<string>((resolve, reject) => {
        const existing = document.querySelector(selector);
        if (existing) { resolve(`Element found: ${selector}`); return; }
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timeout: element ${selector} not found within ${timeout}ms`));
        }, timeout);
        const observer = new MutationObserver(() => {
          if (document.querySelector(selector)) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(`Element appeared: ${selector}`);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
    case 'wait_hidden': {
      if (!selector) throw new Error('"selector" is required for wait_hidden action.');
      const isHidden = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return true;
        const style = getComputedStyle(el);
        return style.display === 'none' || style.visibility === 'hidden';
      };
      return new Promise<string>((resolve, reject) => {
        if (isHidden(selector)) { resolve(`Element already hidden: ${selector}`); return; }
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timeout: element ${selector} still visible after ${timeout}ms`));
        }, timeout);
        const observer = new MutationObserver(() => {
          if (isHidden(selector)) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(`Element disappeared: ${selector}`);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      });
    }
    case 'drag': {
      const sourceEl = getEl();
      if (!resolvedByCoords) sourceEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      const sourceRect = sourceEl.getBoundingClientRect();
      const startX = x ?? (sourceRect.left + sourceRect.width / 2);
      const startY = y ?? (sourceRect.top + sourceRect.height / 2);
      const endX = startX + (deltaX ?? 0);
      const endY = startY + (deltaY ?? 0);
      const downEvent = new MouseEvent('mousedown', {
        bubbles: true, cancelable: true,
        clientX: startX, clientY: startY,
        ...modInit(),
      });
      sourceEl.dispatchEvent(downEvent);
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        const moveX = startX + (endX - startX) * progress;
        const moveY = startY + (endY - startY) * progress;
        const moveEvent = new MouseEvent('mousemove', {
          bubbles: true, cancelable: true,
          clientX: moveX, clientY: moveY,
          ...modInit(),
        });
        document.dispatchEvent(moveEvent);
      }
      const upEvent = new MouseEvent('mouseup', {
        bubbles: true, cancelable: true,
        clientX: endX, clientY: endY,
        ...modInit(),
      });
      document.dispatchEvent(upEvent);
      return Promise.resolve(`Dragged ${targetDesc} by (${deltaX ?? 0}, ${deltaY ?? 0})`);
    }
    default:
      return Promise.resolve(`Error: Unknown action "${action}".`);
  }
}

// ─── jsdom 补丁 ───
// jsdom 不实现 scrollIntoView / scrollBy，需要 mock
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollBy = vi.fn();

// ─── 测试用例 ───

describe('performInteraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    vi.mocked(Element.prototype.scrollBy).mockClear();
  });

  // ─── click ───

  describe('click', () => {
    it('clicks element by selector and dispatches pointer+mouse events', async () => {
      const btn = document.createElement('button');
      btn.id = 'test-btn';
      document.body.appendChild(btn);

      const events: string[] = [];
      btn.addEventListener('pointerdown', () => events.push('pointerdown'));
      btn.addEventListener('mousedown', () => events.push('mousedown'));
      btn.addEventListener('pointerup', () => events.push('pointerup'));
      btn.addEventListener('mouseup', () => events.push('mouseup'));
      btn.addEventListener('click', () => events.push('click'));

      const result = await performInteraction({ action: 'click', selector: '#test-btn' });
      expect(result).toBe('Clicked: #test-btn');
      expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    });

    it('throws when selector matches nothing', async () => {
      try {
        await performInteraction({ action: 'click', selector: '#nonexistent' });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toBe('Element not found: #nonexistent');
      }
    });

    it('throws when neither selector nor coordinates provided', async () => {
      try {
        await performInteraction({ action: 'click' } as any);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('Either selector or x/y coordinates are required');
      }
    });
  });

  // ─── type ───

  describe('type', () => {
    it('types text into input using native setter', async () => {
      const input = document.createElement('input');
      input.id = 'name';
      input.type = 'text';
      document.body.appendChild(input);

      const result = await performInteraction({ action: 'type', selector: '#name', text: 'hello' });
      expect(result).toBe('Typed "hello" into: #name');
      expect(input.value).toBe('hello');
    });

    it('appends text to existing value', async () => {
      const input = document.createElement('input');
      input.id = 'name';
      input.value = 'hi ';
      document.body.appendChild(input);

      await performInteraction({ action: 'type', selector: '#name', text: 'world' });
      expect(input.value).toBe('hi world');
    });

    it('types into textarea', async () => {
      const ta = document.createElement('textarea');
      ta.id = 'desc';
      document.body.appendChild(ta);

      await performInteraction({ action: 'type', selector: '#desc', text: 'line1' });
      expect(ta.value).toBe('line1');
    });

    it('dispatches input and change events', async () => {
      const input = document.createElement('input');
      input.id = 'evt';
      document.body.appendChild(input);

      const events: string[] = [];
      input.addEventListener('input', () => events.push('input'));
      input.addEventListener('change', () => events.push('change'));

      await performInteraction({ action: 'type', selector: '#evt', text: 'x' });
      expect(events).toEqual(['input', 'change']);
    });
  });

  // ─── clear ───

  describe('clear', () => {
    it('clears input value', async () => {
      const input = document.createElement('input');
      input.id = 'clr';
      input.value = 'old';
      document.body.appendChild(input);

      const result = await performInteraction({ action: 'clear', selector: '#clr' });
      expect(result).toBe('Cleared: #clr');
      expect(input.value).toBe('');
    });

    it('clears textarea value', async () => {
      const ta = document.createElement('textarea');
      ta.id = 'clr-ta';
      ta.value = 'content';
      document.body.appendChild(ta);

      await performInteraction({ action: 'clear', selector: '#clr-ta' });
      expect(ta.value).toBe('');
    });
  });

  // ─── select ───

  describe('select', () => {
    it('selects option by text', async () => {
      const select = document.createElement('select');
      select.id = 'color';
      const opt1 = document.createElement('option');
      opt1.value = 'red'; opt1.text = 'Red';
      const opt2 = document.createElement('option');
      opt2.value = 'blue'; opt2.text = 'Blue';
      select.appendChild(opt1);
      select.appendChild(opt2);
      document.body.appendChild(select);

      const result = await performInteraction({ action: 'select', selector: '#color', text: 'Blue' });
      expect(result).toBe('Selected "Blue" in: #color');
      expect(select.value).toBe('blue');
    });

    it('selects option by value', async () => {
      const select = document.createElement('select');
      select.id = 'size';
      const opt = document.createElement('option');
      opt.value = 'lg'; opt.text = 'Large';
      select.appendChild(opt);
      document.body.appendChild(select);

      await performInteraction({ action: 'select', selector: '#size', text: 'lg' });
      expect(select.value).toBe('lg');
    });

    it('throws when option not found', async () => {
      const select = document.createElement('select');
      select.id = 'empty';
      document.body.appendChild(select);

      try {
        await performInteraction({ action: 'select', selector: '#empty', text: 'missing' });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toBe('Option not found: missing');
      }
    });

    it('throws when element is not a select', async () => {
      const div = document.createElement('div');
      div.id = 'notsel';
      document.body.appendChild(div);

      try {
        await performInteraction({ action: 'select', selector: '#notsel', text: 'x' });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toBe('Element is not a <select>: #notsel');
      }
    });
  });

  // ─── scroll ───

  describe('scroll', () => {
    it('scrolls page by default delta', async () => {
      const scrollBySpy = vi.fn();
      document.documentElement.scrollBy = scrollBySpy;

      const result = await performInteraction({ action: 'scroll', deltaY: 500 });
      expect(result).toBe('Scrolled page by (0, 500)');
      expect(scrollBySpy).toHaveBeenCalledWith({ left: 0, top: 500, behavior: 'smooth' });
    });

    it('scrolls specific element', async () => {
      const container = document.createElement('div');
      container.id = 'scroll-box';
      document.body.appendChild(container);

      const scrollBySpy = vi.fn();
      container.scrollBy = scrollBySpy;

      const result = await performInteraction({ action: 'scroll', selector: '#scroll-box', deltaX: -100, deltaY: 200 });
      expect(result).toBe('Scrolled #scroll-box by (-100, 200)');
      expect(scrollBySpy).toHaveBeenCalledWith({ left: -100, top: 200, behavior: 'smooth' });
    });

    it('uses default deltaY of 300', async () => {
      const scrollBySpy = vi.fn();
      document.documentElement.scrollBy = scrollBySpy;

      await performInteraction({ action: 'scroll' });
      expect(scrollBySpy).toHaveBeenCalledWith({ left: 0, top: 300, behavior: 'smooth' });
    });
  });

  // ─── keypress ───

  describe('keypress', () => {
    it('dispatches keydown/keypress/keyup for Enter', async () => {
      const input = document.createElement('input');
      input.id = 'search';
      document.body.appendChild(input);

      const events: string[] = [];
      input.addEventListener('keydown', () => events.push('keydown'));
      input.addEventListener('keypress', () => events.push('keypress'));
      input.addEventListener('keyup', () => events.push('keyup'));

      const result = await performInteraction({ action: 'keypress', key: 'Enter', selector: '#search' });
      expect(result).toBe('Pressed key Enter on: #search');
      expect(events).toEqual(['keydown', 'keypress', 'keyup']);
    });

    it('populates keyCode/which/code for legacy compatibility', async () => {
      const input = document.createElement('input');
      input.id = 'legacy';
      document.body.appendChild(input);

      let capturedKey: number | undefined;
      let capturedWhich: number | undefined;
      let capturedCode: string | undefined;
      input.addEventListener('keydown', (e) => {
        capturedKey = (e as KeyboardEvent).keyCode;
        capturedWhich = (e as KeyboardEvent).which;
        capturedCode = (e as KeyboardEvent).code;
      });

      await performInteraction({ action: 'keypress', key: 'Enter', selector: '#legacy' });
      expect(capturedKey).toBe(13);
      expect(capturedWhich).toBe(13);
      expect(capturedCode).toBe('Enter');
    });

    it('skips keypress event for non-character keys like Escape', async () => {
      const input = document.createElement('input');
      input.id = 'esc-input';
      document.body.appendChild(input);

      const events: string[] = [];
      input.addEventListener('keydown', () => events.push('keydown'));
      input.addEventListener('keypress', () => events.push('keypress'));
      input.addEventListener('keyup', () => events.push('keyup'));

      await performInteraction({ action: 'keypress', key: 'Escape', selector: '#esc-input' });
      // Escape 不是字符键，不应触发 keypress
      expect(events).toEqual(['keydown', 'keyup']);
    });

    it('throws when key is missing', async () => {
      try {
        await performInteraction({ action: 'keypress', selector: '#x' } as any);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('"key" is required for keypress action');
      }
    });
  });

  // ─── wait ───

  describe('wait', () => {
    it('resolves immediately if element already exists', async () => {
      const div = document.createElement('div');
      div.id = 'exists';
      document.body.appendChild(div);

      const result = await performInteraction({ action: 'wait', selector: '#exists', timeout: 100 });
      expect(result).toBe('Element found: #exists');
    });

    it('resolves when element appears via DOM mutation', async () => {
      const result = performInteraction({ action: 'wait', selector: '#dynamic', timeout: 500 });

      // 模拟延迟添加元素
      setTimeout(() => {
        const div = document.createElement('div');
        div.id = 'dynamic';
        document.body.appendChild(div);
      }, 50);

      await expect(result).resolves.toBe('Element appeared: #dynamic');
    });

    it('rejects on timeout', async () => {
      vi.useFakeTimers();
      const promise = performInteraction({ action: 'wait', selector: '#never', timeout: 1000 });

      vi.advanceTimersByTime(1100);

      await expect(promise).rejects.toThrow('Timeout: element #never not found within 1000ms');
      vi.useRealTimers();
    });

    it('throws when selector is missing', async () => {
      try {
        await performInteraction({ action: 'wait' } as any);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('"selector" is required for wait action');
      }
    });
  });

  // ─── wait_hidden ───

  describe('wait_hidden', () => {
    it('resolves immediately if element is already hidden (display:none)', async () => {
      const div = document.createElement('div');
      div.id = 'hidden';
      div.style.display = 'none';
      document.body.appendChild(div);

      const result = await performInteraction({ action: 'wait_hidden', selector: '#hidden', timeout: 100 });
      expect(result).toBe('Element already hidden: #hidden');
    });

    it('resolves when element is removed from DOM', async () => {
      const div = document.createElement('div');
      div.id = 'to-remove';
      document.body.appendChild(div);

      const result = performInteraction({ action: 'wait_hidden', selector: '#to-remove', timeout: 500 });

      setTimeout(() => {
        div.remove();
      }, 50);

      await expect(result).resolves.toBe('Element disappeared: #to-remove');
    });

    it('rejects on timeout', async () => {
      const div = document.createElement('div');
      div.id = 'always-visible';
      document.body.appendChild(div);

      vi.useFakeTimers();
      const promise = performInteraction({ action: 'wait_hidden', selector: '#always-visible', timeout: 1000 });

      vi.advanceTimersByTime(1100);

      await expect(promise).rejects.toThrow('Timeout: element #always-visible still visible after 1000ms');
      vi.useRealTimers();
    });
  });

  // ─── focus ───

  describe('focus', () => {
    it('focuses an input element', async () => {
      const input = document.createElement('input');
      input.id = 'focus-me';
      document.body.appendChild(input);

      const result = await performInteraction({ action: 'focus', selector: '#focus-me' });
      expect(result).toBe('Focused: #focus-me');
      expect(document.activeElement).toBe(input);
    });

    it('returns error string for non-focusable element', async () => {
      const div = document.createElement('div');
      div.id = 'not-focusable';
      document.body.appendChild(div);

      const result = await performInteraction({ action: 'focus', selector: '#not-focusable' });
      expect(result).toContain('Error: Element did not accept focus');
    });
  });

  // ─── hover ───

  describe('hover', () => {
    it('dispatches hover event sequence', async () => {
      const btn = document.createElement('button');
      btn.id = 'hover-btn';
      document.body.appendChild(btn);

      const events: string[] = [];
      btn.addEventListener('pointerover', () => events.push('pointerover'));
      btn.addEventListener('mouseover', () => events.push('mouseover'));
      btn.addEventListener('pointermove', () => events.push('pointermove'));
      btn.addEventListener('mousemove', () => events.push('mousemove'));

      const result = await performInteraction({ action: 'hover', selector: '#hover-btn' });
      expect(result).toBe('Hovered: #hover-btn');
      expect(events).toContain('pointerover');
      expect(events).toContain('mouseover');
      expect(events).toContain('pointermove');
      expect(events).toContain('mousemove');
    });
  });

  // ─── rightclick ───

  describe('rightclick', () => {
    it('dispatches contextmenu event', async () => {
      const div = document.createElement('div');
      div.id = 'rc';
      document.body.appendChild(div);

      let contextMenuFired = false;
      div.addEventListener('contextmenu', () => { contextMenuFired = true; });

      const result = await performInteraction({ action: 'rightclick', selector: '#rc' });
      expect(result).toBe('Right-clicked: #rc');
      expect(contextMenuFired).toBe(true);
    });
  });

  // ─── dblclick ───

  describe('dblclick', () => {
    it('dispatches dblclick event', async () => {
      const div = document.createElement('div');
      div.id = 'dbl';
      document.body.appendChild(div);

      let dblClickFired = false;
      div.addEventListener('dblclick', () => { dblClickFired = true; });

      const result = await performInteraction({ action: 'dblclick', selector: '#dbl' });
      expect(result).toBe('Double-clicked: #dbl');
      expect(dblClickFired).toBe(true);
    });
  });

  // ─── unknown action ───

  describe('unknown action', () => {
    it('returns error string for unknown action', async () => {
      const result = await performInteraction({ action: 'fly' } as any);
      expect(result).toBe('Error: Unknown action "fly".');
    });
  });

  // ─── modifiers ───

  describe('modifiers', () => {
    it('passes modifier keys to click events', async () => {
      const btn = document.createElement('button');
      btn.id = 'mod-btn';
      document.body.appendChild(btn);

      let capturedCtrl = false;
      let capturedShift = false;
      btn.addEventListener('click', (e) => {
        capturedCtrl = (e as MouseEvent).ctrlKey;
        capturedShift = (e as MouseEvent).shiftKey;
      });

      await performInteraction({ action: 'click', selector: '#mod-btn', modifiers: ['ctrl', 'shift'] });
      expect(capturedCtrl).toBe(true);
      expect(capturedShift).toBe(true);
    });
  });

  describe('selector fallback chain', () => {
    it('finds element by text= selector', async () => {
      const btn = document.createElement('button');
      btn.textContent = 'Submit Form';
      document.body.appendChild(btn);

      const result = await performInteraction({ action: 'click', selector: 'text=Submit Form' });
      expect(result).toContain('Clicked');
    });

    it('finds element by text= with partial match', async () => {
      const link = document.createElement('a');
      link.textContent = 'Click here to continue';
      document.body.appendChild(link);

      const result = await performInteraction({ action: 'click', selector: 'text=continue' });
      expect(result).toContain('Clicked');
    });

    it('finds element by role:label selector', async () => {
      const btn = document.createElement('button');
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Close dialog');
      document.body.appendChild(btn);

      const result = await performInteraction({ action: 'click', selector: 'role:button,label:Close dialog' });
      expect(result).toContain('Clicked');
    });

    it('finds element by role only selector', async () => {
      const tab = document.createElement('div');
      tab.setAttribute('role', 'tab');
      tab.textContent = 'Settings';
      document.body.appendChild(tab);

      const result = await performInteraction({ action: 'click', selector: 'role:tab' });
      expect(result).toContain('Clicked');
    });

    it('falls back to coordinates when selector fails', async () => {
      const el = document.createElement('div');
      el.id = 'fallback-target';
      el.style.width = '100px';
      el.style.height = '100px';
      document.body.appendChild(el);

      // Mock elementFromPoint
      const originalEFP = document.elementFromPoint;
      document.elementFromPoint = vi.fn().mockReturnValue(el);

      const result = await performInteraction({
        action: 'click',
        selector: '#nonexistent',
        x: 50,
        y: 50,
      });
      expect(result).toContain('Clicked');

      document.elementFromPoint = originalEFP;
    });

    it('throws with informative error when all fallbacks fail', async () => {
      try {
        await performInteraction({ action: 'click', selector: '#nonexistent' });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('Element not found');
        expect((e as Error).message).toContain('#nonexistent');
      }
    });
  });

  describe('drag', () => {
    it('drags an element by offset using selector', async () => {
      const el = document.createElement('div');
      el.id = 'draggable';
      el.style.width = '100px';
      el.style.height = '100px';
      document.body.appendChild(el);

      const events: string[] = [];
      el.addEventListener('mousedown', () => events.push('mousedown'));
      document.addEventListener('mousemove', () => events.push('mousemove'));
      document.addEventListener('mouseup', () => events.push('mouseup'));

      const result = await performInteraction({
        action: 'drag',
        selector: '#draggable',
        deltaX: 100,
        deltaY: 50,
      });

      expect(result).toContain('Dragged');
      expect(result).toContain('100');
      expect(result).toContain('50');
      // mousedown on element + 5 mousemove + mouseup = 7 events
      expect(events).toHaveLength(7);
      expect(events[0]).toBe('mousedown');
      expect(events[events.length - 1]).toBe('mouseup');
    });

    it('drags from coordinates', async () => {
      // jsdom 的 elementFromPoint 需要 mock 才能返回元素
      const el = document.createElement('div');
      el.id = 'coord-drag-target';
      el.style.width = '100px';
      el.style.height = '100px';
      document.body.appendChild(el);

      // Mock elementFromPoint to return our element
      const originalEFP = document.elementFromPoint;
      document.elementFromPoint = vi.fn().mockReturnValue(el);

      const events: string[] = [];
      el.addEventListener('mousedown', () => events.push('mousedown'));
      document.addEventListener('mousemove', () => events.push('mousemove'));
      document.addEventListener('mouseup', () => events.push('mouseup'));

      const result = await performInteraction({
        action: 'drag',
        x: 50,
        y: 50,
        deltaX: -50,
        deltaY: 30,
      });

      expect(result).toContain('Dragged');
      expect(events).toHaveLength(7);

      // Restore
      document.elementFromPoint = originalEFP;
    });
  });
});
