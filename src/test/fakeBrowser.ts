import {
  EntryPersistence,
  type ExternalChangeSource,
  type KeyValueStorage,
} from '../sync/persistence';
import { SyncedStore, type SyncedStoreOptions } from '../sync/store';
import type { MessageHandler, Transport } from '../sync/transport';
import type { Schema } from '../sync/types';

type StorageOp =
  | { readonly kind: 'set'; readonly key: string; readonly value: string }
  | { readonly kind: 'clear' };

interface Notification {
  readonly op: StorageOp;
  readonly origin: FakeTab;
}

/**
 * Deterministic in-memory model of several tabs of one origin, for tests.
 *
 * It reproduces the delivery behaviour the sync layer has to survive in real browsers, with
 * the test (or a seeded random scheduler) deciding what happens next:
 *
 * - Broadcasts are delivered asynchronously, in any order, optionally more than once.
 * - localStorage follows Chromium's multi-process design. Each tab reads a local cache. Its
 *   writes apply to the cache at once and travel to a shared backend over a FIFO channel; the
 *   backend applies writes in arrival order and notifies every tab over a per-tab FIFO channel.
 *   A tab ignores notifications for keys it has unacknowledged writes to (those notifications
 *   describe writes the backend ordered before its own), and fires `storage` events for other
 *   tabs' writes. So tabs read stale data and racing read-merge-write cycles clobber each
 *   other, yet every cache ends up equal to the backend, as in the real thing.
 */
export class FakeBrowser {
  readonly backend = new Map<string, string>();
  private readonly broadcasts: (() => void)[] = [];
  private readonly tabs = new Set<FakeTab>();
  /** Every tab ever opened; closed tabs may still have writes in flight to the backend. */
  private readonly allTabs: FakeTab[] = [];

  constructor(
    private readonly random: () => number = Math.random,
    /** Probability that a broadcast reaches a given tab twice. */
    private readonly duplicateRate = 0,
  ) {}

  /** Opens a tab whose cache starts as a snapshot of the backend, like a new renderer. */
  openTab(): FakeTab {
    const tab = new FakeTab(this, new Map(this.backend));
    this.tabs.add(tab);
    this.allTabs.push(tab);
    return tab;
  }

  /** Nothing is delivered to a closed tab any more; what it already sent still arrives. */
  closeTab(tab: FakeTab): void {
    tab.closed = true;
    this.tabs.delete(tab);
  }

  get pendingCount(): number {
    return this.steps().length;
  }

  /** Performs one pending step chosen at random. Returns false when nothing is pending. */
  step(): boolean {
    const steps = this.steps();
    if (steps.length === 0) return false;
    steps[Math.floor(this.random() * steps.length)]?.();
    return true;
  }

  /** Performs pending steps in random order until none are left. */
  deliverAll(): void {
    while (this.step()) {
      // Steps may schedule further steps.
    }
  }

  /** Delivers all broadcasts first (in send order), then all storage traffic. */
  deliverInOrder(): void {
    for (;;) {
      const broadcast = this.broadcasts.shift();
      if (broadcast !== undefined) {
        broadcast();
        continue;
      }
      const tab = this.allTabs.find((candidate) => candidate.hasStorageTraffic());
      if (tab === undefined) return;
      if (!tab.flushOutgoing()) tab.deliverNotification();
    }
  }

  broadcast(from: FakeTab, message: object): void {
    const payload = JSON.stringify(message);
    for (const tab of this.tabs) {
      if (tab === from) continue;
      const copies = this.random() < this.duplicateRate ? 2 : 1;
      for (let i = 0; i < copies; i += 1) {
        this.broadcasts.push(() => tab.receive(JSON.parse(payload)));
      }
    }
  }

  /** Applies a write that reached the backend and notifies every open tab, in order. */
  commit(origin: FakeTab, op: StorageOp): void {
    if (op.kind === 'set') this.backend.set(op.key, op.value);
    else this.backend.clear();
    for (const tab of this.tabs) tab.enqueueNotification({ op, origin });
  }

  private steps(): (() => void)[] {
    const steps: (() => void)[] = this.broadcasts.map(
      (_, index) => () => this.broadcasts.splice(index, 1)[0]?.(),
    );
    for (const tab of this.allTabs) {
      if (tab.hasOutgoing()) steps.push(() => tab.flushOutgoing());
      if (tab.hasNotifications()) steps.push(() => tab.deliverNotification());
    }
    return steps;
  }
}

