import { isRecord } from './codec';

/**
 * Version of the cross-tab wire format. Tabs running a different version (for example an old
 * tab left open across a deployment) ignore each other's messages instead of misreading them.
 */
export const PROTOCOL_VERSION = 1;

/** Fields shared by every message exchanged between tabs. */
export interface Envelope<Type extends string = string> {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: Type;
  /** Node id of the sending tab. */
  readonly from: string;
  /** High-resolution send time in epoch milliseconds, used to measure delivery latency. */
  readonly sentAt: number;
}

export function createEnvelope<Type extends string>(
  type: Type,
  from: string,
  sentAt: number,
): Envelope<Type> {
  return { v: PROTOCOL_VERSION, type, from, sentAt };
}

/** Checks the common envelope; message-specific payloads are validated by their consumers. */
export function isEnvelope(raw: unknown): raw is Envelope & Record<string, unknown> {
  return (
    isRecord(raw) &&
    raw['v'] === PROTOCOL_VERSION &&
    typeof raw['type'] === 'string' &&
    typeof raw['from'] === 'string' &&
    raw['from'].length > 0 &&
    typeof raw['sentAt'] === 'number' &&
    Number.isFinite(raw['sentAt'])
  );
}

/** Current time in epoch milliseconds with sub-millisecond precision where available. */
export function preciseNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number') {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}
