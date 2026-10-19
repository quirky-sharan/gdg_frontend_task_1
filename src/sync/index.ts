/**
 * Framework-agnostic cross-tab state synchronisation. Nothing in this folder knows about the
 * preferences or the UI; the app supplies a schema and wires the pieces together in `main.ts`.
 */
export { decodeEntries, decodeEntry, decodeTimestamp } from './codec';
export { digestEntries } from './digest';
export {
  compareTimestamps,
  HybridLogicalClock,
  isZeroTimestamp,
  ZERO_TIMESTAMP,
  type Timestamp,
} from './hlc';
export { createNodeId, shortId } from './ids';
export { LatencyTracker, type LatencySummary } from './latency';
export {
  compareEntries,
  mergeEntries,
  toValues,
  withDefaults,
  type Entry,
  type EntryMap,
  type PartialEntryMap,
} from './lww';
export {
  EntryPersistence,
  getLocalStorage,
  windowStorageEvents,
  type ExternalChangeSource,
  type KeyValueStorage,
} from './persistence';
export { Presence, type PeerInfo, type PeersEvent } from './presence';
export { createEnvelope, isEnvelope, preciseNow, type Envelope } from './protocol';
export {
  SyncedStore,
  type ChangeEvent,
  type ChangeSource,
  type ConflictEvent,
  type DeliveredEvent,
  type RepairEvent,
  type StoreEvent,
} from './store';
export { createTransport, type Transport, type TransportKind } from './transport';
export type { FieldKey, Fields, FieldSpec, Primitive, Schema } from './types';
