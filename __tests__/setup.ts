import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// jsdom 不提供 ResizeObserver，需要 polyfill
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom 不提供 elementFromPoint / elementsFromPoint，提供简化 polyfill
// 原理：遍历文档中所有元素，返回 bounding rect 包含 (x,y) 的元素栈（按 z-index / DOM 顺序近似）
// 守卫：node 环境下 Document 不存在（@vitest-environment node 的测试文件会复用此 setup）
if (typeof Document !== 'undefined') {
  if (!Document.prototype.elementFromPoint) {
    Document.prototype.elementFromPoint = function (x: number, y: number): Element | null {
      const all = Array.from(this.querySelectorAll('*')) as HTMLElement[];
      // 倒序遍历，优先返回后渲染的（近似顶层）
      for (let i = all.length - 1; i >= 0; i--) {
        const el = all[i];
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return el;
        }
      }
      return this.documentElement;
    };
  }

  if (!Document.prototype.elementsFromPoint) {
    Document.prototype.elementsFromPoint = function (x: number, y: number): Element[] {
      const el = this.elementFromPoint(x, y);
      return el ? [el] : [];
    };
  }
}
