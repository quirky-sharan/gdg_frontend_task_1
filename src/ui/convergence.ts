import type { PeerInfo } from '../sync/presence';

/**
 * Decides which peers visibly disagree with this tab.
 *
 * Right after any change, peers' recorded digests are stale until the next ping round
 * (about 100 ms later) confirms they caught up. A peer therefore only counts as diverged when
 * its digest has differed for longer than a grace period; otherwise the indicators would
 * flicker on every edit.
 */
export class ConvergenceTracker {
  private readonly mismatchSince = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly graceMs: number,
    /** Called when a pending mismatch outlasts the grace period, so the UI can re-render. */
    private readonly onExpire: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Returns the ids of peers whose state has differed from `ownDigest` beyond the grace period. */
  diverged(peers: readonly PeerInfo[], ownDigest: string): ReadonlySet<string> {
    const now = this.now();
    const present = new Set(peers.map((peer) => peer.id));
    for (const id of this.mismatchSince.keys()) {
      if (!present.has(id)) this.mismatchSince.delete(id);
    }

    const diverged = new Set<string>();
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const peer of peers) {
      if (peer.digest === ownDigest) {
        this.mismatchSince.delete(peer.id);
        continue;
      }
      const since = this.mismatchSince.get(peer.id) ?? now;
      this.mismatchSince.set(peer.id, since);
      if (now - since >= this.graceMs) diverged.add(peer.id);
      else nextExpiry = Math.min(nextExpiry, since + this.graceMs);
    }

    clearTimeout(this.timer);
    this.timer = undefined;
    if (Number.isFinite(nextExpiry)) {
      this.timer = setTimeout(
        () => {
          this.timer = undefined;
          this.onExpire();
        },
        nextExpiry - now + 1,
      );
    }
    return diverged;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
