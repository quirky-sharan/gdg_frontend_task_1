import { decodeEntries, decodeTimestamps } from './codec';
import { digestEntries } from './digest';
import { Emitter } from './emitter';
import {
  compareTimestamps,
  HybridLogicalClock,
  isZeroTimestamp,
  ZERO_TIMESTAMP,
  type Timestamp,
} from './hlc';
import { createNodeId } from './ids';
import {
  compareEntries,
  entriesNewerThan,
  entriesOf,
  explicitEntries,
  mergeEntries,
  toValues,
  withDefaults,
  type Entry,
  type EntryMap,
  type PartialEntryMap,
} from './lww';
import type { EntryPersistence } from './persistence';
import { createEnvelope, isEnvelope, preciseNow, type Envelope } from './protocol';
import type { Transport } from './transport';
import { fieldKeys, type FieldKey, type Fields, type Schema } from './types';

/** Where a change came from. */
export type ChangeSource =
  /** Written in this tab. */
  | 'local'
  /** Received from another tab over the transport. */
  | 'remote'
  /** Found in persistent storage (a `storage` event, or a resync after the tab woke up). */
  | 'storage'
  /** The environment-derived default of a never-set field changed (e.g. the OS theme). */
  | 'default';

export interface ChangeEvent<T extends Fields> {
  readonly type: 'change';
  readonly source: ChangeSource;
  readonly keys: readonly FieldKey<T>[];
  /** One-way delivery latency in milliseconds, for changes received over the transport. */
  readonly latencyMs: number | null;
}

/** Two tabs wrote the same field without seeing each other's write. */
export interface ConflictEvent<T extends Fields> {
  readonly type: 'conflict';
  readonly key: FieldKey<T>;
  /** The entry every tab keeps. */
  readonly winner: Entry;
  /** The concurrent entry that lost. */
  readonly loser: Entry;
}

/** Storage held older data than this tab knew, and the newer entries were written back. */
export interface RepairEvent<T extends Fields> {
  readonly type: 'repair';
  readonly keys: readonly FieldKey<T>[];
}

/**
 * An update message from another tab arrived, whether or not it changed anything (the same
 * entries may already have arrived through a `storage` event). Used to measure latency.
 */
export interface DeliveredEvent {
  readonly type: 'delivered';
  readonly from: string;
  readonly latencyMs: number;
}

export type StoreEvent<T extends Fields> =
  ChangeEvent<T> | ConflictEvent<T> | RepairEvent<T> | DeliveredEvent;

/** Sent when a tab starts or wakes up. Peers answer with any entries it is missing. */
interface HelloMessage<T extends Fields> extends Envelope<'hello'> {
  readonly entries: PartialEntryMap<T>;
}

/** Carries newly written entries, plus the timestamp each write replaced (for conflict detection). */
interface UpdateMessage<T extends Fields> extends Envelope<'update'> {
  readonly entries: PartialEntryMap<T>;
  readonly prev: Partial<Record<FieldKey<T>, Timestamp>>;
}

export interface SyncedStoreOptions<T extends Fields> {
  readonly schema: Schema<T>;
  readonly persistence: EntryPersistence<T>;
  readonly transport: Transport;
  readonly nodeId?: string;
  /** Wall clock feeding the hybrid logical clock. */
  readonly wallClock?: () => number;
  /** High-resolution epoch clock used to measure message latency. */
  readonly preciseClock?: () => number;
  /** How long to wait before double-checking that storage holds what other tabs sent. */
  readonly verifyDelayMs?: number;
}

const MAX_REMEMBERED_CONFLICTS = 256;

function timestampKey(ts: Timestamp): string {
  return `${ts.wall}.${ts.counter}.${ts.node}`;
}

