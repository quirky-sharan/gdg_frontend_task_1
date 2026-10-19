import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestStore,
  FakeBrowser,
  TEST_NAMESPACE,
  testSchema,
  type FakeTab,
  type TestDoc,
} from '../test/fakeBrowser';
import { EntryPersistence } from './persistence';
import { createEnvelope, PROTOCOL_VERSION } from './protocol';
import { SyncedStore, type StoreEvent } from './store';
import type { Schema } from './types';

type Store = SyncedStore<TestDoc>;

const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.destroy();
});

function open(
  browser: FakeBrowser,
  nodeId: string,
  wallClock: () => number = () => 1_000,
): { store: Store; tab: FakeTab; events: StoreEvent<TestDoc>[] } {
  const tab = browser.openTab();
  const store = createTestStore(tab, { nodeId, wallClock });
  const events: StoreEvent<TestDoc>[] = [];
  store.subscribe((event) => events.push(event));
  store.start();
  stores.push(store);
  return { store, tab, events };
}

function stored(browser: FakeBrowser, field: keyof TestDoc): unknown {
  const raw = browser.backend.get(`${TEST_NAMESPACE}:${field}`);
  return raw === undefined ? undefined : (JSON.parse(raw) as { value: unknown }).value;
}

/** Delivers everything and runs the deferred storage checks until the system is quiet. */
function settle(browser: FakeBrowser, ...all: Store[]): void {
  for (let round = 0; round < 100; round += 1) {
    browser.deliverInOrder();
    for (const store of all) store.flush();
    if (browser.pendingCount === 0) return;
  }
  throw new Error('did not settle');
}

const changes = (events: StoreEvent<TestDoc>[]) => events.filter((e) => e.type === 'change');
const conflicts = (events: StoreEvent<TestDoc>[]) => events.filter((e) => e.type === 'conflict');

