import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TEST_NAMESPACE, testSchema } from '../test/fakeBrowser';
import { FIELDS, simulate, type Op, type SimulationResult } from '../test/simulation';
import { decodeEntries } from './codec';
import { isZeroTimestamp } from './hlc';
import { compareEntries, explicitEntries, type Entry } from './lww';

/*
 * Randomised end-to-end check of the sync protocol (see `src/test/simulation.ts`). However
 * the writes, deliveries, tab lifecycles and storage clears interleave, once everything has
 * been delivered the system must have converged.
 */

const coreOps: fc.Arbitrary<Op>[] = [
  fc.record({
    kind: fc.constant('write'),
    tab: fc.nat(9),
    field: fc.constantFrom(...FIELDS),
    pick: fc.nat(99),
  }),
  fc.record({ kind: fc.constant('step'), count: fc.integer({ min: 1, max: 6 }) }),
  fc.record({ kind: fc.constant('tick'), ms: fc.integer({ min: 0, max: 2 }) }),
  fc.record({ kind: fc.constant('flush'), tab: fc.nat(9) }),
  fc.record({ kind: fc.constant('open') }),
  fc.record({ kind: fc.constant('close'), tab: fc.nat(9), graceful: fc.boolean() }),
];

/**
 * A tab that clears storage itself gets no `storage` event; it repairs on its next resync
 * instead, which `store.test.ts` covers. Here storage is cleared from another context.
 */
const clearOp: fc.Arbitrary<Op> = fc.constant({ kind: 'clear' });

function check(outcome: SimulationResult, { noLostWrites }: { noLostWrites: boolean }): void {
  try {
    const [first] = outcome.tabs;
    if (first === undefined) throw new Error('no tab left open');
    const reference = first.store.getEntries();

    // 1. Every open tab holds the same state.
    for (const { store } of outcome.tabs) {
      expect(store.getEntries()).toEqual(reference);
      expect(store.digest()).toBe(first.store.digest());
    }

    // 2. Storage holds exactly the explicitly written entries, and every tab's storage cache
    //    agrees with it (the latter is a sanity check of the fake browser itself).
    const explicit = explicitEntries(reference);
    for (const field of FIELDS) {
      const raw = outcome.browser.backend.get(`${TEST_NAMESPACE}:${field}`);
      const persisted =
        raw === undefined
          ? undefined
          : decodeEntries(testSchema, { [field]: JSON.parse(raw) as unknown })[field];
      expect(persisted).toEqual(explicit[field]);
    }
    for (const { tab } of outcome.tabs) expect(new Map(tab.view)).toEqual(outcome.browser.backend);

    // 3. No write was lost: each field holds the greatest write ever made to it.
    if (noLostWrites) {
      for (const field of FIELDS) {
        const latest = latestWrite(outcome.writes[field]);
        if (latest === undefined) expect(isZeroTimestamp(reference[field].ts)).toBe(true);
        else expect(reference[field]).toEqual(latest);
      }
    }
  } finally {
    for (const store of outcome.stores) store.destroy();
  }
}

function latestWrite(entries: readonly Entry[]): Entry | undefined {
  return entries.reduce<Entry | undefined>(
    (best, entry) => (best === undefined || compareEntries(entry, best) > 0 ? entry : best),
    undefined,
  );
}

describe('convergence under adversarial scheduling', () => {
  it('makes all open tabs and storage agree, under any interleaving', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(fc.oneof(...coreOps), { maxLength: 60, size: 'max' }),
        fc.constantFrom(0, 0.25),
        (seed, ops, duplicateRate) => {
          check(simulate(seed, ops, { duplicateRate }), { noLostWrites: false });
        },
      ),
      { numRuns: 400 },
    );
  });

  /*
   * A write can only be lost if every tab that knows it closes within the few milliseconds
   * before its broadcast is delivered *and* a racing tab's older write lands in storage after
   * it. No storage-based design can recover a value that only ever existed in closed tabs, so
   * this property lets in-flight messages arrive before a tab closes.
   */
  it('keeps the latest write of every field when tabs do not close mid-delivery', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(fc.oneof(...coreOps), { maxLength: 60, size: 'max' }),
        fc.constantFrom(0, 0.25),
        (seed, ops, duplicateRate) => {
          const outcome = simulate(seed, ops, { duplicateRate, settleBeforeClose: true });
          check(outcome, { noLostWrites: true });
        },
      ),
      { numRuns: 400 },
    );
  });

  it('still converges, with storage restored, when storage is cleared at random', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(fc.oneof(...coreOps, clearOp), { maxLength: 60, size: 'max' }),
        (seed, ops) => {
          check(simulate(seed, ops, { duplicateRate: 0.1 }), { noLostWrites: false });
        },
      ),
      { numRuns: 300 },
    );
  });

  it('handles a burst of concurrent edits from many tabs', () => {
    const ops: Op[] = [];
    for (let i = 0; i < 4; i += 1) ops.push({ kind: 'open' });
    for (let i = 0; i < 300; i += 1) {
      const field = FIELDS[i % FIELDS.length] ?? 'color';
      ops.push({ kind: 'write', tab: i % 6, field, pick: (i * 37) % 100 });
      if (i % 7 === 0) ops.push({ kind: 'step', count: 3 });
      if (i % 11 === 0) ops.push({ kind: 'tick', ms: 1 });
    }
    const outcome = simulate(42, ops, { duplicateRate: 0.2 });
    expect(outcome.tabs).toHaveLength(6);
    check(outcome, { noLostWrites: true });
  });
});