/**
 * A document of primitive fields replicated across all same-origin tabs.
 *
 * - Each field is a last-writer-wins register ordered by a hybrid logical clock, so concurrent
 *   edits resolve identically in every tab (see `lww.ts` and `hlc.ts`).
 * - Local writes are persisted first, then broadcast to the other tabs.
 * - Incoming entries are merged; stale or duplicate ones are ignored, so delivery order and
 *   duplicate delivery never matter.
 * - Storage is treated as one more replica: whenever it is found to be behind (a racing tab
 *   overwrote it, or it was cleared) the newer entries are written back.
 */
export class SyncedStore<T extends Fields> {
  readonly nodeId: string;

  private readonly schema: Schema<T>;
  private readonly persistence: EntryPersistence<T>;
  private readonly transport: Transport;
  private readonly clock: HybridLogicalClock;
  private readonly preciseClock: () => number;
  private readonly verifyDelayMs: number;
  private readonly emitter = new Emitter<StoreEvent<T>>();
  private readonly disposers: (() => void)[] = [];

  private entries: EntryMap<T>;
  private values: Readonly<T>;
  /** For each field, the timestamp of the entry its current entry replaced, when known. */
  private readonly predecessors = new Map<FieldKey<T>, Timestamp>();
  private readonly pendingVerification = new Set<FieldKey<T>>();
  /** Conflicts already reported; the losing entry may arrive more than once. */
  private readonly reportedConflicts = new Set<string>();
  private verifyTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(options: SyncedStoreOptions<T>) {
    this.nodeId = options.nodeId ?? createNodeId();
    this.schema = options.schema;
    this.persistence = options.persistence;
    this.transport = options.transport;
    this.clock = new HybridLogicalClock(this.nodeId, options.wallClock);
    this.preciseClock = options.preciseClock ?? preciseNow;
    this.verifyDelayMs = options.verifyDelayMs ?? 150;

    const stored = this.persistence.readAll();
    for (const [, entry] of entriesOf(stored)) this.clock.observe(entry.ts);
    this.entries = withDefaults(this.schema, stored);
    this.values = toValues(this.entries);
  }

  /** Starts listening to other tabs and announces this tab's state to them. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.disposers.push(
      this.transport.subscribe((message) => this.handleMessage(message)),
      this.persistence.subscribe((field, entry) => this.handleStorageChange(field, entry)),
    );
    this.announce();
  }

  /** Stops syncing. Pending storage checks run first. */
  destroy(): void {
    this.flush();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.emitter.clear();
    this.running = false;
  }

  getState(): Readonly<T> {
    return this.values;
  }

  getEntries(): EntryMap<T> {
    return this.entries;
  }

  /** Fingerprint of the full replicated state; equal in every tab once they have converged. */
  digest(): string {
    return digestEntries(this.entries);
  }

  subscribe(listener: (event: StoreEvent<T>) => void): () => void {
    return this.emitter.on(listener);
  }

  set<K extends FieldKey<T>>(key: K, value: T[K]): void {
    this.update({ [key]: value } as unknown as Partial<T>);
  }

  /** Writes one or more fields as a single change, persists them and broadcasts them. */
  update(patch: Partial<T>): void {
    const writes: { key: FieldKey<T>; value: T[FieldKey<T>]; replaced: Timestamp }[] = [];
    for (const key of fieldKeys(this.schema)) {
      if (!Object.hasOwn(patch, key)) continue;
      const value = patch[key];
      if (!this.schema[key].isValid(value)) {
        throw new TypeError(`Invalid value for "${key}": ${String(value)}`);
      }
      // Fold in anything another tab already persisted, so this write is ordered after it even
      // if that tab's broadcast has not arrived yet.
      const stored = this.persistence.read(key);
      if (stored !== undefined) this.clock.observe(stored.ts);
      const current = this.entries[key];
      const latest = stored !== undefined && compareEntries(stored, current) > 0 ? stored : current;
      if (latest.value === value && !isZeroTimestamp(latest.ts)) continue;
      writes.push({ key, value, replaced: latest.ts });
    }
    if (writes.length === 0) return;

    const ts = this.clock.tick();
    const written: Partial<Record<FieldKey<T>, Entry>> = {};
    for (const { key, value, replaced } of writes) {
      written[key] = { value, ts };
      this.predecessors.set(key, replaced);
    }
    const entries = written as PartialEntryMap<T>;
    this.commit(mergeEntries(this.entries, entries).state);
    // Broadcast first: the transport is the low-latency path. Persisting right after, in the
    // same task, cannot lose the write, and receivers verify storage later regardless.
    this.sendUpdate(entries);
    for (const { key } of writes) this.persistence.writeIfNewer(key, this.entries[key]);
    this.emitter.emit({
      type: 'change',
      source: 'local',
      keys: writes.map((write) => write.key),
      latencyMs: null,
    });
  }

