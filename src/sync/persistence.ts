import { decodeEntry } from './codec';
import { compareEntries, type Entry, type PartialEntryMap } from './lww';
import { fieldKeys, type FieldKey, type Fields, type Schema } from './types';

/** The subset of the Web Storage API the persistence layer needs. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Subscribes to writes made by *other* tabs, mirroring the `storage` event: the listener gets
 * the key that changed and the value that was written (`null` if it was removed). The key is
 * `null` when storage was cleared.
 */
export type ExternalChangeSource = (
  listener: (key: string | null, newValue: string | null) => void,
) => () => void;

export function windowStorageEvents(target: Window = window): ExternalChangeSource {
  return (listener) => {
    const onStorage = (event: StorageEvent): void => listener(event.key, event.newValue);
    target.addEventListener('storage', onStorage);
    return () => target.removeEventListener('storage', onStorage);
  };
}

/** Returns `localStorage`, or `null` where access is blocked (e.g. storage disabled by policy). */
export function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export type WriteResult = 'written' | 'skipped' | 'failed';

export interface EntryPersistenceOptions<T extends Fields> {
  readonly schema: Schema<T>;
  /** `null` when no storage is available; the store then runs purely in memory. */
  readonly storage: KeyValueStorage | null;
  /** Prefix of every storage key. Bump its version when the stored format changes. */
  readonly namespace: string;
  /** Source of other tabs' writes; without one, changes are only seen via the transport. */
  readonly changes?: ExternalChangeSource | undefined;
}

/**
 * Persists each field under its own key (`<namespace>:<field>`) as `{ value, ts }`.
 *
 * One key per field keeps concurrent writes to *different* fields from overwriting each other:
 * localStorage has no transactions, so a tab saving a whole document would silently undo a
 * field another tab saved a moment earlier. Writes are also read-merge-write, so a tab never
 * replaces a newer stored entry with an older one.
 */
export class EntryPersistence<T extends Fields> {
  private readonly schema: Schema<T>;
  private readonly storage: KeyValueStorage | null;
  private readonly prefix: string;
  private readonly changes: ExternalChangeSource | undefined;
  private failing = false;

  constructor(options: EntryPersistenceOptions<T>) {
    this.schema = options.schema;
    this.storage = options.storage;
    this.prefix = `${options.namespace}:`;
    this.changes = options.changes;
  }

  /** False when there is no storage or the last write failed (e.g. quota exceeded). */
  get isAvailable(): boolean {
    return this.storage !== null && !this.failing;
  }

  storageKey(field: FieldKey<T>): string {
    return this.prefix + field;
  }

  read<K extends FieldKey<T>>(field: K): Entry<T[K]> | undefined {
    if (this.storage === null) return undefined;
    try {
      return this.decode(field, this.storage.getItem(this.storageKey(field)));
    } catch {
      // Unreadable storage: treat the field as never written.
      return undefined;
    }
  }

  readAll(): PartialEntryMap<T> {
    const entries: Partial<Record<FieldKey<T>, Entry>> = {};
    for (const field of fieldKeys(this.schema)) {
      const entry = this.read(field);
      if (entry !== undefined) entries[field] = entry;
    }
    return entries as PartialEntryMap<T>;
  }

  /** Persists `entry` unless storage already holds an equal or newer entry for the field. */
  writeIfNewer<K extends FieldKey<T>>(field: K, entry: Entry<T[K]>): WriteResult {
    if (this.storage === null) return 'failed';
    const stored = this.read(field);
    if (stored !== undefined && compareEntries(stored, entry) >= 0) return 'skipped';
    try {
      this.storage.setItem(this.storageKey(field), JSON.stringify(entry));
      this.failing = false;
      return 'written';
    } catch {
      this.failing = true;
      return 'failed';
    }
  }

  /**
   * Notifies about fields other tabs wrote, with the entry they wrote (`undefined` if it was
   * removed or is invalid). The field is `null` when the whole storage was cleared.
   *
   * The entry comes from the event itself rather than from re-reading storage: a tab's view
   * of storage can lag behind, or be shadowed by its own pending write, while the event
   * always describes the write that actually happened.
   */
  subscribe(listener: (field: FieldKey<T> | null, entry: Entry | undefined) => void): () => void {
    if (this.changes === undefined) return () => undefined;
    return this.changes((key, newValue) => {
      if (key === null) {
        listener(null, undefined);
        return;
      }
      const field = this.fieldFromKey(key);
      if (field !== undefined) listener(field, this.decode(field, newValue));
    });
  }

  private decode<K extends FieldKey<T>>(field: K, raw: string | null): Entry<T[K]> | undefined {
    if (raw === null) return undefined;
    try {
      return decodeEntry(this.schema[field], JSON.parse(raw));
    } catch {
      return undefined; // Corrupt JSON.
    }
  }

  private fieldFromKey(key: string): FieldKey<T> | undefined {
    if (!key.startsWith(this.prefix)) return undefined;
    const name = key.slice(this.prefix.length);
    return Object.hasOwn(this.schema, name) ? (name as FieldKey<T>) : undefined;
  }
}
