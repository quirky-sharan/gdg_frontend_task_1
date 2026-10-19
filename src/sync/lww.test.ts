import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COLORS, testSchema, type TestDoc } from '../test/fakeBrowser';
import { ZERO_TIMESTAMP } from './hlc';
import {
  compareEntries,
  entriesNewerThan,
  explicitEntries,
  mergeEntries,
  toValues,
  withDefaults,
  type Entry,
  type EntryMap,
} from './lww';

// Tiny domains force equal timestamps and equal values to occur often.
const timestamp = fc.record({
  wall: fc.integer({ min: 0, max: 4 }),
  counter: fc.integer({ min: 0, max: 2 }),
  node: fc.constantFrom('a', 'b', 'c'),
});
const entry = <V extends string | number | boolean>(value: fc.Arbitrary<V>) =>
  fc.record({ value, ts: timestamp });

const doc: fc.Arbitrary<EntryMap<TestDoc>> = fc.record({
  color: entry(fc.constantFrom(...COLORS)),
  size: entry(fc.integer({ min: 12, max: 24 })),
  enabled: entry(fc.boolean()),
});

const merge = (a: EntryMap<TestDoc>, b: EntryMap<TestDoc>) => mergeEntries(a, b).state;

describe('mergeEntries (LWW-element map)', () => {
  it('is commutative', () => {
    fc.assert(
      fc.property(doc, doc, (a, b) => {
        expect(merge(a, b)).toEqual(merge(b, a));
      }),
    );
  });

  it('is associative', () => {
    fc.assert(
      fc.property(doc, doc, doc, (a, b, c) => {
        expect(merge(merge(a, b), c)).toEqual(merge(a, merge(b, c)));
      }),
    );
  });

  it('is idempotent and returns the same object when nothing changes', () => {
    fc.assert(
      fc.property(doc, (a) => {
        const outcome = mergeEntries(a, a);
        expect(outcome.state).toBe(a);
        expect(outcome.changed).toEqual([]);
      }),
    );
  });

  it('keeps, per field, the entry with the greatest timestamp', () => {
    fc.assert(
      fc.property(doc, doc, (a, b) => {
        const merged = merge(a, b);
        for (const key of ['color', 'size', 'enabled'] as const) {
          const winner = compareEntries(a[key], b[key]) >= 0 ? a[key] : b[key];
          expect(merged[key]).toEqual(winner);
        }
      }),
    );
  });

  it('reports exactly the fields that were replaced', () => {
    fc.assert(
      fc.property(doc, doc, (a, b) => {
        const { changed } = mergeEntries(a, b);
        const expected = (['color', 'size', 'enabled'] as const).filter(
          (key) => compareEntries(b[key], a[key]) > 0,
        );
        expect(changed).toEqual(expected);
      }),
    );
  });

  it('merges a partial update without touching other fields', () => {
    const local = withDefaults(testSchema, {});
    const update: Entry<string> = { value: 'blue', ts: { wall: 1, counter: 0, node: 'a' } };
    const { state, changed } = mergeEntries(local, { color: update });
    expect(changed).toEqual(['color']);
    expect(state.color).toBe(update);
    expect(state.size).toBe(local.size);
  });
});

describe('compareEntries', () => {
  it('breaks timestamp ties by value, so the order stays total for corrupt input', () => {
    const ts = { wall: 1, counter: 0, node: 'a' };
    const blue = { value: 'blue', ts };
    const red = { value: 'red', ts };
    expect(compareEntries(blue, red)).not.toBe(0);
    expect(Math.sign(compareEntries(blue, red)) + Math.sign(compareEntries(red, blue))).toBe(0);
    expect(compareEntries(blue, { ...blue })).toBe(0);
  });
});

describe('entriesNewerThan', () => {
  it('returns exactly what the other side needs to catch up', () => {
    fc.assert(
      fc.property(doc, doc, (ours, theirs) => {
        const caughtUp = merge(theirs, { ...theirs, ...entriesNewerThan(ours, theirs) });
        expect(caughtUp).toEqual(merge(ours, theirs));
      }),
    );
  });

  it('never sends defaults', () => {
    const defaults = withDefaults(testSchema, {});
    expect(entriesNewerThan(defaults, {})).toEqual({});
  });
});

describe('helpers', () => {
  it('withDefaults fills only the missing fields, at the zero timestamp', () => {
    const color: Entry<string> = { value: 'green', ts: { wall: 3, counter: 0, node: 'a' } };
    const complete = withDefaults(testSchema, { color });
    expect(complete.color).toBe(color);
    expect(complete.size).toEqual({ value: 16, ts: ZERO_TIMESTAMP });
    expect(toValues(complete)).toEqual({ color: 'green', size: 16, enabled: false });
  });

  it('explicitEntries drops never-written fields', () => {
    const color: Entry<string> = { value: 'green', ts: { wall: 3, counter: 0, node: 'a' } };
    expect(explicitEntries(withDefaults(testSchema, { color }))).toEqual({ color });
  });
});