  /**
   * Re-reads storage and asks peers for anything newer. Call this when the tab may have missed
   * messages: after it becomes visible again or is restored from the back/forward cache.
   */
  resync(): void {
    this.receive(this.persistence.readAll(), 'storage', null, null);
    this.repair(fieldKeys(this.schema));
    this.announce();
  }

  /** Re-evaluates the defaults of fields that were never explicitly set. */
  refreshDefaults(): void {
    const next: Partial<Record<FieldKey<T>, Entry>> = {};
    const changed: FieldKey<T>[] = [];
    for (const key of fieldKeys(this.schema)) {
      const entry = this.entries[key];
      if (!isZeroTimestamp(entry.ts)) continue;
      const value = this.schema[key].defaultValue();
      if (value !== entry.value) {
        next[key] = { value, ts: ZERO_TIMESTAMP };
        changed.push(key);
      }
    }
    if (changed.length === 0) return;
    this.commit({ ...this.entries, ...next });
    this.emitter.emit({ type: 'change', source: 'default', keys: changed, latencyMs: null });
  }

  /** Runs pending storage checks immediately. Call before the page is hidden or unloaded. */
  flush(): void {
    if (this.verifyTimer !== undefined) {
      clearTimeout(this.verifyTimer);
      this.verifyTimer = undefined;
    }
    if (this.pendingVerification.size === 0) return;
    const keys = [...this.pendingVerification];
    this.pendingVerification.clear();
    this.repair(keys);
  }

  private announce(): void {
    const message: HelloMessage<T> = {
      ...createEnvelope('hello', this.nodeId, this.preciseClock()),
      entries: explicitEntries(this.entries),
    };
    this.transport.send(message);
  }

  private sendUpdate(entries: PartialEntryMap<T>): void {
    const prev: Partial<Record<FieldKey<T>, Timestamp>> = {};
    for (const [key] of entriesOf(entries)) {
      const predecessor = this.predecessors.get(key);
      if (predecessor !== undefined) prev[key] = predecessor;
    }
    const message: UpdateMessage<T> = {
      ...createEnvelope('update', this.nodeId, this.preciseClock()),
      entries,
      prev,
    };
    this.transport.send(message);
  }

  private handleMessage(raw: unknown): void {
    if (!isEnvelope(raw) || raw.from === this.nodeId) return;
    if (raw.type !== 'hello' && raw.type !== 'update') return;
    const incoming = decodeEntries(this.schema, raw['entries']);
    const latencyMs = Math.max(0, this.preciseClock() - raw.sentAt);
    if (raw.type === 'update') {
      this.emitter.emit({ type: 'delivered', from: raw.from, latencyMs });
      this.receive(incoming, 'remote', latencyMs, decodeTimestamps(this.schema, raw['prev']));
      return;
    }
    this.receive(incoming, 'remote', latencyMs, null);
    // Anti-entropy: send the newcomer exactly the entries it lacks (usually none).
    const missing = entriesNewerThan(this.entries, incoming);
    if (entriesOf(missing).length > 0) this.sendUpdate(missing);
  }

