import { createNodeId } from './ids';

export type TransportKind = 'broadcast-channel' | 'storage-event' | 'none';

export type MessageHandler = (message: unknown) => void;

/** A same-origin, cross-tab message bus. */
export interface Transport {
  readonly kind: TransportKind;
  /** Delivers `message` to every other tab. Messages are never echoed back to the sender. */
  send(message: object): void;
  /** Registers a handler for messages from other tabs and returns a function that removes it. */
  subscribe(handler: MessageHandler): () => void;
  close(): void;
}

abstract class BaseTransport implements Transport {
  abstract readonly kind: TransportKind;
  private readonly handlers = new Set<MessageHandler>();

  abstract send(message: object): void;

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.handlers.clear();
  }

  protected dispatch(message: unknown): void {
    for (const handler of [...this.handlers]) {
      try {
        handler(message);
      } catch (error) {
        // One failing consumer must not stop the others from receiving the message.
        console.error('[settings-sync] message handler failed', error);
      }
    }
  }
}

/**
 * Primary transport. BroadcastChannel delivers structured-cloned messages to all same-origin
 * browsing contexts directly, typically in well under a millisecond, without touching storage.
 */
export class BroadcastChannelTransport extends BaseTransport {
  readonly kind = 'broadcast-channel';
  private readonly channel: BroadcastChannel;

  constructor(name: string) {
    super();
    this.channel = new BroadcastChannel(name);
    this.channel.onmessage = (event: MessageEvent<unknown>) => this.dispatch(event.data);
  }

  send(message: object): void {
    try {
      this.channel.postMessage(message);
    } catch {
      // The channel is already closed because the page is being torn down.
    }
  }

  override close(): void {
    super.close();
    this.channel.close();
  }
}

/**
 * Fallback transport for browsers without BroadcastChannel. Writing to localStorage fires a
 * `storage` event in every other tab of the origin, which turns one key into a message bus.
 */
export class StorageEventTransport extends BaseTransport {
  readonly kind = 'storage-event';

  constructor(
    private readonly storage: Storage,
    private readonly key: string,
    private readonly target: Window = window,
  ) {
    super();
    target.addEventListener('storage', this.onStorage);
  }

  send(message: object): void {
    try {
      // Writing an identical value fires no event, so a nonce makes every message unique.
      this.storage.setItem(this.key, JSON.stringify({ nonce: createNodeId(), message }));
    } catch {
      // Storage is full or blocked; there is no channel left to deliver the message on.
    }
  }

  override close(): void {
    super.close();
    this.target.removeEventListener('storage', this.onStorage);
  }

  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== this.key || event.newValue === null) return;
    let payload: unknown;
    try {
      payload = JSON.parse(event.newValue);
    } catch {
      return;
    }
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      this.dispatch(payload.message);
    }
  };
}

/** Used when no cross-tab channel exists; the app keeps working as a single tab. */
export class NullTransport extends BaseTransport {
  readonly kind = 'none';
  send(): void {
    // There is no other tab to deliver to.
  }
}

/** Picks the best transport the browser supports. */
export function createTransport(name: string, storage: Storage | null): Transport {
  if (typeof BroadcastChannel === 'function') {
    try {
      return new BroadcastChannelTransport(name);
    } catch {
      // Some privacy modes expose the constructor but refuse to create channels.
    }
  }
  if (storage !== null) return new StorageEventTransport(storage, `${name}:bus`);
  return new NullTransport();
}
