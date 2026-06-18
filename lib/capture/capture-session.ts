/**
 * 捕获会话管理 — 管理 chrome.debugger 附加 → Network 域启用 → 事件收集 → 分离 的完整生命周期。
 *
 * 单例模式：同一时间只有一个活跃的捕获会话（chrome.debugger 约束）。
 * 捕获期间持有 SW keep-alive token，防止 SW 30s 超时。
 */

import {
  type CaptureSessionState,
  type CdpRequestWillBeSent,
  type CdpResponseReceived,
  type CdpLoadingFinished,
  type CdpLoadingFailed,
  CAPTURE_MAX_DURATION_MS,
  CAPTURE_MAX_REQUESTS,
} from './types';
import { attachDebugger, detachDebugger, sendCommand, onCdpEvent, isAttached } from './debugger';
import { acquireKeepAlive, releaseKeepAlive } from '@/entrypoints/background/sw-keepalive';

/** 捕获到的原始请求记录（按 requestId 索引） */
interface CapturedRequest {
  requestId: string;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  postData?: string;
  resourceType?: string;
  timestamp: number;
  // 响应信息（后续填充）
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseMimeType?: string;
  responseBody?: string;
  errorText?: string;
}

/** 状态变更回调 */
type StateChangeListener = (state: CaptureSessionState) => void;

class CaptureSession {
  private state: CaptureSessionState = {
    tabId: null,
    status: 'idle',
    startedAt: 0,
    endedAt: null,
    requestCount: 0,
    apiCandidateCount: 0,
    error: null,
    hostname: null,
  };

  /** 捕获到的请求（按 requestId 索引） */
  private requests = new Map<string, CapturedRequest>();

  /** 事件取消监听器列表 */
  private unsubscribers: Array<() => void> = [];

  /** 最大时长定时器 */
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

  /** 状态变更监听器 */
  private listeners = new Set<StateChangeListener>();

  /** SW keep-alive token 是否已持有 */
  private keepAliveHeld = false;

  /** 获取当前状态 */
  getState(): CaptureSessionState {
    return { ...this.state };
  }

