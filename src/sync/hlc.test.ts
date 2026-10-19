import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareTimestamps,
  HybridLogicalClock,
  isZeroTimestamp,
  ZERO_TIMESTAMP,
  type Timestamp,
} from './hlc';

const timestamp = fc.record({
  wall: fc.integer({ min: 0, max: 5 }),
  counter: fc.integer({ min: 0, max: 3 }),
  node: fc.constantFrom('a', 'b', 'c'),
});

describe('HybridLogicalClock', () => {
  it('follows the wall clock while it moves forward', () => {
    let now = 1_000;
    const clock = new HybridLogicalClock('a', () => now);
    expect(clock.tick()).toEqual({ wall: 1_000, counter: 0, node: 'a' });
    now = 1_005;
    expect(clock.tick()).toEqual({ wall: 1_005, counter: 0, node: 'a' });
  });

  it('stays strictly increasing when the wall clock stalls or jumps backwards', () => {
    let now = 1_000;
    const clock = new HybridLogicalClock('a', () => now);
    const issued = [clock.tick(), clock.tick()];
    now = 400;
    issued.push(clock.tick(), clock.tick());
    expect(issued.map((ts) => [ts.wall, ts.counter])).toEqual([
      [1_000, 0],
      [1_000, 1],
      [1_000, 2],
      [1_000, 3],
    ]);
  });

  it('orders later ticks after an observed timestamp from a clock running far ahead', () => {
    const clock = new HybridLogicalClock('a', () => 1_000);
    const remote: Timestamp = { wall: 9_000_000, counter: 7, node: 'z' };
    clock.observe(remote);
    const next = clock.tick();
    expect(compareTimestamps(next, remote)).toBeGreaterThan(0);
    expect(next).toEqual({ wall: 9_000_000, counter: 8, node: 'a' });
  });

  it('ignores observed timestamps older than its own state', () => {
    const clock = new HybridLogicalClock('a', () => 5_000);
    clock.tick();
    clock.observe({ wall: 4_000, counter: 99, node: 'z' });
    expect(clock.tick()).toEqual({ wall: 5_000, counter: 1, node: 'a' });
  });

  it('drops sub-millisecond precision from the clock source', () => {
    const clock = new HybridLogicalClock('a', () => 1_000.75);
    expect(clock.tick().wall).toBe(1_000);
  });

  it('always issues timestamps above everything it observed', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(timestamp, fc.constant(null))), fc.nat(10), (events, start) => {
        let now = start;
        const clock = new HybridLogicalClock('n', () => (now += 1) % 7);
        let highest: Timestamp = ZERO_TIMESTAMP;
        for (const event of events) {
          if (event === null) {
            const ts = clock.tick();
            expect(compareTimestamps(ts, highest)).toBeGreaterThan(0);
            highest = ts;
          } else {
            clock.observe(event);
            if (compareTimestamps(event, highest) > 0) highest = event;
          }
        }
      }),
    );
  });
});

describe('compareTimestamps', () => {
  it('orders by wall time, then counter, then node id', () => {
    const base: Timestamp = { wall: 10, counter: 1, node: 'b' };
    expect(compareTimestamps(base, { ...base, wall: 11, counter: 0, node: 'a' })).toBe(-1);
    expect(compareTimestamps(base, { ...base, counter: 2, node: 'a' })).toBe(-1);
    expect(compareTimestamps(base, { ...base, node: 'c' })).toBe(-1);
    expect(compareTimestamps(base, { ...base })).toBe(0);
  });

  it('is a total order: antisymmetric and transitive', () => {
    fc.assert(
      fc.property(timestamp, timestamp, timestamp, (a, b, c) => {
        expect(Math.sign(compareTimestamps(a, b)) + Math.sign(compareTimestamps(b, a))).toBe(0);
        if (compareTimestamps(a, b) <= 0 && compareTimestamps(b, c) <= 0) {
          expect(compareTimestamps(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it('places the zero timestamp before every real timestamp', () => {
    expect(isZeroTimestamp(ZERO_TIMESTAMP)).toBe(true);
    expect(compareTimestamps(ZERO_TIMESTAMP, { wall: 0, counter: 0, node: 'a' })).toBe(-1);
  });
});
