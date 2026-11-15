import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnnotateKitService, pageContextFromUrl } from "@annotatekit/core";
import { afterAll, describe, expect, it } from "vitest";
import { makeThread } from "../../core/test/fixtures.js";
import { describeStorageContract } from "../../core/test/storage-contract.js";
import { createSqliteStorage, openDatabase } from "../src/index.js";

describeStorageContract("sqlite", () => createSqliteStorage());

describe("createSqliteStorage", () => {
  const dir = mkdtempSync(join(tmpdir(), "annotatekit-sqlite-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("persists to a file across instances", async () => {
    const file = join(dir, "persist.db");
    const first = createSqliteStorage({ database: file });
    const thread = makeThread({ tags: ["ui"] });
    await first.threads.put(thread);
    await first.close();

    const second = createSqliteStorage({ database: file });
    expect(await second.threads.get(thread.id)).toEqual(thread);
    expect((await second.threads.list({ tags: ["ui"] })).items).toEqual([thread]);
    await second.close();
  });

  it("shares a database through table prefixes", async () => {
    const db = openDatabase(":memory:");
    const a = createSqliteStorage({ database: db, tablePrefix: "a_" });
    const b = createSqliteStorage({ database: db, tablePrefix: "b_" });
    await a.threads.put(makeThread());
    expect((await b.threads.list()).items).toEqual([]);
    await a.close();
    // Closing an adapter does not close a database it was given.
    expect((await b.threads.list()).items).toEqual([]);
    db.close();
    expect(() => createSqliteStorage({ tablePrefix: "bad prefix" })).toThrow();
  });

  it("rejects calls after close", async () => {
    const storage = createSqliteStorage();
    await storage.close();
    await expect(storage.threads.list()).rejects.toMatchObject({ code: "storage_unavailable" });
  });

  it("runs the core service end to end", async () => {
    const service = createAnnotateKitService({ storage: createSqliteStorage() });
    const actor = { kind: "human", id: "usr_1", name: "Alan" } as const;
    const { thread } = await service.createThread(actor, {
      projectId: "shop",
      page: pageContextFromUrl("https://shop.example.com/checkout"),
      annotation: {
        kind: "element",
        anchor: {
          selector: "button",
          tagName: "button",
          rect: { x: 0, y: 0, width: 1, height: 1 },
          scroll: { x: 0, y: 0 },
        },
        context: { viewport: { width: 800, height: 600, devicePixelRatio: 1 } },
      },
      comment: { body: "Hello" },
    });
    await service.addComment(actor, thread.id, { body: "Again" });
    const detail = await service.getThread(actor, thread.id);
    expect(detail.thread.commentCount).toBe(2);
    expect(detail.comments.map((c) => c.body)).toEqual(["Hello", "Again"]);
  });
});
