/**
 * Hybrid Logical Clock (Kulkarni et al., 2014).
 *
 * A timestamp pairs wall-clock time with a logical counter, so timestamps
 *  - stay close to real time, making "last writer wins" match what the user expects;
 *  - are strictly increasing per tab, even when the system clock stalls or jumps backwards;
 *  - respect causality: once a tab has observed a timestamp, everything it issues afterwards
 *    is ordered after it. A tab that just received an update can therefore always overwrite it.
 *
 * The issuing node id breaks the remaining ties, which turns the order into a total order that
 * every tab computes identically.
 */
export interface Timestamp {
  /** Wall-clock component, in milliseconds since the Unix epoch. */
  readonly wall: number;
  /** Logical counter ordering events that share the same wall time. */
  readonly counter: number;
  /** Id of the tab that issued the timestamp. */
  readonly node: string;
}

/** Sorts before every real timestamp. Marks values that were never explicitly written. */
export const ZERO_TIMESTAMP: Timestamp = Object.freeze({ wall: 0, counter: 0, node: '' });

/** Total order over timestamps: wall time, then counter, then node id. */
export function compareTimestamps(a: Timestamp, b: Timestamp): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.node !== b.node) return a.node < b.node ? -1 : 1;
  return 0;
}

export function isZeroTimestamp(ts: Timestamp): boolean {
  return compareTimestamps(ts, ZERO_TIMESTAMP) === 0;
}

export class HybridLogicalClock {
  private wall = 0;
  private counter = 0;

  constructor(
    readonly node: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Issues a timestamp for a local write, greater than every timestamp issued or observed so far. */
  tick(): Timestamp {
    const now = Math.floor(this.now());
    if (now > this.wall) {
      this.wall = now;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return { wall: this.wall, counter: this.counter, node: this.node };
  }

  /** Folds in a timestamp seen from another tab so that later ticks are ordered after it. */
  observe(remote: Timestamp): void {
    if (remote.wall > this.wall || (remote.wall === this.wall && remote.counter > this.counter)) {
      this.wall = remote.wall;
      this.counter = remote.counter;
    }
  }
}
