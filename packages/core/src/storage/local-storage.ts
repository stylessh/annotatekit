import type { StorageAdapter, StorageListener } from "../adapters/storage.js";
import { AnnotateKitError } from "../errors.js";
import {
  createStateCollections,
  diffStates,
  emptyState,
  parseState,
  type StorageState,
} from "./state.js";

/** The subset of the Web Storage API the adapter needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The subset of `window` used to hear about writes from other tabs. */
export interface StorageEventSource {
  addEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
}

export interface StorageEventLike {
  key: string | null;
  newValue: string | null;
  storageArea?: unknown;
}

export interface LocalStorageOptions {
  /** Storage key. Use one per project. Defaults to `annotatekit`. */
  key?: string;
  /** Defaults to `globalThis.localStorage`. */
  storage?: StorageLike;
  /**
   * Where `storage` events come from, for cross-tab sync. Defaults to
   * `globalThis.window` when present. Pass `null` to turn sync off.
   */
  eventSource?: StorageEventSource | null;
}

export interface LocalStorageAdapter extends StorageAdapter {
  subscribe(listener: StorageListener): () => void;
  /** Remove the stored key. Emits a delete for each entity. */
  clear(): Promise<void>;
}

/**
 * Persists everything as one JSON document in `localStorage`. Changes made in
 * other tabs are picked up and reported through `subscribe`.
 */
export function createLocalStorageAdapter(options: LocalStorageOptions = {}): LocalStorageAdapter {
  const key = options.key ?? "annotatekit";
  const storage = options.storage ?? defaultStorage();
  const eventSource =
    options.eventSource === undefined ? defaultEventSource() : options.eventSource;
  const listeners = new Set<StorageListener>();

  // Last state this adapter saw, used to diff writes from other tabs.
  let known = load();

  function load(): StorageState {
    const raw = storage.getItem(key);
    if (raw === null) return emptyState();
    try {
      return parseState(JSON.parse(raw));
    } catch {
      return emptyState();
    }
  }

  function emit(changes: ReturnType<typeof diffStates>) {
    for (const change of changes) for (const listener of listeners) listener(change);
  }

  const collections = createStateCollections({
    read: () => {
      known = load();
      return known;
    },
    write: (next, changes) => {
      try {
        storage.setItem(key, JSON.stringify(next));
      } catch (cause) {
        throw new AnnotateKitError("storage_unavailable", "Could not write to localStorage", {
          cause,
        });
      }
      known = next;
      emit(changes);
    },
  });

  const onStorage = (event: StorageEventLike) => {
    if (event.key !== null && event.key !== key) return;
    const next = load();
    const changes = diffStates(known, next);
    known = next;
    emit(changes);
  };
  let listening = false;

  return {
    name: "localStorage",
    ...collections,
    subscribe(listener) {
      listeners.add(listener);
      if (eventSource && !listening) {
        eventSource.addEventListener("storage", onStorage);
        listening = true;
      }
      return () => {
        listeners.delete(listener);
        if (eventSource && listening && listeners.size === 0) {
          eventSource.removeEventListener("storage", onStorage);
          listening = false;
        }
      };
    },
    async clear() {
      const before = load();
      storage.removeItem(key);
      known = emptyState();
      emit(diffStates(before, known));
    },
    async close() {
      listeners.clear();
      if (eventSource && listening) eventSource.removeEventListener("storage", onStorage);
      listening = false;
    },
  };
}

function defaultStorage(): StorageLike {
  const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
  if (!storage) {
    throw new AnnotateKitError(
      "storage_unavailable",
      "localStorage is not available here; pass `storage` explicitly",
    );
  }
  return storage;
}

function defaultEventSource(): StorageEventSource | null {
  const win = (globalThis as { window?: StorageEventSource }).window;
  return win && typeof win.addEventListener === "function" ? win : null;
}
