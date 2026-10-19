import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeerInfo } from '../sync/presence';
import { ConvergenceTracker } from './convergence';

const peer = (id: string, digest: string): PeerInfo => ({ id, digest, rttMs: 1, lastSeen: 0 });

describe('ConvergenceTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('only reports a mismatch that outlasts the grace period', () => {
    const onExpire = vi.fn();
    const tracker = new ConvergenceTracker(400, onExpire, () => Date.now());
    expect(tracker.diverged([peer('b', 'old')], 'new').size).toBe(0);
    vi.advanceTimersByTime(399);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect([...tracker.diverged([peer('b', 'old')], 'new')]).toEqual(['b']);
  });

  it('forgets a mismatch as soon as the digests agree again', () => {
    const onExpire = vi.fn();
    const tracker = new ConvergenceTracker(400, onExpire, () => Date.now());
    tracker.diverged([peer('b', 'old')], 'new');
    vi.advanceTimersByTime(200);
    expect(tracker.diverged([peer('b', 'new')], 'new').size).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(tracker.diverged([peer('b', 'newer')], 'new').size).toBe(0);
  });
});