  private handleStorageChange(field: FieldKey<T> | null, entry: Entry | undefined): void {
    if (field === null) {
      // Storage was cleared: write back everything this tab knows.
      this.repair(fieldKeys(this.schema));
      return;
    }
    if (entry !== undefined) {
      this.receive({ [field]: entry } as PartialEntryMap<T>, 'storage', null, null);
    }
    // Storage may now hold less than this tab knows: the field was removed, or a racing tab
    // overwrote a newer entry with an older one. Restore the newer entry.
    this.repair([field]);
  }

  /**
   * Merges entries from another tab or from storage.
   * @param prev predecessor timestamps sent with an update, or `null` when unknown.
   */
  private receive(
    incoming: PartialEntryMap<T>,
    source: 'remote' | 'storage',
    latencyMs: number | null,
    prev: Partial<Record<FieldKey<T>, Timestamp>> | null,
  ): void {
    for (const [, entry] of entriesOf(incoming)) this.clock.observe(entry.ts);
    if (prev !== null) this.reportConflicts(incoming, prev);

    const { state, changed } = mergeEntries(this.entries, incoming);
    if (changed.length === 0) return;
    for (const key of changed) {
      const predecessor = prev?.[key];
      if (predecessor === undefined) this.predecessors.delete(key);
      else this.predecessors.set(key, predecessor);
    }
    this.commit(state);
    // The sender persisted these entries already. Check later that a racing write did not
    // clobber them, in case the sender closes before it can notice and repair storage itself.
    if (source === 'remote') this.scheduleVerification(changed);
    this.emitter.emit({ type: 'change', source, keys: changed, latencyMs });
  }

  /**
   * Two writes conflict when they are concurrent: neither writer had seen the other's value,
   * i.e. each one's predecessor is older than the other write. Conflicts resolve through the
   * normal merge; reporting them only makes the resolution visible.
   */
  private reportConflicts(
    incoming: PartialEntryMap<T>,
    prev: Partial<Record<FieldKey<T>, Timestamp>>,
  ): void {
    for (const [key, theirs] of entriesOf(incoming)) {
      const ours = this.entries[key];
      const theirPredecessor = prev[key];
      const ourPredecessor = this.predecessors.get(key);
      if (theirPredecessor === undefined || ourPredecessor === undefined) continue;
      if (isZeroTimestamp(ours.ts) || theirs.value === ours.value) continue;
      const concurrent =
        compareTimestamps(theirPredecessor, ours.ts) < 0 &&
        compareTimestamps(ourPredecessor, theirs.ts) < 0;
      if (!concurrent) continue;
      const [winner, loser] = compareEntries(theirs, ours) > 0 ? [theirs, ours] : [ours, theirs];
      const id = `${key}|${timestampKey(winner.ts)}|${timestampKey(loser.ts)}`;
      if (this.reportedConflicts.has(id)) continue;
      if (this.reportedConflicts.size >= MAX_REMEMBERED_CONFLICTS) this.reportedConflicts.clear();
      this.reportedConflicts.add(id);
      this.emitter.emit({ type: 'conflict', key, winner, loser });
    }
  }

  private scheduleVerification(keys: readonly FieldKey<T>[]): void {
    for (const key of keys) this.pendingVerification.add(key);
    if (this.verifyTimer !== undefined) return;
    this.verifyTimer = setTimeout(() => {
      this.verifyTimer = undefined;
      this.flush();
    }, this.verifyDelayMs);
  }

  /** Writes back every explicit entry that storage holds an older version of (or lacks). */
  private repair(keys: readonly FieldKey<T>[]): void {
    const repaired: FieldKey<T>[] = [];
    for (const key of keys) {
      const entry = this.entries[key];
      if (isZeroTimestamp(entry.ts)) continue;
      if (this.persistence.writeIfNewer(key, entry) === 'written') repaired.push(key);
    }
    if (repaired.length > 0) this.emitter.emit({ type: 'repair', keys: repaired });
  }

  private commit(entries: EntryMap<T>): void {
    this.entries = entries;
    this.values = toValues(entries);
  }
}
