/**
 * chrome.debugger 封装 — 提供 attach/detach/sendCommand/onEvent 的 Promise 化接口，
 * 并内置心跳保活机制对抗 MV3 SW 30s 超时。
 *
 * 设计要点：
 * - 一次只能 attach 一个标签页（chrome.debugger 约束）
 * - 心跳通过周期性发送 Runtime.evaluate 轻量命令维持 SW 存活
 * - detach 时清理所有监听器和心跳定时器
 */

import { CAPTURE_HEARTBEAT_INTERVAL_MS } from './types';

type Debuggee = { tabId: number };

/** CDP 事件回调类型 */
type CdpEventCallback = (params: Record<string, unknown>) => void;

/** 心跳定时器 ID */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** 当前附加的 debuggee */
let currentDebuggee: Debuggee | null = null;

/** 事件监听器映射 */
const eventListeners = new Map<string, Set<CdpEventCallback>>();

/**
 * 附加 chrome.debugger 到指定标签页。
 * 如果已附加到其他标签页，先 detach。
 */
export async function attachDebugger(tabId: number): Promise<void> {
  // 如果已附加到其他标签页，先 detach
  if (currentDebuggee && currentDebuggee.tabId !== tabId) {
    await detachDebugger();
  }

  // 如果已附加到同一标签页，直接返回
  if (currentDebuggee && currentDebuggee.tabId === tabId) {
    return;
  }

  const debuggee: Debuggee = { tabId };
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach(debuggee, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });

  currentDebuggee = debuggee;

  // 注册全局事件分发器（仅注册一次）
  // chrome.debugger.onEvent 在 SW 生命周期内只需注册一次
  ensureGlobalEventListener();

  // 启动心跳保活
  startHeartbeat(debuggee);
}

/**
 * 从当前标签页分离 chrome.debugger。
 */
export async function detachDebugger(): Promise<void> {
  if (!currentDebuggee) return;

  stopHeartbeat();

  const debuggee = currentDebuggee;
  currentDebuggee = null;

  await new Promise<void>((resolve) => {
    chrome.debugger.detach(debuggee, () => {
      // 即使 detach 失败也继续（标签页可能已关闭）
      if (chrome.runtime.lastError) {
        console.warn('[debugger] detach error:', chrome.runtime.lastError.message);
      }
      resolve();
    });
  });

  eventListeners.clear();
}

/** 发送 CDP 命令 */
export async function sendCommand<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!currentDebuggee) {
    throw new Error('Debugger not attached');
  }

  return new Promise<T>((resolve, reject) => {
    chrome.debugger.sendCommand(
      currentDebuggee!,
      method,
      params ?? {},
      ((result?: object) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result as T);
        }
      }) as (result?: object) => void,
    );
  });
}

/** 注册 CDP 事件监听器 */
export function onCdpEvent(event: string, callback: CdpEventCallback): () => void {
  let set = eventListeners.get(event);
  if (!set) {
    set = new Set();
    eventListeners.set(event, set);
  }
  set.add(callback);

  // 返回取消监听函数
  return () => {
    set!.delete(callback);
  };
}

/** 检查是否已附加 */
export function isAttached(): boolean {
  return currentDebuggee !== null;
}

/** 获取当前附加的 tabId */
export function getAttachedTabId(): number | null {
  return currentDebuggee?.tabId ?? null;
}

// ─── 内部实现 ───

/** 全局事件监听器（只注册一次） */
let globalListenerRegistered = false;

function ensureGlobalEventListener(): void {
  if (globalListenerRegistered) return;
  globalListenerRegistered = true;

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const callbacks = eventListeners.get(method);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(params as Record<string, unknown>);
        } catch (err) {
          console.error(`[debugger] event handler error for ${method}:`, err);
        }
      }
    }
  });

  // 标签页关闭/导航时自动 detach
  chrome.debugger.onDetach.addListener(() => {
    currentDebuggee = null;
    stopHeartbeat();
    eventListeners.clear();
  });
}

/** 启动心跳保活 */
function startHeartbeat(debuggee: Debuggee): void {
  stopHeartbeat();

  heartbeatTimer = setInterval(async () => {
    if (!currentDebuggee || currentDebuggee.tabId !== debuggee.tabId) {
      stopHeartbeat();
      return;
    }
    try {
      // 轻量级 CDP 命令，仅用于保持 SW 活跃
      await sendCommand('Runtime.evaluate', {
        expression: '1',
        returnByValue: true,
      });
    } catch {
      // 心跳失败说明 debugger 已断开，清理状态
      stopHeartbeat();
      currentDebuggee = null;
      eventListeners.clear();
    }
  }, CAPTURE_HEARTBEAT_INTERVAL_MS);
}

/** 停止心跳 */
function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
