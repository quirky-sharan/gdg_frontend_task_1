import { describe, expect, it, vi } from 'vitest';
import { testSchema, type TestDoc } from '../test/fakeBrowser';
import type { Entry } from './lww';
import { EntryPersistence, type ExternalChangeSource, type KeyValueStorage } from './persistence';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function entry<V extends string | number | boolean>(value: V, wall: number, node = 'a'): Entry<V> {
  return { value, ts: { wall, counter: 0, node } };
}

function persistenceWith(storage: KeyValueStorage | null, changes?: ExternalChangeSource) {
  return new EntryPersistence<TestDoc>({ schema: testSchema, storage, namespace: 'ns', changes });
}

describe('EntryPersistence', () => {
  it('stores each field under its own key and reads it back', () => {
    const storage = memoryStorage();
    const persistence = persistenceWith(storage);
    expect(persistence.writeIfNewer('color', entry('blue', 5))).toBe('written');
    expect([...storage.data.keys()]).toEqual(['ns:color']);
    expect(JSON.parse(storage.data.get('ns:color') ?? '')).toEqual(entry('blue', 5));
    expect(persistence.readAll()).toEqual({ color: entry('blue', 5) });
  });

  it('never replaces a newer or equal stored entry', () => {
    const persistence = persistenceWith(memoryStorage());
    persistence.writeIfNewer('size', entry(20, 10));
    expect(persistence.writeIfNewer('size', entry(14, 9))).toBe('skipped');
    expect(persistence.writeIfNewer('size', entry(20, 10))).toBe('skipped');
    expect(persistence.writeIfNewer('size', entry(18, 11))).toBe('written');
    expect(persistence.read('size')).toEqual(entry(18, 11));
  });

  it('treats corrupt or invalid stored data as missing', () => {
    const storage = memoryStorage();
    storage.data.set('ns:color', '{not json');
    storage.data.set('ns:size', JSON.stringify(entry(99, 1)));
    storage.data.set('ns:enabled', JSON.stringify({ value: true }));
    expect(persistenceWith(storage).readAll()).toEqual({});
  });

  it('reports failed writes and recovers once writing works again', () => {
    const storage = memoryStorage();
    const quotaExceeded = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const persistence = persistenceWith(storage);
    expect(persistence.writeIfNewer('color', entry('blue', 1))).toBe('failed');
    expect(persistence.isAvailable).toBe(false);
    expect(persistence.writeIfNewer('color', entry('blue', 1))).toBe('written');
    expect(persistence.isAvailable).toBe(true);
    expect(quotaExceeded).toHaveBeenCalledTimes(2);
  });

  it('survives storage whose reads throw', () => {
    const persistence = persistenceWith({
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => undefined,
    });
    expect(persistence.readAll()).toEqual({});
  });

  it('works without any storage', () => {
    const persistence = persistenceWith(null);
    expect(persistence.isAvailable).toBe(false);
    expect(persistence.readAll()).toEqual({});
    expect(persistence.writeIfNewer('color', entry('blue', 1))).toBe('failed');
  });

  it('maps storage events to fields, decoding the written value from the event', () => {
    let emit: (key: string | null, newValue: string | null) => void = () => undefined;
    const storage = memoryStorage();
    storage.data.set('ns:size', JSON.stringify(entry(12, 1))); // A stale local view.
    const persistence = persistenceWith(storage, (listener) => {
      emit = listener;
      return () => undefined;
    });
    const seen: unknown[] = [];
    persistence.subscribe((field, written) => seen.push([field, written]));
    emit('ns:size', JSON.stringify(entry(20, 9)));
    emit('ns:color', null);
    emit('ns:enabled', '{corrupt');
    emit('ns:unknown', JSON.stringify(entry(1, 1)));
    emit('other:size', JSON.stringify(entry(20, 9)));
    emit('ns:toString', null);
    emit(null, null);
    expect(seen).toEqual([
      ['size', entry(20, 9)],
      ['color', undefined],
      ['enabled', undefined],
      [null, undefined],
    ]);
  });
});
