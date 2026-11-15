import type { StorageAdapter, StorageListener } from "../adapters/storage.js";
import { createStateCollections, emptyState, parseState, type StorageState } from "./state.js";

export interface MemoryStorageOptions {
  /** Seed data, for example fixtures in tests or a server-rendered snapshot. */
  initialState?: Partial<StorageState>;
}

export interface MemoryStorageAdapter extends StorageAdapter {
  subscribe(listener: StorageListener): () => void;
  /** A deep copy of everything stored, for debugging or export. */
  snapshot(): StorageState;
  /** Remove everything. Emits a delete for each entity. */
  clear(): Promise<void>;
}

/** Keeps everything in memory. Data is lost on reload. */
export function createMemoryStorage(options: MemoryStorageOptions = {}): MemoryStorageAdapter {
  let state: StorageState = options.initialState
    ? parseState(structuredClone({ ...emptyState(), ...options.initialState }))
    : emptyState();
  const listeners = new Set<StorageListener>();

  const collections = createStateCollections({
    read: () => state,
    write: (next, changes) => {
      state = next;
      for (const change of changes) for (const listener of listeners) listener(change);
    },
  });

  return {
    name: "memory",
    ...collections,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => structuredClone(state),
    async clear() {
      for (const thread of Object.keys(state.threads)) await collections.threads.delete(thread);
      for (const kind of ["annotations", "comments", "groups"] as const) {
        for (const id of Object.keys(state[kind])) await collections[kind].delete(id);
      }
    },
    async close() {
      listeners.clear();
    },
  };
}
