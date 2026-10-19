import { compareTimestamps, isZeroTimestamp, ZERO_TIMESTAMP, type Timestamp } from './hlc';
import { fieldKeys, type FieldKey, type Fields, type Primitive, type Schema } from './types';

/** A last-writer-wins register: a value tagged with the timestamp of the write that produced it. */
export interface Entry<V extends Primitive = Primitive> {
  readonly value: V;
  readonly ts: Timestamp;
}

/**
 * The replicated document: one LWW register per field. Together they form an LWW-element map,
 * a state-based CRDT. Merging is commutative, associative and idempotent, so tabs converge to
 * the same state no matter in which order (or how many times) they receive each other's writes.
 */
export type EntryMap<T extends Fields> = { readonly [K in FieldKey<T>]: Entry<T[K]> };

/** A subset of a document's entries, e.g. the fields carried by one update message. */
export type PartialEntryMap<T extends Fields> = { readonly [K in FieldKey<T>]?: Entry<T[K]> };

/** Total, deterministic order over entries. Positive when `a` wins over `b`. */
export function compareEntries(a: Entry, b: Entry): number {
  const byTime = compareTimestamps(a.ts, b.ts);
  if (byTime !== 0) return byTime;
  // Distinct writes never share a timestamp, so this only matters for corrupt input. Ordering by
  // value keeps the comparison total anyway, which keeps merge commutative in every case.
  const left = JSON.stringify(a.value);
  const right = JSON.stringify(b.value);
  return left === right ? 0 : left < right ? -1 : 1;
}

export interface MergeOutcome<T extends Fields> {
  /** The merged document. It is the `local` object itself when nothing changed. */
  readonly state: EntryMap<T>;
  /** Fields whose entry was replaced by the incoming one. */
  readonly changed: readonly FieldKey<T>[];
}

/** Merges incoming entries into `local`, keeping the winning entry for each field. */
export function mergeEntries<T extends Fields>(
  local: EntryMap<T>,
  incoming: PartialEntryMap<T>,
): MergeOutcome<T> {
  const next: Partial<Record<FieldKey<T>, Entry>> = {};
  const changed: FieldKey<T>[] = [];
  for (const key of Object.keys(local) as FieldKey<T>[]) {
    const theirs = incoming[key];
    if (theirs !== undefined && compareEntries(theirs, local[key]) > 0) {
      next[key] = theirs;
      changed.push(key);
    }
  }
  if (changed.length === 0) return { state: local, changed };
  return { state: { ...local, ...next }, changed };
}

/**
 * Entries of `ours` that would win over `theirs` (including fields `theirs` lacks).
 * Used for anti-entropy: answering a peer with exactly what it is missing.
 */
export function entriesNewerThan<T extends Fields>(
  ours: EntryMap<T>,
  theirs: PartialEntryMap<T>,
): PartialEntryMap<T> {
  const newer: Partial<Record<FieldKey<T>, Entry>> = {};
  for (const key of Object.keys(ours) as FieldKey<T>[]) {
    const mine = ours[key];
    if (isZeroTimestamp(mine.ts)) continue;
    const other = theirs[key];
    if (other === undefined || compareEntries(mine, other) > 0) newer[key] = mine;
  }
  return newer as PartialEntryMap<T>;
}

/** Entries that were explicitly written. Defaults are derived locally and never replicated. */
export function explicitEntries<T extends Fields>(entries: EntryMap<T>): PartialEntryMap<T> {
  const explicit: Partial<Record<FieldKey<T>, Entry>> = {};
  for (const key of Object.keys(entries) as FieldKey<T>[]) {
    if (!isZeroTimestamp(entries[key].ts)) explicit[key] = entries[key];
  }
  return explicit as PartialEntryMap<T>;
}

/** Fills every field missing from `entries` with its default value at the zero timestamp. */
export function withDefaults<T extends Fields>(
  schema: Schema<T>,
  entries: PartialEntryMap<T>,
): EntryMap<T> {
  const complete: Partial<Record<FieldKey<T>, Entry>> = {};
  for (const key of fieldKeys(schema)) {
    complete[key] = entries[key] ?? { value: schema[key].defaultValue(), ts: ZERO_TIMESTAMP };
  }
  return complete as EntryMap<T>;
}

/** The defined entries of a partial map, as `[field, entry]` pairs. */
export function entriesOf<T extends Fields>(map: PartialEntryMap<T>): [FieldKey<T>, Entry][] {
  const pairs: [FieldKey<T>, Entry][] = [];
  for (const key of Object.keys(map) as FieldKey<T>[]) {
    const entry = map[key];
    if (entry !== undefined) pairs.push([key, entry]);
  }
  return pairs;
}

/** Strips timestamps, leaving the plain document. */
export function toValues<T extends Fields>(entries: EntryMap<T>): T {
  const values: Partial<Record<FieldKey<T>, Primitive>> = {};
  for (const key of Object.keys(entries) as FieldKey<T>[]) values[key] = entries[key].value;
  return values as T;
}
