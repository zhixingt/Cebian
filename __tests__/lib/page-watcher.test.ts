import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chrome.runtime
const sendMessageMock = vi.fn();
globalThis.chrome = {
  runtime: { sendMessage: sendMessageMock },
} as any;

// Mock MutationObserver：记录 callback 以便手动触发
const observeMock = vi.fn();
const disconnectMock = vi.fn();
let observerCallback: MutationCallback | null = null;

vi.stubGlobal(
  'MutationObserver',
  class {
    callback: MutationCallback;
    constructor(cb: MutationCallback) {
      this.callback = cb;
      observerCallback = cb;
    }
    observe = observeMock;
    disconnect = disconnectMock;
  },
);

import {
  startPageWatcher,
  stopPageWatcher,
  getPageWatcherStatus,
} from '@/lib/page-watcher';

/** 将 Node[] 转成符合 MutationRecord 要求的 NodeList */
function toNodeList(nodes: Node[]): NodeList {
  return {
    length: nodes.length,
    item: (index: number) => nodes[index] ?? null,
    forEach: (callbackfn: (value: Node, key: number, parent: NodeList) => void, thisArg?: unknown) => {
      nodes.forEach((node, i) => callbackfn.call(thisArg, node, i, toNodeList(nodes)));
    },
    entries: () => nodes.entries() as IterableIterator<[number, Node]>,
    keys: () => nodes.keys() as IterableIterator<number>,
    values: () => nodes.values() as IterableIterator<Node>,
    [Symbol.iterator]: function* () { yield* nodes; },
  } as unknown as NodeList;
}

/** 构造 childList 类型的 MutationRecord */
function makeChildListMutation(added: number, removed: number): MutationRecord {
  return {
    type: 'childList',
    target: document.body,
    addedNodes: toNodeList(Array.from({ length: added }, () => document.createTextNode(''))),
    removedNodes: toNodeList(Array.from({ length: removed }, () => document.createTextNode(''))),
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  } as MutationRecord;
}

/** 构造 characterData 类型的 MutationRecord */
function makeCharacterDataMutation(): MutationRecord {
  return {
    type: 'characterData',
    target: document.body,
    addedNodes: toNodeList([]),
    removedNodes: toNodeList([]),
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  } as MutationRecord;
}

/** 模拟的 MutationObserver 实例，用于 callback 第二个参数 */
const dummyObserver = {} as MutationObserver;