describe('SyncedStore', () => {
  it('starts from defaults when nothing is stored', () => {
    const { store } = open(new FakeBrowser(), 'aaaa');
    expect(store.getState()).toEqual({ color: 'red', size: 16, enabled: false });
  });

  it('propagates a local write to every other tab and persists it', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    const b = open(browser, 'bbbb');
    const c = open(browser, 'cccc');
    a.store.set('color', 'blue');
    expect(a.store.getState().color).toBe('blue');
    settle(browser, a.store, b.store, c.store);

    expect(b.store.getState().color).toBe('blue');
    expect(c.store.getState().color).toBe('blue');
    expect(stored(browser, 'color')).toBe('blue');
    expect(changes(a.events)).toEqual([
      { type: 'change', source: 'local', keys: ['color'], latencyMs: null },
    ]);
    expect(changes(b.events)).toEqual([
      expect.objectContaining({ source: 'remote', keys: ['color'], latencyMs: expect.any(Number) }),
    ]);
    expect(b.events.some((event) => event.type === 'delivered')).toBe(true);
  });

  it('restores persisted preferences in a tab opened later', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    a.store.update({ color: 'green', size: 20, enabled: true });
    settle(browser, a.store);
    const later = open(browser, 'dddd');
    expect(later.store.getState()).toEqual({ color: 'green', size: 20, enabled: true });
  });

  it('skips writes that would not change anything', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    a.store.set('color', 'blue');
    a.store.set('color', 'blue');
    expect(changes(a.events)).toHaveLength(1);
  });

  it('persists an explicit choice even when it equals the default', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    a.store.set('color', 'red');
    settle(browser, a.store);
    expect(stored(browser, 'color')).toBe('red');
  });

  it('rejects invalid values', () => {
    const { store } = open(new FakeBrowser(), 'aaaa');
    expect(() => store.set('size', 99)).toThrow(TypeError);
    expect(() => store.set('color', 'purple')).toThrow(TypeError);
    expect(store.getState().size).toBe(16);
  });

  it('ignores duplicate and stale updates', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa', () => 1_000);
    let now = 2_000;
    const b = open(browser, 'bbbb', () => now);
    const staleUpdate = captureNextBroadcast(b.tab, () => b.store.set('size', 18));
    now = 3_000;
    b.store.set('size', 22);
    settle(browser, a.store, b.store);
    expect(a.store.getState().size).toBe(22);

    const before = changes(a.events).length;
    a.tab.receive(staleUpdate);
    a.tab.receive(staleUpdate);
    expect(a.store.getState().size).toBe(22);
    expect(changes(a.events)).toHaveLength(before);
  });

  it('ignores messages from other protocol versions and malformed payloads', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    const ts = { wall: 5_000, counter: 0, node: 'zzzz' };
    const valid = {
      ...createEnvelope('update', 'zzzz', 0),
      entries: { color: { value: 'blue', ts } },
      prev: {},
    };
    a.tab.receive({ ...valid, v: PROTOCOL_VERSION + 1 });
    a.tab.receive({ ...valid, entries: { color: { value: 'purple', ts } } });
    a.tab.receive({ ...valid, from: '' });
    a.tab.receive('not a message');
    a.tab.receive(null);
    expect(a.store.getState().color).toBe('red');
    a.tab.receive(valid);
    expect(a.store.getState().color).toBe('blue');
  });

  it('resolves concurrent writes identically in every tab and reports the conflict in both', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    const b = open(browser, 'bbbb');
    // Same millisecond, neither has seen the other's write: the node id breaks the tie.
    a.store.set('color', 'blue');
    b.store.set('color', 'green');
    settle(browser, a.store, b.store);

    expect(a.store.getState().color).toBe('green');
    expect(b.store.getState().color).toBe('green');
    expect(a.store.digest()).toBe(b.store.digest());
    expect(stored(browser, 'color')).toBe('green');
    for (const events of [a.events, b.events]) {
      expect(conflicts(events)).toEqual([
        expect.objectContaining({
          key: 'color',
          winner: expect.objectContaining({ value: 'green' }),
          loser: expect.objectContaining({ value: 'blue' }),
        }),
      ]);
    }
  });

  it('lets the later write win when clocks differ', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'zzzz', () => 1_000);
    const b = open(browser, 'aaaa', () => 1_001);
    a.store.set('size', 13);
    b.store.set('size', 23);
    settle(browser, a.store, b.store);
    expect(a.store.getState().size).toBe(23);
    expect(b.store.getState().size).toBe(23);
  });

  it('does not report causally ordered writes as conflicts', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    const b = open(browser, 'bbbb');
    a.store.set('color', 'blue');
    settle(browser, a.store, b.store);
    b.store.set('color', 'green');
    settle(browser, a.store, b.store);
    expect(a.store.getState().color).toBe('green');
    expect(conflicts(a.events)).toEqual([]);
    expect(conflicts(b.events)).toEqual([]);
  });

  it('keeps concurrent writes to different fields', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    const b = open(browser, 'bbbb');
    a.store.set('color', 'amber');
    b.store.set('size', 12);
    settle(browser, a.store, b.store);
    for (const { store } of [a, b]) {
      expect(store.getState()).toEqual({ color: 'amber', size: 12, enabled: false });
    }
    expect(stored(browser, 'color')).toBe('amber');
    expect(stored(browser, 'size')).toBe(12);
  });

  it('orders a write after any value it has seen, even one stamped by a clock hours ahead', () => {
    const browser = new FakeBrowser();
    const hoursAhead = open(browser, 'zzzz', () => 1_000 + 3 * 3_600_000);
    const b = open(browser, 'aaaa', () => 1_000);
    hoursAhead.store.set('color', 'blue');
    settle(browser, hoursAhead.store, b.store);
    b.store.set('color', 'green');
    settle(browser, hoursAhead.store, b.store);
    expect(hoursAhead.store.getState().color).toBe('green');
    expect(b.store.getState().color).toBe('green');
  });

  it('orders a write after a newer stored value whose broadcast it has not processed yet', () => {
    const browser = new FakeBrowser();
    const fast = open(browser, 'zzzz', () => 5_000);
    const slow = open(browser, 'aaaa', () => 1_000);
    fast.store.set('color', 'blue');
    // The write is already visible in the slow tab's storage, but no event has run there yet.
    const key = `${TEST_NAMESPACE}:color`;
    slow.tab.view.set(key, fast.tab.view.get(key) ?? '');
    slow.store.set('color', 'green');
    settle(browser, fast.store, slow.store);
    expect(fast.store.getState().color).toBe('green');
    expect(slow.store.getState().color).toBe('green');
    expect(stored(browser, 'color')).toBe('green');
  });

  it('restores state from storage in a tab opened after the write', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'zzzz', () => 5_000);
    a.store.set('color', 'blue');
    browser.deliverInOrder(); // Storage holds blue; the broadcast reached no one.
    const late = open(browser, 'aaaa', () => 1_000);
    expect(late.store.getState().color).toBe('blue');
    late.store.set('color', 'green'); // Its clock is behind, yet the newer write must win.
    settle(browser, a.store, late.store);
    expect(a.store.getState().color).toBe('green');
  });

  it('sends a newcomer the entries its storage snapshot is missing', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    a.store.set('enabled', true);
    // Opened before the write reached storage, and too late to receive its broadcast.
    const newcomer = open(browser, 'nnnn');
    expect(newcomer.store.getState().enabled).toBe(false);
    settle(browser, a.store, newcomer.store);
    expect(newcomer.store.getState().enabled).toBe(true);
  });

  it('repairs storage when a racing tab overwrites a newer entry with an older one', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa', () => 2_000);
    const b = open(browser, 'bbbb', () => 1_000);
    a.store.set('color', 'blue'); // Newer.
    b.store.set('color', 'green'); // Older, and it reaches the backend last.
    const [aTab, bTab] = [a.tab, b.tab];
    aTab.flushOutgoing();
    bTab.flushOutgoing();
    expect(stored(browser, 'color')).toBe('green');

    settle(browser, a.store, b.store);
    expect(stored(browser, 'color')).toBe('blue');
    expect(a.events.some((event) => event.type === 'repair')).toBe(true);
  });

  it('repairs a clobbered entry even if the tab that wrote it has closed', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa', () => 2_000);
    const b = open(browser, 'bbbb', () => 1_000);
    a.store.set('color', 'blue');
    b.store.set('color', 'green');
    a.tab.flushOutgoing();
    b.tab.flushOutgoing();
    a.store.destroy();
    browser.closeTab(a.tab);

    settle(browser, b.store);
    expect(b.store.getState().color).toBe('blue');
    expect(stored(browser, 'color')).toBe('blue');
  });

  it('writes its state back when another tab clears storage', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    const b = open(browser, 'bbbb');
    a.store.update({ color: 'blue', size: 19 });
    settle(browser, a.store, b.store);
    b.tab.clearStorage();
    settle(browser, a.store, b.store);
    expect(stored(browser, 'color')).toBe('blue');
    expect(stored(browser, 'size')).toBe(19);
  });

  it('restores storage on resync after the tab cleared storage itself', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    a.store.set('size', 23);
    settle(browser, a.store);
    a.tab.clearStorage(); // The clearing tab itself gets no storage event...
    settle(browser, a.store);
    expect(stored(browser, 'size')).toBeUndefined();
    a.store.resync(); // ...so it repairs when it next resyncs (e.g. becomes visible again).
    settle(browser, a.store);
    expect(stored(browser, 'size')).toBe(23);
  });

  it('resync picks up writes missed while the tab was not listening', () => {
    const browser = new FakeBrowser();
    const a = open(browser, 'aaaa');
    const b = open(browser, 'bbbb');
    b.store.destroy(); // e.g. frozen in the back/forward cache
    a.store.set('size', 21);
    settle(browser, a.store);
    expect(b.store.getState().size).toBe(16);
    b.store.resync();
    expect(b.store.getState().size).toBe(21);
  });

  it('re-evaluates defaults only for fields that were never set', () => {
    let systemColor = 'red';
    const schema: Schema<TestDoc> = {
      ...testSchema,
      color: { ...testSchema.color, defaultValue: () => systemColor },
    };
    const tab = new FakeBrowser().openTab();
    const store = new SyncedStore({
      schema,
      persistence: new EntryPersistence({
        schema,
        storage: tab.storage,
        namespace: TEST_NAMESPACE,
      }),
      transport: tab.transport,
      nodeId: 'aaaa',
    });
    stores.push(store);
    const events: StoreEvent<TestDoc>[] = [];
    store.subscribe((event) => events.push(event));

    systemColor = 'amber';
    store.refreshDefaults();
    expect(store.getState().color).toBe('amber');
    expect(changes(events)).toEqual([
      { type: 'change', source: 'default', keys: ['color'], latencyMs: null },
    ]);

    store.set('color', 'blue');
    systemColor = 'green';
    store.refreshDefaults();
    expect(store.getState().color).toBe('blue');
  });
});

/** Runs `action` and returns a copy of the first broadcast it makes (which is still delivered). */
function captureNextBroadcast(tab: FakeTab, action: () => void): unknown {
  let captured: unknown;
  const original = tab.transport.send.bind(tab.transport);
  (tab.transport as { send: (message: object) => void }).send = (message) => {
    captured ??= JSON.parse(JSON.stringify(message)) as unknown;
    original(message);
  };
  try {
    action();
  } finally {
    (tab.transport as { send: (message: object) => void }).send = original;
  }
  return captured;
}
