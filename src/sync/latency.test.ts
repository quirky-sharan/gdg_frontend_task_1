import { describe, expect, it } from 'vitest';
import { digestEntries, fnv1a32 } from './digest';
import { LatencyTracker } from './latency';

describe('LatencyTracker', () => {
  it('has no summary before the first sample', () => {
    expect(new LatencyTracker().summary()).toBeNull();
  });

  it('summarises the most recent samples', () => {
    const tracker = new LatencyTracker(100);
    for (let ms = 1; ms <= 100; ms += 1) tracker.record(ms);
    expect(tracker.summary()).toEqual({ count: 100, last: 100, mean: 50.5, p95: 95, max: 100 });
  });

  it('keeps a bounded window but counts every sample', () => {
    const tracker = new LatencyTracker(3);
    for (const ms of [50, 1, 2, 3]) tracker.record(ms);
    expect(tracker.summary()).toEqual({ count: 4, last: 3, mean: 2, p95: 3, max: 3 });
  });

  it('ignores invalid samples', () => {
    const tracker = new LatencyTracker();
    tracker.record(Number.NaN);
    tracker.record(-1);
    expect(tracker.summary()).toBeNull();
  });
});

describe('digestEntries', () => {
  const ts = { wall: 1, counter: 0, node: 'a' };

  it('does not depend on key order', () => {
    const one = digestEntries({ a: { value: 1, ts }, b: { value: 'x', ts } });
    const two = digestEntries({ b: { value: 'x', ts }, a: { value: 1, ts } });
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changes when a value or a timestamp changes', () => {
    const base = digestEntries({ a: { value: 1, ts } });
    expect(digestEntries({ a: { value: 2, ts } })).not.toBe(base);
    expect(digestEntries({ a: { value: '1', ts } })).not.toBe(base);
    expect(digestEntries({ a: { value: 1, ts: { ...ts, counter: 1 } } })).not.toBe(base);
  });

  it('uses the standard FNV-1a test vectors', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });
});