export class FakeTab {
  closed = false;
  private readonly handlers = new Set<MessageHandler>();
  private readonly storageListeners = new Set<
    (key: string | null, newValue: string | null) => void
  >();
  private readonly outgoing: StorageOp[] = [];
  private readonly notifications: Notification[] = [];
  /** Writes per key that this tab made and the backend has not acknowledged yet. */
  private readonly unacknowledged = new Map<string, number>();
  /** Clears this tab made that the backend has not acknowledged yet. */
  private pendingClears = 0;

  constructor(
    private readonly browser: FakeBrowser,
    /** This tab's local storage cache. */
    readonly view: Map<string, string>,
  ) {}

  readonly transport: Transport = {
    kind: 'broadcast-channel',
    send: (message) => {
      if (!this.closed) this.browser.broadcast(this, message);
    },
    subscribe: (handler) => {
      this.handlers.add(handler);
      return () => this.handlers.delete(handler);
    },
    close: () => this.handlers.clear(),
  };

  readonly storage: KeyValueStorage = {
    getItem: (key) => this.view.get(key) ?? null,
    setItem: (key, value) => {
      if (this.closed) return; // A closed tab can no longer write.
      this.view.set(key, value);
      this.unacknowledged.set(key, (this.unacknowledged.get(key) ?? 0) + 1);
      this.outgoing.push({ kind: 'set', key, value });
    },
  };

  readonly changes: ExternalChangeSource = (listener) => {
    this.storageListeners.add(listener);
    return () => this.storageListeners.delete(listener);
  };

  /** Simulates `localStorage.clear()` run in this tab (for example from the dev tools). */
  clearStorage(): void {
    this.view.clear();
    this.pendingClears += 1;
    this.outgoing.push({ kind: 'clear' });
  }

  receive(message: unknown): void {
    if (this.closed) return;
    for (const handler of [...this.handlers]) handler(message);
  }

  hasOutgoing(): boolean {
    return this.outgoing.length > 0;
  }

  hasNotifications(): boolean {
    return this.notifications.length > 0;
  }

  hasStorageTraffic(): boolean {
    return this.hasOutgoing() || this.hasNotifications();
  }

  /** Sends this tab's oldest pending write to the backend. Returns false if there was none. */
  flushOutgoing(): boolean {
    const op = this.outgoing.shift();
    if (op === undefined) return false;
    this.browser.commit(this, op);
    return true;
  }

  enqueueNotification(notification: Notification): void {
    if (!this.closed) this.notifications.push(notification);
  }

  deliverNotification(): void {
    const notification = this.notifications.shift();
    if (notification === undefined || this.closed) return;
    const { op, origin } = notification;
    if (origin === this) {
      if (op.kind === 'clear') {
        this.pendingClears -= 1;
      } else {
        const count = (this.unacknowledged.get(op.key) ?? 1) - 1;
        if (count > 0) this.unacknowledged.set(op.key, count);
        else this.unacknowledged.delete(op.key);
      }
      return;
    }
    if (op.kind === 'set') {
      // A pending local write or clear means the backend ordered this write before it.
      if (!this.unacknowledged.has(op.key) && this.pendingClears === 0) {
        this.view.set(op.key, op.value);
      }
      this.emitStorageEvent(op.key, op.value);
    } else {
      for (const key of [...this.view.keys()]) {
        if (!this.unacknowledged.has(key)) this.view.delete(key);
      }
      this.emitStorageEvent(null, null);
    }
  }

  private emitStorageEvent(key: string | null, newValue: string | null): void {
    for (const listener of [...this.storageListeners]) listener(key, newValue);
  }
}

/** A small document type covering every primitive type. */
export type TestDoc = { color: string; size: number; enabled: boolean };

export const COLORS = ['red', 'green', 'blue', 'amber'] as const;

export const testSchema: Schema<TestDoc> = {
  color: {
    defaultValue: () => 'red',
    isValid: (value): value is string =>
      typeof value === 'string' && (COLORS as readonly string[]).includes(value),
  },
  size: {
    defaultValue: () => 16,
    isValid: (value): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= 12 && value <= 24,
  },
  enabled: {
    defaultValue: () => false,
    isValid: (value): value is boolean => typeof value === 'boolean',
  },
};

export const TEST_NAMESPACE = 'test:v1';

export function createTestStore(
  tab: FakeTab,
  options: Omit<Partial<SyncedStoreOptions<TestDoc>>, 'schema' | 'persistence' | 'transport'> = {},
): SyncedStore<TestDoc> {
  const persistence = new EntryPersistence({
    schema: testSchema,
    storage: tab.storage,
    namespace: TEST_NAMESPACE,
    changes: tab.changes,
  });
  return new SyncedStore({
    schema: testSchema,
    persistence,
    transport: tab.transport,
    verifyDelayMs: 10,
    ...options,
  });
}

/** Small, fast, seedable PRNG (mulberry32), so a failing property run can be replayed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
