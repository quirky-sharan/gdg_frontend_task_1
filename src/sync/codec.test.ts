import { describe, expect, it } from 'vitest';
import { testSchema } from '../test/fakeBrowser';
import { decodeEntries, decodeEntry, decodeTimestamp, decodeTimestamps } from './codec';
import { ZERO_TIMESTAMP } from './hlc';

const ts = { wall: 1_700_000_000_000, counter: 2, node: 'abc123' };

describe('decodeTimestamp', () => {
  it('accepts well-formed timestamps and strips unknown properties', () => {
    expect(decodeTimestamp({ ...ts, extra: true })).toEqual(ts);
  });

  it.each([
    ['null', null],
    ['an array', [1, 2, 'a']],
    ['a negative wall time', { ...ts, wall: -1 }],
    ['a fractional counter', { ...ts, counter: 1.5 }],
    ['an unsafe integer', { ...ts, wall: Number.MAX_SAFE_INTEGER + 1 }],
    ['NaN', { ...ts, wall: Number.NaN }],
    ['a numeric string', { ...ts, wall: '5' }],
    ['an empty node id', { ...ts, node: '' }],
    ['an overlong node id', { ...ts, node: 'x'.repeat(65) }],
    ['the reserved zero timestamp', ZERO_TIMESTAMP],
  ])('rejects %s', (_, raw) => {
    expect(decodeTimestamp(raw)).toBeUndefined();
  });
});

describe('decodeEntry', () => {
  it('validates the value with the field spec', () => {
    expect(decodeEntry(testSchema.color, { value: 'blue', ts })).toEqual({ value: 'blue', ts });
    expect(decodeEntry(testSchema.color, { value: 'purple', ts })).toBeUndefined();
    expect(decodeEntry(testSchema.size, { value: '16', ts })).toBeUndefined();
    expect(decodeEntry(testSchema.size, { value: 16 })).toBeUndefined();
  });
});

describe('decodeEntries', () => {
  it('keeps valid fields and drops invalid ones individually', () => {
    const decoded = decodeEntries(testSchema, {
      color: { value: 'green', ts },
      size: { value: 99, ts },
      enabled: 'yes',
      unknown: { value: 1, ts },
    });
    expect(decoded).toEqual({ color: { value: 'green', ts } });
  });

  it('ignores inherited and prototype-polluting keys', () => {
    const raw = JSON.parse(
      `{"__proto__": {"color": {"value": "blue", "ts": ${JSON.stringify(ts)}}}}`,
    );
    expect(decodeEntries(testSchema, raw)).toEqual({});
    expect(decodeEntries(testSchema, Object.create({ color: { value: 'blue', ts } }))).toEqual({});
  });

  it('returns nothing for non-objects', () => {
    expect(decodeEntries(testSchema, 'color')).toEqual({});
    expect(decodeEntries(testSchema, null)).toEqual({});
  });
});

describe('decodeTimestamps', () => {
  it('accepts the zero timestamp, which marks a write that replaced a default', () => {
    expect(decodeTimestamps(testSchema, { color: ZERO_TIMESTAMP, size: ts, enabled: 7 })).toEqual({
      color: ZERO_TIMESTAMP,
      size: ts,
    });
  });
});
