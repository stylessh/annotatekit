import { describe, expect, it } from "vitest";
import type { StorageAdapter, StorageChange } from "../src/index.js";
import { makeAnnotation, makeComment, makeGroup, makeThread, tick } from "./fixtures.js";

/** Behaviour every StorageAdapter must have. Run it against each implementation. */
export function describeStorageContract(name: string, create: () => StorageAdapter) {
  describe(`${name}: storage contract`, () => {
    it("puts, gets and deletes a thread", async () => {
      const storage = create();
      const thread = makeThread();
      expect(await storage.threads.put(thread)).toEqual(thread);
      expect(await storage.threads.get(thread.id)).toEqual(thread);
      expect(await storage.threads.delete(thread.id)).toBe(true);
      expect(await storage.threads.get(thread.id)).toBeNull();
      expect(await storage.threads.delete(thread.id)).toBe(false);
    });

    it("returns copies, not live references", async () => {
      const storage = create();
      const thread = makeThread({ tags: ["a"] });
      const stored = await storage.threads.put(thread);
      stored.tags?.push("mutated");
      thread.tags?.push("mutated-input");
      const fetched = await storage.threads.get(thread.id);
      expect(fetched?.tags).toEqual(["a"]);
      fetched?.tags?.push("mutated-again");
      expect((await storage.threads.get(thread.id))?.tags).toEqual(["a"]);
    });

    it("replaces an entity on put with the same id", async () => {
      const storage = create();
      const thread = makeThread();
      await storage.threads.put(thread);
      await storage.threads.put({ ...thread, status: "resolved" });
      expect((await storage.threads.get(thread.id))?.status).toBe("resolved");
      expect((await storage.threads.list()).items).toHaveLength(1);
    });

    it("rejects entities without an id", async () => {
      const storage = create();
      await expect(storage.threads.put({ ...makeThread(), id: "" })).rejects.toMatchObject({
        code: "invalid_input",
      });
    });

    it("filters threads", async () => {
      const storage = create();
      const group = makeGroup();
      const a = makeThread({ status: "open", groupId: group.id, tags: ["ui", "copy"] });
      const b = makeThread({
        status: "resolved",
        projectId: "proj_2",
        page: { url: "https://example.com/", origin: "https://example.com", pathname: "/" },
      });
      const c = makeThread({
        status: "in_progress",
        createdBy: { kind: "agent", id: "agt_1", name: "Bot" },
      });
      for (const t of [a, b, c]) await storage.threads.put(t);

      const ids = async (q: Parameters<typeof storage.threads.list>[0]) =>
        (await storage.threads.list(q)).items.map((t) => t.id);

      expect(await ids({})).toEqual([a.id, b.id, c.id]);
      expect(await ids({ projectId: "proj_1" })).toEqual([a.id, c.id]);
      expect(await ids({ status: "open" })).toEqual([a.id]);
      expect(await ids({ status: ["open", "in_progress"] })).toEqual([a.id, c.id]);
      expect(await ids({ groupId: group.id })).toEqual([a.id]);
      expect(await ids({ pathname: "/" })).toEqual([b.id]);
      expect(await ids({ pageUrl: "https://example.com/pricing" })).toEqual([a.id, c.id]);
      expect(await ids({ authorId: "agt_1" })).toEqual([c.id]);
      expect(await ids({ tags: ["ui"] })).toEqual([a.id]);
      expect(await ids({ tags: ["ui", "missing"] })).toEqual([]);
      expect(await ids({ updatedSince: b.updatedAt })).toEqual([b.id, c.id]);
    });

    it("paginates with a stable cursor", async () => {
      const storage = create();
      const threads = Array.from({ length: 5 }, () => makeThread());
      // Insert out of order to prove sorting is by createdAt, not insertion.
      for (const t of [...threads].reverse()) await storage.threads.put(t);

      const first = await storage.threads.list({ limit: 2 });
      expect(first.items.map((t) => t.id)).toEqual([threads[0]?.id, threads[1]?.id]);
      expect(first.nextCursor).toBeDefined();

      // A thread inserted before the cursor must not shift the next page.
      await storage.threads.put(makeThread({ createdAt: "2000-01-01T00:00:00.000Z" }));

      const second = await storage.threads.list({ limit: 2, cursor: first.nextCursor });
      expect(second.items.map((t) => t.id)).toEqual([threads[2]?.id, threads[3]?.id]);
      const third = await storage.threads.list({ limit: 2, cursor: second.nextCursor });
      expect(third.items.map((t) => t.id)).toEqual([threads[4]?.id]);
      expect(third.nextCursor).toBeUndefined();
    });

    it("rejects a bad cursor or limit", async () => {
      const storage = create();
      await expect(storage.threads.list({ cursor: "nope" })).rejects.toMatchObject({
        code: "invalid_input",
      });
      await expect(storage.threads.list({ limit: 0 })).rejects.toMatchObject({
        code: "invalid_input",
      });
    });

    it("lists annotations and comments by thread", async () => {
      const storage = create();
      const t1 = makeThread();
      const t2 = makeThread();
      const a1 = makeAnnotation(t1.id);
      const a2 = makeAnnotation(t2.id, {
        kind: "region",
        region: { x: 0, y: 0, width: 50, height: 50 },
      });
      const c1 = makeComment(t1.id);
      const c2 = makeComment(t1.id, { body: "Agreed" });
      const c3 = makeComment(t2.id);
      for (const t of [t1, t2]) await storage.threads.put(t);
      for (const a of [a1, a2]) await storage.annotations.put(a);
      for (const c of [c1, c2, c3]) await storage.comments.put(c);

      expect((await storage.annotations.list({ threadId: t2.id })).items).toEqual([a2]);
      expect((await storage.comments.list({ threadId: t1.id })).items.map((c) => c.id)).toEqual([
        c1.id,
        c2.id,
      ]);
      // @ts-expect-error threadId is required
      await expect(storage.comments.list({})).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("cascades thread deletes to its annotation and comments", async () => {
      const storage = create();
      const keep = makeThread();
      const drop = makeThread();
      await storage.threads.put(keep);
      await storage.threads.put(drop);
      await storage.annotations.put(makeAnnotation(drop.id));
      await storage.comments.put(makeComment(drop.id));
      const kept = makeComment(keep.id);
      await storage.comments.put(kept);

      await storage.threads.delete(drop.id);
      expect((await storage.annotations.list()).items).toEqual([]);
      expect((await storage.comments.list({ threadId: drop.id })).items).toEqual([]);
      expect((await storage.comments.list({ threadId: keep.id })).items).toEqual([kept]);
    });

    it("clears groupId on threads when a group is deleted", async () => {
      const storage = create();
      const group = makeGroup();
      await storage.groups.put(group);
      const thread = makeThread({ groupId: group.id });
      await storage.threads.put(thread);
      expect((await storage.groups.list({ projectId: "proj_1" })).items).toEqual([group]);

      expect(await storage.groups.delete(group.id)).toBe(true);
      const after = await storage.threads.get(thread.id);
      expect(after).not.toHaveProperty("groupId");
    });

    it("notifies subscribers of changes", async () => {
      const storage = create();
      if (!storage.subscribe) return;
      const changes: StorageChange[] = [];
      const unsubscribe = storage.subscribe((c) => changes.push(c));

      const thread = makeThread();
      await storage.threads.put(thread);
      await storage.comments.put(makeComment(thread.id, { updatedAt: tick() }));
      await storage.threads.delete(thread.id);
      unsubscribe();
      await storage.threads.put(makeThread());

      expect(changes.map((c) => `${c.type}:${c.collection}`)).toEqual([
        "put:threads",
        "put:comments",
        "delete:threads",
        "delete:comments",
      ]);
    });
  });
}
