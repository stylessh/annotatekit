import { describe, expect, it } from "vitest";
import {
  createLocalStorageAdapter,
  type StorageChange,
  type StorageEventLike,
  type StorageEventSource,
  type StorageLike,
} from "../src/index.js";
import { makeThread } from "./fixtures.js";
import { describeStorageContract } from "./storage-contract.js";

class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

class FakeWindow implements StorageEventSource {
  listeners = new Set<(event: StorageEventLike) => void>();
  addEventListener(_type: "storage", listener: (event: StorageEventLike) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "storage", listener: (event: StorageEventLike) => void) {
    this.listeners.delete(listener);
  }
  dispatch(event: StorageEventLike) {
    for (const listener of this.listeners) listener(event);
  }
}

describeStorageContract("localStorage", () =>
  createLocalStorageAdapter({ storage: new FakeStorage(), eventSource: null }),
);

describe("createLocalStorageAdapter", () => {
  it("persists across adapter instances under the same key", async () => {
    const storage = new FakeStorage();
    const thread = makeThread();
    await createLocalStorageAdapter({ storage, eventSource: null }).threads.put(thread);
    const reopened = createLocalStorageAdapter({ storage, eventSource: null });
    expect(await reopened.threads.get(thread.id)).toEqual(thread);
    expect(JSON.parse(storage.getItem("annotatekit") ?? "{}").version).toBe(1);
  });

  it("isolates data by key", async () => {
    const storage = new FakeStorage();
    const a = createLocalStorageAdapter({ storage, key: "ak:a", eventSource: null });
    const b = createLocalStorageAdapter({ storage, key: "ak:b", eventSource: null });
    const thread = makeThread();
    await a.threads.put(thread);
    expect(await b.threads.get(thread.id)).toBeNull();
  });

  it("recovers from corrupt or foreign data", async () => {
    const storage = new FakeStorage();
    storage.setItem("annotatekit", "{not json");
    const adapter = createLocalStorageAdapter({ storage, eventSource: null });
    expect((await adapter.threads.list()).items).toEqual([]);
    storage.setItem("annotatekit", JSON.stringify({ version: 99, threads: { x: {} } }));
    expect((await adapter.threads.list()).items).toEqual([]);
  });

  it("wraps write failures in a storage_unavailable error", async () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    const adapter = createLocalStorageAdapter({ storage, eventSource: null });
    await expect(adapter.threads.put(makeThread())).rejects.toMatchObject({
      code: "storage_unavailable",
    });
  });

  it("throws a clear error when localStorage is missing", () => {
    expect(() => createLocalStorageAdapter({ eventSource: null })).toThrow(/localStorage/);
  });

  it("reports changes made in another tab", async () => {
    const storage = new FakeStorage();
    const win = new FakeWindow();
    const tabA = createLocalStorageAdapter({ storage, eventSource: win });
    const tabB = createLocalStorageAdapter({ storage, eventSource: null });

    const existing = makeThread();
    await tabA.threads.put(existing);

    const changes: StorageChange[] = [];
    const unsubscribe = tabA.subscribe((c) => changes.push(c));
    expect(win.listeners.size).toBe(1);

    const added = makeThread();
    await tabB.threads.put(added);
    await tabB.threads.put({ ...existing, status: "resolved" });
    win.dispatch({ key: "annotatekit", newValue: storage.getItem("annotatekit") });

    expect(changes).toEqual([
      expect.objectContaining({ type: "put", collection: "threads", id: existing.id }),
      expect.objectContaining({ type: "put", collection: "threads", id: added.id }),
    ]);

    // Events for other keys are ignored.
    win.dispatch({ key: "something-else", newValue: "x" });
    expect(changes).toHaveLength(2);

    // `key: null` means storage.clear() was called in another tab.
    storage.data.clear();
    win.dispatch({ key: null, newValue: null });
    expect(
      changes
        .slice(2)
        .map((c) => `${c.type}:${c.id}`)
        .sort(),
    ).toEqual([`delete:${added.id}`, `delete:${existing.id}`].sort());

    unsubscribe();
    expect(win.listeners.size).toBe(0);
  });

  it("clear removes the key and emits deletes", async () => {
    const storage = new FakeStorage();
    const adapter = createLocalStorageAdapter({ storage, eventSource: null });
    const thread = makeThread();
    await adapter.threads.put(thread);
    const changes: StorageChange[] = [];
    adapter.subscribe((c) => changes.push(c));
    await adapter.clear();
    expect(storage.getItem("annotatekit")).toBeNull();
    expect(changes).toEqual([{ type: "delete", collection: "threads", id: thread.id }]);
  });
});