describe('page-watcher', () => {
  beforeEach(() => {
    // 清理全局标记
    delete (window as any).__cebWatcher;
    // 重置 mock
    sendMessageMock.mockReset();
    observeMock.mockReset();
    disconnectMock.mockReset();
    observerCallback = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startPageWatcher 返回 watching 并创建 observer', () => {
    const result = startPageWatcher();
    expect(result).toBe('watching');
    expect(observeMock).toHaveBeenCalledWith(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    expect(getPageWatcherStatus()).toBe(true);
  });

  it('重复调用返回 already_watching', () => {
    startPageWatcher();
    const result = startPageWatcher();
    expect(result).toBe('already_watching');
    // observe 只被调用一次
    expect(observeMock).toHaveBeenCalledTimes(1);
  });

  it('stopPageWatcher 返回 stopped 并 disconnect', () => {
    startPageWatcher();
    const result = stopPageWatcher();
    expect(result).toBe('stopped');
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(getPageWatcherStatus()).toBe(false);
  });

  it('未启动就停止返回 not_watching', () => {
    const result = stopPageWatcher();
    expect(result).toBe('not_watching');
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('getPageWatcherStatus 正确反映状态', () => {
    expect(getPageWatcherStatus()).toBe(false);
    startPageWatcher();
    expect(getPageWatcherStatus()).toBe(true);
    stopPageWatcher();
    expect(getPageWatcherStatus()).toBe(false);
  });

  it('stopPageWatcher 清理 timer 不抛异常', () => {
    startPageWatcher();
    // 触发 DOM 变化，闭包内 timer 被设置
    observerCallback!([makeChildListMutation(1, 0)], dummyObserver);

    // stopPageWatcher 应正常完成（内部会清理 timer）
    expect(() => stopPageWatcher()).not.toThrow();
    expect(getPageWatcherStatus()).toBe(false);
  });

  it('DOM 变化触发 sendMessage（变化量 >= 12）', () => {
    startPageWatcher();
    // 注入 12 个 addedNodes 变化
    observerCallback!([makeChildListMutation(12, 0)], dummyObserver);

    // 还未到 8 秒，不应发送
    expect(sendMessageMock).not.toHaveBeenCalled();

    // 推进 8 秒
    vi.advanceTimersByTime(8000);
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'page_change_detected',
      changeCount: 12,
    });
  });

  it('变化量 < 12 不触发 sendMessage', () => {
    startPageWatcher();
    observerCallback!([makeChildListMutation(8, 0)], dummyObserver);

    vi.advanceTimersByTime(8000);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('chrome.runtime.sendMessage 抛异常时不崩溃', () => {
    sendMessageMock.mockImplementation(() => {
      throw new Error('Extension context invalidated');
    });

    startPageWatcher();
    observerCallback!([makeChildListMutation(15, 0)], dummyObserver);

    // 不应抛异常
    expect(() => vi.advanceTimersByTime(8000)).not.toThrow();
  });

  it('防抖：8 秒内多次变化只发一次消息', () => {
    startPageWatcher();

    // 第一次变化，启动 timer
    observerCallback!([makeChildListMutation(6, 0)], dummyObserver);
    // 3 秒后又有变化，timer 已存在，不会重置
    vi.advanceTimersByTime(3000);
    observerCallback!([makeChildListMutation(8, 0)], dummyObserver);

    // 此时 changeCount = 14，但 timer 还没到期
    expect(sendMessageMock).not.toHaveBeenCalled();

    // 再过 5 秒（距首次变化 8 秒），timer 触发
    vi.advanceTimersByTime(5000);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'page_change_detected',
      changeCount: 14,
    });
  });

  it('冷却期：通知后 30 秒内不再发送', () => {
    startPageWatcher();

    // 首次触发
    observerCallback!([makeChildListMutation(15, 0)], dummyObserver);
    vi.advanceTimersByTime(8000);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    // 冷却期内再次变化，不应发送
    observerCallback!([makeChildListMutation(15, 0)], dummyObserver);
    vi.advanceTimersByTime(8000);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    // 冷却期结束（30 秒），再次变化应发送
    vi.advanceTimersByTime(30000);
    observerCallback!([makeChildListMutation(15, 0)], dummyObserver);
    vi.advanceTimersByTime(8000);
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });

  it('SCRIPT 节点被白名单过滤', () => {
    startPageWatcher();

    // 创建 SCRIPT 元素模拟添加
    const scriptEl = document.createElement('script');
    const mutation = {
      type: 'childList',
      target: document.body,
      addedNodes: toNodeList([scriptEl]),
      removedNodes: toNodeList([]),
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    } as MutationRecord;

    observerCallback!([mutation], dummyObserver);
    // SCRIPT 被过滤，变化量为 0，不触发 timer
    vi.advanceTimersByTime(8000);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('classId pattern matching ignores ad-related elements', () => {
    startPageWatcher();
    const div = document.createElement('div');
    div.className = 'advertisement-wrapper';
    const mutation = {
      type: 'childList',
      target: document.body,
      addedNodes: toNodeList([div]),
      removedNodes: toNodeList([]),
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    } as MutationRecord;

    observerCallback!([mutation], dummyObserver);
    vi.advanceTimersByTime(8000);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('characterData mutation counts when parent is not ignored', () => {
    startPageWatcher();
    const textNode = document.createTextNode('changed text');
    const p = document.createElement('p');
    p.appendChild(textNode);
    document.body.appendChild(p);

    const mutation = {
      type: 'characterData',
      target: textNode,
      addedNodes: toNodeList([]),
      removedNodes: toNodeList([]),
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    } as MutationRecord;

    observerCallback!([mutation], dummyObserver);
    observerCallback!([makeChildListMutation(11, 0)], dummyObserver);
    vi.advanceTimersByTime(8000);
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'page_change_detected',
      changeCount: 12,
    });
  });
});
