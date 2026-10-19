import { ZERO_TIMESTAMP, type Timestamp } from './hlc';
import type { Entry, PartialEntryMap } from './lww';
import {
  fieldKeys,
  type FieldKey,
  type Fields,
  type FieldSpec,
  type Primitive,
  type Schema,
} from './types';

/*
 * Everything read from storage or received from another tab is untrusted: it may be corrupt,
 * hand-edited, or written by an older or newer version of the app. These decoders accept only
 * well-formed data and drop everything else field by field, so one bad field never discards
 * the valid ones next to it.
 */

const MAX_NODE_ID_LENGTH = 64;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Accepts real write timestamps only. The zero timestamp is reserved for locally derived
 * defaults, which must never arrive from outside.
 */
export function decodeTimestamp(raw: unknown): Timestamp | undefined {
  if (!isRecord(raw)) return undefined;
  const { wall, counter, node } = raw;
  if (!isNonNegativeSafeInteger(wall) || !isNonNegativeSafeInteger(counter)) return undefined;
  if (typeof node !== 'string' || node.length === 0 || node.length > MAX_NODE_ID_LENGTH) {
    return undefined;
  }
  return { wall, counter, node };
}

export function decodeEntry<V extends Primitive>(
  spec: FieldSpec<V>,
  raw: unknown,
): Entry<V> | undefined {
  if (!isRecord(raw)) return undefined;
  const ts = decodeTimestamp(raw['ts']);
  const value = raw['value'];
  if (ts === undefined || !spec.isValid(value)) return undefined;
  return { value, ts };
}

/** Decodes every valid entry of a schema's fields; unknown fields are ignored. */
export function decodeEntries<T extends Fields>(
  schema: Schema<T>,
  raw: unknown,
): PartialEntryMap<T> {
  const entries: Partial<Record<FieldKey<T>, Entry>> = {};
  if (!isRecord(raw)) return entries as PartialEntryMap<T>;
  for (const key of fieldKeys(schema)) {
    if (!Object.hasOwn(raw, key)) continue;
    const entry = decodeEntry(schema[key], raw[key]);
    if (entry !== undefined) entries[key] = entry;
  }
  return entries as PartialEntryMap<T>;
}

/** Decodes a per-field map of timestamps (used for the predecessor metadata of updates). */
export function decodeTimestamps<T extends Fields>(
  schema: Schema<T>,
  raw: unknown,
): Partial<Record<FieldKey<T>, Timestamp>> {
  const timestamps: Partial<Record<FieldKey<T>, Timestamp>> = {};
  if (!isRecord(raw)) return timestamps;
  for (const key of fieldKeys(schema)) {
    if (!Object.hasOwn(raw, key)) continue;
    // A predecessor may legitimately be the zero timestamp: the write replaced a default.
    const value = raw[key];
    const ts = isZeroTimestampRecord(value) ? ZERO_TIMESTAMP : decodeTimestamp(value);
    if (ts !== undefined) timestamps[key] = ts;
  }
  return timestamps;
}

function isZeroTimestampRecord(raw: unknown): boolean {
  return isRecord(raw) && raw['wall'] === 0 && raw['counter'] === 0 && raw['node'] === '';
}
