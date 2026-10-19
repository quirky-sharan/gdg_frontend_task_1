import './styles/main.css';
import { ConflictTest } from './app/conflictTest';
import { bindPageLifecycle } from './app/lifecycle';
import { CHANNEL_NAME, preferencesSchema, STORAGE_NAMESPACE } from './preferences/preferences';
import { EntryPersistence, getLocalStorage, windowStorageEvents } from './sync/persistence';
import { Presence } from './sync/presence';
import { SyncedStore } from './sync/store';
import { createTransport } from './sync/transport';
import { mountApp } from './ui/app';

/* Composition root: the only place that knows about every layer. */

const storage = getLocalStorage();
const persistence = new EntryPersistence({
  schema: preferencesSchema,
  storage,
  namespace: STORAGE_NAMESPACE,
  changes: storage === null ? undefined : windowStorageEvents(),
});
const transport = createTransport(CHANNEL_NAME, storage);
const store = new SyncedStore({ schema: preferencesSchema, persistence, transport });
const presence = new Presence({ transport, nodeId: store.nodeId, digest: () => store.digest() });
const conflictTest = new ConflictTest({ transport, store });

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('Missing #app root element');

mountApp(root, {
  store,
  presence,
  conflictTest,
  transportKind: transport.kind,
  isStorageAvailable: () => persistence.isAvailable,
});
bindPageLifecycle(store, presence);
store.start();
presence.start();
