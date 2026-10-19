import { Emitter } from './emitter';
import { createEnvelope, isEnvelope, preciseNow, type Envelope } from './protocol';
import type { Transport } from './transport';

export interface PeerInfo {
  readonly id: string;
  /** Digest of the peer's replicated state as of its latest ping or pong. */
  readonly digest: string;
  /** Latest measured round-trip time to the peer, in milliseconds. */
  readonly rttMs: number | null;
  readonly lastSeen: number;
}

export interface PeersEvent {
  readonly peers: readonly PeerInfo[];
  readonly joined: readonly string[];
  readonly left: readonly string[];
}

interface PingMessage extends Envelope<'ping'> {
  readonly digest: string;
}

interface PongMessage extends Envelope<'pong'> {
  readonly to: string;
  /** The ping's `sentAt`, echoed back so the pinging tab can compute the round trip. */
  readonly pingSentAt: number;
  readonly digest: string;
}

export interface PresenceOptions {
  readonly transport: Transport;
  readonly nodeId: string;
  /** Returns the digest of this tab's current state. */
  readonly digest: () => string;
  readonly intervalMs?: number;
  readonly refreshDelayMs?: number;
  readonly now?: () => number;
}

/**
 * Tracks which other tabs are open and whether their state matches this tab's.
 *
 * While visible, a tab pings every few seconds and every tab answers immediately with a pong
 * carrying its state digest. Answering is message-driven rather than timer-driven, so it keeps
 * working in background tabs whose timers the browser throttles. A peer that misses two ping
 * rounds in a row is dropped (one is tolerated, as a busy tab may answer late); a closing tab
 * says goodbye, so it disappears at once.
 */
export class Presence {
  private readonly transport: Transport;
  private readonly nodeId: string;
  private readonly digest: () => string;
  private readonly intervalMs: number;
  private readonly refreshDelayMs: number;
  private readonly now: () => number;
  private readonly peers = new Map<string, PeerInfo>();
  private readonly emitter = new Emitter<PeersEvent>();
  private unsubscribe: (() => void) | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** Start times of the two most recent periodic ping rounds, oldest first. */
  private rounds: readonly [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  constructor(options: PresenceOptions) {
    this.transport = options.transport;
    this.nodeId = options.nodeId;
    this.digest = options.digest;
    this.intervalMs = options.intervalMs ?? 2000;
    this.refreshDelayMs = options.refreshDelayMs ?? 100;
    this.now = options.now ?? preciseNow;
  }

  start(): void {
    this.unsubscribe ??= this.transport.subscribe((message) => this.handleMessage(message));
    this.resume();
  }

  /** Starts (or restarts) periodic pinging. Idempotent. */
  resume(): void {
    if (this.interval !== undefined) return;
    this.startRound();
    this.interval = setInterval(() => this.tick(), this.intervalMs);
  }

  /** Stops periodic pinging, e.g. while the tab is hidden. The tab still answers pings. */
  pause(): void {
    clearInterval(this.interval);
    this.interval = undefined;
  }

  /** Tells the other tabs this one is going away (closing or entering the back/forward cache). */
  leave(): void {
    this.pause();
    this.transport.send(createEnvelope('bye', this.nodeId, this.now()));
  }

  stop(): void {
    this.leave();
    clearTimeout(this.refreshTimer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.emitter.clear();
  }

  /** Pings soon, so peers' digests are refreshed shortly after the state changed. */
  refreshSoon(): void {
    if (this.refreshTimer !== undefined) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.ping();
    }, this.refreshDelayMs);
  }

  getPeers(): readonly PeerInfo[] {
    return [...this.peers.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  subscribe(listener: (event: PeersEvent) => void): () => void {
    return this.emitter.on(listener);
  }

  private tick(): void {
    // Peers silent since before the previous round answered neither of the last two rounds:
    // they are gone (closed, crashed or frozen).
    const cutoff = this.rounds[0];
    const left: string[] = [];
    for (const peer of this.peers.values()) {
      if (peer.lastSeen < cutoff) left.push(peer.id);
    }
    for (const id of left) this.peers.delete(id);
    if (left.length > 0) this.notify([], left);
    this.startRound();
  }

  private startRound(): void {
    this.rounds = [this.rounds[1], this.now()];
    this.ping();
  }

  private ping(): void {
    const message: PingMessage = {
      ...createEnvelope('ping', this.nodeId, this.now()),
      digest: this.digest(),
    };
    this.transport.send(message);
  }

  private handleMessage(raw: unknown): void {
    if (!isEnvelope(raw) || raw.from === this.nodeId) return;
    switch (raw.type) {
      case 'ping': {
        if (typeof raw['digest'] !== 'string') return;
        this.upsert(raw.from, raw['digest'], undefined);
        const pong: PongMessage = {
          ...createEnvelope('pong', this.nodeId, this.now()),
          to: raw.from,
          pingSentAt: raw.sentAt,
          digest: this.digest(),
        };
        this.transport.send(pong);
        return;
      }
      case 'pong': {
        const { to, pingSentAt, digest } = raw;
        if (to !== this.nodeId || typeof digest !== 'string' || typeof pingSentAt !== 'number') {
          return;
        }
        this.upsert(raw.from, digest, Math.max(0, this.now() - pingSentAt));
        return;
      }
      case 'bye': {
        if (this.peers.delete(raw.from)) this.notify([], [raw.from]);
        return;
      }
      default: {
        // Any other message still proves a known peer is alive.
        const known = this.peers.get(raw.from);
        if (known !== undefined) this.peers.set(raw.from, { ...known, lastSeen: this.now() });
      }
    }
  }

  private upsert(id: string, digest: string, rttMs: number | undefined): void {
    const previous = this.peers.get(id);
    const peer: PeerInfo = {
      id,
      digest,
      rttMs: rttMs ?? previous?.rttMs ?? null,
      lastSeen: this.now(),
    };
    this.peers.set(id, peer);
    if (previous === undefined) this.notify([id], []);
    else if (previous.digest !== peer.digest || previous.rttMs !== peer.rttMs) this.notify([], []);
  }

  private notify(joined: readonly string[], left: readonly string[]): void {
    this.emitter.emit({ peers: this.getPeers(), joined, left });
  }
}
