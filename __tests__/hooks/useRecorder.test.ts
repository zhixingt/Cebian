import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRecorder } from '@/hooks/useRecorder';
import { recorderChannel } from '@/lib/recorder/sidepanel-channel';

vi.mock('@/lib/instance-id', () => ({ myInstanceId: 'test-instance' }));
vi.mock('@/lib/i18n', () => ({ t: (k: string) => k }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

// 保存原始方法
const originalSetPort = recorderChannel.setPort;
const originalPublishStatus = recorderChannel.publishStatus;
const originalPublishSession = recorderChannel.publishSession;

// 创建一个模拟的 port
function createMockPort() {
  return {
    postMessage: vi.fn(),
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
  } as unknown as chrome.runtime.Port;
}

describe('useRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 channel 状态
    recorderChannel.setPort(null);
    recorderChannel.publishStatus({
      isRecording: false,
      startedAt: null,
      eventCount: 0,
      initiatorInstanceId: null,
      activeWindowId: null,
    });
  });

  afterEach(() => {
    recorderChannel.setPort(null);
  });

  it('returns isOwner=false when idle', () => {
    const { result } = renderHook(() => useRecorder());
    expect(result.current.isOwner).toBe(false);
    expect(result.current.startedAt).toBeNull();
  });

  it('start() posts recorder_start to port', () => {
    const port = createMockPort();
    recorderChannel.setPort(port);
    const { result } = renderHook(() => useRecorder());

    act(() => {
      result.current.start();
    });

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'recorder_start' });
  });

  it('stop() resolves immediately when not recording', async () => {
    const port = createMockPort();
    recorderChannel.setPort(port);
    const { result } = renderHook(() => useRecorder());

    let resolved = false;
    act(() => {
      result.current.stop().then(() => { resolved = true; });
    });

    await waitFor(() => expect(resolved).toBe(true));
  });

  it('stop() resolves when session arrives', async () => {
    const port = createMockPort();
    recorderChannel.setPort(port);
    // 模拟正在录制
    recorderChannel.publishStatus({
      isRecording: true,
      startedAt: Date.now(),
      eventCount: 5,
      initiatorInstanceId: 'test-instance',
      activeWindowId: 1,
    });

    const { result } = renderHook(() => useRecorder());
    await waitFor(() => expect(result.current.isOwner).toBe(true));

    let resolved = false;
    act(() => {
      result.current.stop().then(() => { resolved = true; });
    });

    // 模拟 background 发送 session
    act(() => {
      recorderChannel.publishSession({
        version: 1,
        startedAt: Date.now(),
        endedAt: Date.now(),
        durationMs: 1000,
        windowId: 1,
        events: [],
      });
    });

    await waitFor(() => expect(resolved).toBe(true));
  });

  // 这是 P0 缺陷的测试：cap-trigger 后 stop() 应该能 resolve
  it('stop() resolves when status changes to idle (cap-trigger race)', async () => {
    const port = createMockPort();
    recorderChannel.setPort(port);
    // 模拟正在录制
    recorderChannel.publishStatus({
      isRecording: true,
      startedAt: Date.now(),
      eventCount: 999,
      initiatorInstanceId: 'test-instance',
      activeWindowId: 1,
    });

    const { result } = renderHook(() => useRecorder());
    await waitFor(() => expect(result.current.isOwner).toBe(true));

    let resolved = false;
    act(() => {
      result.current.stop().then(() => { resolved = true; });
    });

    // 模拟 cap-trigger：background 先发送了 session（我们没注册 listener，所以错过了）
    // 然后发送 idle status
    act(() => {
      recorderChannel.publishStatus({
        isRecording: false,
        startedAt: null,
        eventCount: 1000,
        truncated: 'event_limit',
        initiatorInstanceId: null,
        activeWindowId: null,
      });
    });

    // 应该在 status 变为 idle 时 resolve
    await waitFor(() => expect(resolved).toBe(true), { timeout: 2000 });
  });

  it('concurrent stop() calls share the same promise', async () => {
    const port = createMockPort();
    recorderChannel.setPort(port);
    recorderChannel.publishStatus({
      isRecording: true,
      startedAt: Date.now(),
      eventCount: 5,
      initiatorInstanceId: 'test-instance',
      activeWindowId: 1,
    });

    const { result } = renderHook(() => useRecorder());
    await waitFor(() => expect(result.current.isOwner).toBe(true));

    let resolve1 = false;
    let resolve2 = false;

    const stopPromise = result.current.stop();
    const p1 = stopPromise.then(() => { resolve1 = true; });
    const p2 = result.current.stop().then(() => { resolve2 = true; });

    expect(stopPromise).toBe(result.current.stop()); // 同一个 Promise 被复用

    act(() => {
      recorderChannel.publishSession({
        version: 1,
        startedAt: Date.now(),
        endedAt: Date.now(),
        durationMs: 1000,
        windowId: 1,
        events: [],
      });
    });

    await waitFor(() => {
      expect(resolve1).toBe(true);
      expect(resolve2).toBe(true);
    });
  });
});
