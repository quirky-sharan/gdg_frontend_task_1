import { FONT_SIZE, type Preferences, type Theme } from '../preferences/preferences';
import { Emitter } from '../sync/emitter';
import { createEnvelope, isEnvelope, preciseNow, type Envelope } from '../sync/protocol';
import type { SyncedStore } from '../sync/store';
import type { Transport } from '../sync/transport';

interface ConflictTestMessage extends Envelope<'conflict-test'> {
  /** High-resolution epoch milliseconds at which every tab writes. */
  readonly at: number;
}

/** How long before the shared moment each tab starts spinning, by default. */
const SPIN_MS = 25;
/** Upper bound on spinning, in case a timer fires far too early. */
const MAX_SPIN_MS = 60;

export interface ConflictTestOptions {
  readonly transport: Transport;
  readonly store: SyncedStore<Preferences>;
  /** How far ahead the shared write moment is scheduled, so the message reaches every tab first. */
  readonly leadMs?: number;
  /** How long before the moment to start busy-waiting; 0 disables it (for fake timers). */
  readonly spinMs?: number;
  readonly random?: () => number;
  /** High-resolution epoch clock shared by all tabs. */
  readonly now?: () => number;
}

/**
 * Demonstrates conflict resolution on demand: every open tab writes its own random theme and
 * font size at the same agreed instant, so the writes genuinely race. Afterwards every tab must
 * show the same values (the digests in the sync monitor make that visible).
 */
export class ConflictTest {
  private readonly transport: Transport;
  private readonly store: SyncedStore<Preferences>;
  private readonly leadMs: number;
  private readonly spinMs: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly emitter = new Emitter<{ readonly initiator: string }>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly unsubscribe: () => void;

  constructor(options: ConflictTestOptions) {
    this.transport = options.transport;
    this.store = options.store;
    this.leadMs = options.leadMs ?? 300;
    this.spinMs = options.spinMs ?? SPIN_MS;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? preciseNow;
    this.unsubscribe = this.transport.subscribe((message) => this.handleMessage(message));
  }

  /** Asks every tab, including this one, to write at the same moment. */
  start(): void {
    const at = this.now() + this.leadMs;
    const message: ConflictTestMessage = {
      ...createEnvelope('conflict-test', this.store.nodeId, this.now()),
      at,
    };
    this.transport.send(message);
    this.schedule(at, this.store.nodeId);
  }

  subscribe(listener: (event: { readonly initiator: string }) => void): () => void {
    return this.emitter.on(listener);
  }

  destroy(): void {
    this.unsubscribe();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.emitter.clear();
  }

  private handleMessage(raw: unknown): void {
    if (!isEnvelope(raw) || raw.type !== 'conflict-test' || raw.from === this.store.nodeId) return;
    const at = raw['at'];
    // Ignore malformed or absurd schedules rather than writing at an arbitrary time.
    if (typeof at !== 'number' || !Number.isFinite(at) || Math.abs(at - this.now()) > 10_000) {
      return;
    }
    this.schedule(at, raw.from);
  }

  private schedule(at: number, initiator: string): void {
    this.emitter.emit({ initiator });
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        // Timers in different tabs fire several milliseconds apart, longer than a message takes
        // to arrive. Spinning on the high-resolution clock for the last stretch makes every tab
        // write at the same instant, before it can process any other tab's write, so the writes
        // are genuinely concurrent.
        const deadline = Math.min(at, this.now() + MAX_SPIN_MS);
        while (this.spinMs > 0 && this.now() < deadline) {
          // Busy-wait.
        }
        this.store.update(this.randomPreferences());
      },
      Math.max(0, at - this.now() - this.spinMs),
    );
    this.timers.add(timer);
  }

  private randomPreferences(): Pick<Preferences, 'theme' | 'fontSize'> {
    const theme: Theme = this.random() < 0.5 ? 'light' : 'dark';
    const span = FONT_SIZE.max - FONT_SIZE.min + 1;
    const fontSize = FONT_SIZE.min + Math.min(span - 1, Math.floor(this.random() * span));
    return { theme, fontSize };
  }
}
