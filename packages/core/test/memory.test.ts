import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/index.js";
import { makeThread } from "./fixtures.js";
import { describeStorageContract } from "./storage-contract.js";

describeStorageContract("memory", () => createMemoryStorage());

describe("createMemoryStorage", () => {
  it("seeds from initialState", async () => {
    const thread = makeThread();
    const storage = createMemoryStorage({ initialState: { threads: { [thread.id]: thread } } });
    expect(await storage.threads.get(thread.id)).toEqual(thread);
  });

  it("does not share state between instances", async () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    const thread = makeThread();
    await a.threads.put(thread);
    expect(await b.threads.get(thread.id)).toBeNull();
  });

  it("clears everything and snapshots", async () => {
    const storage = createMemoryStorage();
    await storage.threads.put(makeThread());
    expect(Object.keys(storage.snapshot().threads)).toHaveLength(1);
    await storage.clear();
    expect(storage.snapshot().threads).toEqual({});
  });
});
