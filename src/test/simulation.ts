import type { Entry } from '../sync/lww';
import type { SyncedStore } from '../sync/store';
import {
  COLORS,
  createTestStore,
  FakeBrowser,
  seededRandom,
  type FakeTab,
  type TestDoc,
} from './fakeBrowser';

/*
 * Drives a FakeBrowser through a sequence of operations: several tabs with skewed clocks
 * write concurrently while messages and storage traffic are delivered in a seeded random
 * order, tabs open and close (gracefully or abruptly) and storage gets cleared.
 */

export const FIELDS = ['color', 'size', 'enabled'] as const;
export type Field = (typeof FIELDS)[number];

export type Op =
  | { readonly kind: 'write'; readonly tab: number; readonly field: Field; readonly pick: number }
  | { readonly kind: 'step'; readonly count: number }
  | { readonly kind: 'tick'; readonly ms: number }
  | { readonly kind: 'flush'; readonly tab: number }
  | { readonly kind: 'open' }
  | { readonly kind: 'close'; readonly tab: number; readonly graceful: boolean }
  /** Storage cleared from another context, e.g. the dev tools or another page of the origin. */
  | { readonly kind: 'clear' };

export interface SimulatedTab {
  readonly id: string;
  readonly tab: FakeTab;
  readonly store: SyncedStore<TestDoc>;
}

export interface SimulationResult {
  readonly browser: FakeBrowser;
  /** Tabs still open at the end. */
  readonly tabs: readonly SimulatedTab[];
  /** Every write that took effect, per field. */
  readonly writes: Readonly<Record<Field, readonly Entry[]>>;
  /** Every store created, so the caller can destroy them. */
  readonly stores: readonly SyncedStore<TestDoc>[];
}

export function valueFor(field: Field, pick: number): TestDoc[Field] {
  if (field === 'color') return COLORS[pick % COLORS.length] as string;
  if (field === 'size') return 12 + (pick % 13);
  return pick % 2 === 0;
}

export interface SimulationOptions {
  /** Probability that a broadcast reaches a given tab twice. */
  readonly duplicateRate?: number;
  /**
   * Deliver everything in flight before a tab closes. Models users who do not close a tab
   * within the few milliseconds a message takes to arrive.
   */
  readonly settleBeforeClose?: boolean;
  readonly trace?: (line: string) => void;
}

export function simulate(
  seed: number,
  ops: readonly Op[],
  { duplicateRate = 0, settleBeforeClose = false, trace = () => undefined }: SimulationOptions = {},
): SimulationResult {
  const random = seededRandom(seed);
  const browser = new FakeBrowser(random, duplicateRate);
  let now = 1_000_000;
  const tabs: SimulatedTab[] = [];
  const stores: SyncedStore<TestDoc>[] = [];
  const writes: Record<Field, Entry[]> = { color: [], size: [], enabled: [] };

  const openTab = (): void => {
    const tab = browser.openTab();
    const skew = Math.floor(random() * 41) - 20; // Clocks disagree by up to ±20 ms.
    const id = `tab${String(stores.length).padStart(2, '0')}`;
    const store = createTestStore(tab, { nodeId: id, wallClock: () => now + skew });
    store.subscribe((event) => trace(`${id} ${JSON.stringify(event)}`));
    stores.push(store);
    trace(`open ${id} skew=${skew} storage=${JSON.stringify([...tab.view.values()])}`);
    store.start();
    tabs.push({ id, tab, store });
  };
  const pick = (index: number): SimulatedTab => {
    const tab = tabs[index % tabs.length];
    if (tab === undefined) throw new Error('no open tab');
    return tab;
  };
  const outsider = browser.openTab(); // A page of the origin that does not run the app.

  /** Lets everything in flight arrive, including the deferred storage checks. */
  const settle = (): void => {
    for (let round = 0; ; round += 1) {
      if (round > 500) throw new Error('the system did not quiesce');
      browser.deliverAll();
      for (const { store } of tabs) store.flush();
      if (browser.pendingCount === 0) return;
    }
  };

  openTab();
  openTab();
  for (const op of ops) {
    switch (op.kind) {
      case 'write': {
        const { id, store } = pick(op.tab);
        const before = store.getEntries()[op.field];
        store.set(op.field, valueFor(op.field, op.pick));
        const after = store.getEntries()[op.field];
        if (after !== before) writes[op.field].push(after);
        trace(`write ${id} ${op.field}=${JSON.stringify(after)}`);
        break;
      }
      case 'step':
        for (let i = 0; i < op.count; i += 1) browser.step();
        trace(`step ${op.count} backend=${JSON.stringify([...browser.backend.values()])}`);
        break;
      case 'tick':
        now += op.ms;
        break;
      case 'flush':
        pick(op.tab).store.flush();
        break;
      case 'open':
        if (tabs.length < 6) openTab();
        break;
      case 'close': {
        if (tabs.length === 1) break;
        if (settleBeforeClose) settle();
        const [closing] = tabs.splice(op.tab % tabs.length, 1);
        if (closing === undefined) break;
        trace(`close ${closing.id} graceful=${op.graceful}`);
        if (op.graceful) closing.store.flush(); // pagehide; an abrupt close loses pending checks.
        browser.closeTab(closing.tab);
        closing.store.destroy();
        break;
      }
      case 'clear':
        trace('clear storage');
        outsider.clearStorage();
        break;
    }
  }

  settle();
  trace(`final backend=${JSON.stringify([...browser.backend.values()])}`);
  return { browser, tabs, writes, stores };
}