  /** 注册状态变更监听器 */
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 更新状态并通知监听器 */
  private updateState(patch: Partial<CaptureSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (err) {
        console.error('[capture] state listener error:', err);
      }
    }
  }

  /**
   * 开始捕获。
   * @param tabId 目标标签页 ID
   * @param hostname 目标标签页的 hostname（用于按站点隔离）
   */
  async start(tabId: number, hostname: string): Promise<void> {
    if (this.state.status === 'capturing' || this.state.status === 'attaching') {
      throw new Error('Capture session already active');
    }

    // 重置状态
    this.requests.clear();
    this.unsubscribers = [];
    this.updateState({
      tabId,
      status: 'attaching',
      startedAt: Date.now(),
      endedAt: null,
      requestCount: 0,
      apiCandidateCount: 0,
      error: null,
      hostname,
    });

    try {
      // 持有 SW keep-alive
      if (!this.keepAliveHeld) {
        acquireKeepAlive();
        this.keepAliveHeld = true;
      }

      // 附加 debugger
      await attachDebugger(tabId);

      // 启用 Network 域
      await sendCommand('Network.enable', {
        maxTotalBufferSize: 100 * 1024 * 1024, // 100MB
        maxResourceBufferSize: 5 * 1024 * 1024, // 5MB per resource
        maxPostDataSize: 1024 * 1024, // 1MB post data
      });

      // 注册事件监听器
      this.registerEventListeners();

      this.updateState({ status: 'capturing' });

      // 设置最大时长定时器
      this.maxDurationTimer = setTimeout(() => {
        console.log('[capture] max duration reached, auto-stopping');
        this.stop().catch((err) => {
          console.error('[capture] auto-stop failed:', err);
        });
      }, CAPTURE_MAX_DURATION_MS);
    } catch (err) {
      this.updateState({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        endedAt: Date.now(),
      });
      await this.cleanup();
      throw err;
    }
  }

  /** 停止捕获并返回捕获到的请求列表 */
  async stop(): Promise<CapturedRequest[]> {
    if (this.state.status === 'idle' || this.state.status === 'detaching') {
      return [];
    }

    this.updateState({ status: 'detaching' });

    await this.cleanup();

    this.updateState({
      status: 'idle',
      endedAt: Date.now(),
    });

    return Array.from(this.requests.values());
  }

  /** 获取捕获到的请求列表（不停止捕获） */
  getCapturedRequests(): CapturedRequest[] {
    return Array.from(this.requests.values());
  }

  /** 清理资源 */
  private async cleanup(): Promise<void> {
    // 取消事件监听
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch { /* ignore */ }
    }
    this.unsubscribers = [];

    // 清除最大时长定时器
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    // 分离 debugger
    if (isAttached()) {
      await detachDebugger().catch(() => { /* ignore */ });
    }

    // 释放 SW keep-alive
    if (this.keepAliveHeld) {
      releaseKeepAlive();
      this.keepAliveHeld = false;
    }
  }

  /** 注册 CDP 事件监听器 */
  private registerEventListeners(): void {
    // Network.requestWillBeSent
    this.unsubscribers.push(
      onCdpEvent('Network.requestWillBeSent', (params) => {
        const evt = params as unknown as CdpRequestWillBeSent;
        this.handleRequest(evt);
      }),
    );

    // Network.responseReceived
    this.unsubscribers.push(
      onCdpEvent('Network.responseReceived', (params) => {
        const evt = params as unknown as CdpResponseReceived;
        this.handleResponse(evt);
      }),
    );

    // Network.loadingFinished
    this.unsubscribers.push(
      onCdpEvent('Network.loadingFinished', (params) => {
        const evt = params as unknown as CdpLoadingFinished;
        this.handleLoadingFinished(evt);
      }),
    );

    // Network.loadingFailed
    this.unsubscribers.push(
      onCdpEvent('Network.loadingFailed', (params) => {
        const evt = params as unknown as CdpLoadingFailed;
        this.handleLoadingFailed(evt);
      }),
    );
  }

  /** 处理请求事件 */
  private handleRequest(evt: CdpRequestWillBeSent): void {
    // 检查请求数上限
    if (this.requests.size >= CAPTURE_MAX_REQUESTS) {
      return;
    }

    const { requestId, request, type } = evt;

    // 过滤非 API 请求（仅保留 XHR/Fetch）
    if (type && type !== 'XHR' && type !== 'Fetch' && type !== 'Other') {
      return;
    }

    this.requests.set(requestId, {
      requestId,
      url: request.url,
      method: request.method,
      requestHeaders: request.headers,
      postData: request.postData,
      resourceType: type,
      timestamp: Date.now(),
    });

    this.updateState({
      requestCount: this.requests.size,
    });
  }

  /** 处理响应事件 */
  private handleResponse(evt: CdpResponseReceived): void {
    const req = this.requests.get(evt.requestId);
    if (!req) return;

    req.responseStatus = evt.response.status;
    req.responseHeaders = evt.response.headers;
    req.responseMimeType = evt.response.mimeType;
  }

  /** 处理加载完成事件 */
  private async handleLoadingFinished(evt: CdpLoadingFinished): Promise<void> {
    const req = this.requests.get(evt.requestId);
    if (!req) return;

    // 仅获取 JSON 响应体且小于 1MB
    if (req.responseMimeType?.includes('json') && (evt.encodedDataLength ?? 0) < 1024 * 1024) {
      try {
        const result = await sendCommand<{ body?: string; base64Encoded?: boolean }>(
          'Network.getResponseBody',
          { requestId: evt.requestId },
        );
        if (result.body && !result.base64Encoded) {
          req.responseBody = result.body;
        }
      } catch {
        // 获取响应体失败，忽略
      }
    }

    // 更新 API 候选计数
    if (this.isApiCandidate(req)) {
      this.updateState({
        apiCandidateCount: this.state.apiCandidateCount + 1,
      });
    }
  }

  /** 处理加载失败事件 */
  private handleLoadingFailed(evt: CdpLoadingFailed): void {
    const req = this.requests.get(evt.requestId);
    if (!req) return;

    req.errorText = evt.errorText;
  }

  /** 判断是否为 API 候选请求 */
  private isApiCandidate(req: CapturedRequest): boolean {
    // 必须有响应状态码
    if (!req.responseStatus || req.responseStatus < 200 || req.responseStatus >= 400) {
      return false;
    }
    // 响应必须是 JSON
    if (!req.responseMimeType?.includes('json')) {
      return false;
    }
    // 过滤静态资源扩展名
    const staticExts = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff|woff2|ttf|mp4|webm|pdf|zip)(\?|$)/i;
    if (staticExts.test(req.url)) {
      return false;
    }
    return true;
  }
}

/** 单例 */
export const captureSession = new CaptureSession();

/** 导出捕获请求类型供分析器使用 */
export type { CapturedRequest };
