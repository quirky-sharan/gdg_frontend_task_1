import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferencesSchema, STORAGE_NAMESPACE } from '../preferences/preferences';
import { EntryPersistence } from '../sync/persistence';
import { SyncedStore } from '../sync/store';
import { FakeBrowser } from '../test/fakeBrowser';
import { ConflictTest } from './conflictTest';

function createTab(browser: FakeBrowser, nodeId: string, random: () => number) {
  const tab = browser.openTab();
  const store = new SyncedStore({
    schema: preferencesSchema,
    persistence: new EntryPersistence({
      schema: preferencesSchema,
      storage: tab.storage,
      namespace: STORAGE_NAMESPACE,
      changes: tab.changes,
    }),
    transport: tab.transport,
    nodeId,
  });
  store.start();
  const test = new ConflictTest({
    transport: tab.transport,
    store,
    leadMs: 300,
    spinMs: 0,
    random,
    now: () => Date.now(),
  });
  return { tab, store, test };
}

describe('ConflictTest', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('makes every tab write at the agreed moment, after which all tabs agree', () => {
    const browser = new FakeBrowser();
    const a = createTab(browser, 'aaaa', () => 0.1); // light, small font
    const b = createTab(browser, 'bbbb', () => 0.9); // dark, large font
    const started: string[] = [];
    b.test.subscribe(({ initiator }) => started.push(initiator));

    a.test.start();
    browser.deliverInOrder();
    expect(started).toEqual(['aaaa']);
    vi.advanceTimersByTime(400);
    browser.deliverInOrder();

    expect(a.store.getState()).toEqual(b.store.getState());
    expect(a.store.digest()).toBe(b.store.digest());
    for (const { store, test } of [a, b]) {
      test.destroy();
      store.destroy();
    }
  });

  it('ignores schedules that are malformed or far from now', () => {
    const browser = new FakeBrowser();
    const a = createTab(browser, 'aaaa', () => 0.5);
    const started = vi.fn();
    a.test.subscribe(started);
    const base = { v: 1, type: 'conflict-test', from: 'zzzz', sentAt: 0 };
    a.tab.receive({ ...base, at: 'soon' });
    a.tab.receive({ ...base, at: Date.now() + 60_000 });
    expect(started).not.toHaveBeenCalled();
    a.test.destroy();
    a.store.destroy();
  });
});
