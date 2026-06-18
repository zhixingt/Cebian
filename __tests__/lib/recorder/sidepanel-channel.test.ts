import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recorderChannel } from '@/lib/recorder/sidepanel-channel';

describe('recorderChannel', () => {
  beforeEach(() => {
    recorderChannel.setPort(null);
  });

  it('publishRejection fans out to subscribers', () => {
    const listener = vi.fn();
    recorderChannel.subscribeRejection(listener);
    recorderChannel.publishRejection({ reason: 'busy' });
    expect(listener).toHaveBeenCalledWith({ reason: 'busy' });
  });

  it('swallows rejection listener errors', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const badListener = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    recorderChannel.subscribeRejection(badListener);
    recorderChannel.publishRejection({ reason: 'before_hello' });
    expect(badListener).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('returns false for start/stop when port is null', () => {
    expect(recorderChannel.start()).toBe(false);
    expect(recorderChannel.stop()).toBe(false);
  });

  it('replays last status to new subscribers', () => {
    const status = { isRecording: true, startedAt: 1, eventCount: 5, initiatorInstanceId: 'a', activeWindowId: 1 };
    recorderChannel.publishStatus(status as any);
    const listener = vi.fn();
    recorderChannel.subscribeStatus(listener);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isRecording: true }));
  });
});
