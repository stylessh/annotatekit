import { describe, expect, it } from "vitest";
import {
  type AgentActor,
  type CreateThreadInput,
  createAnnotateKitService,
  createManualResolution,
  createMemoryStorage,
  pageContextFromUrl,
} from "../src/index.js";
import { alice } from "./fixtures.js";

const bot: AgentActor = { kind: "agent", id: "agt_claude", name: "Claude", onBehalfOf: alice.id };

function input(overrides: Partial<CreateThreadInput> = {}): CreateThreadInput {
  return {
    projectId: "shop",
    page: pageContextFromUrl("https://shop.example.com/checkout"),
    annotation: {
      kind: "pin",
      position: { x: 0.5, y: 0.5 },
      anchor: {
        selector: '[data-testid="pay"]',
        tagName: "button",
        rect: { x: 0, y: 0, width: 100, height: 40 },
        scroll: { x: 0, y: 0 },
      },
      context: { viewport: { width: 1280, height: 800, devicePixelRatio: 2 } },
    },
    comment: { body: "Too tight on tablet" },
    ...overrides,
  };
}

describe("createAnnotateKitService", () => {
  it("creates a thread with its annotation and first comment", async () => {
    const service = createAnnotateKitService({ storage: createMemoryStorage() });
    const detail = await service.createThread(alice, input());
    expect(detail.thread).toMatchObject({ projectId: "shop", status: "open", commentCount: 1 });
    expect(detail.annotation?.threadId).toBe(detail.thread.id);
    expect(detail.thread.annotationId).toBe(detail.annotation?.id);
    expect(detail.comments.map((c) => c.body)).toEqual(["Too tight on tablet"]);
    expect(await service.getThread(alice, detail.thread.id)).toEqual(detail);
  });

  it("requires an actor for writes and validates input", async () => {
    const service = createAnnotateKitService({ storage: createMemoryStorage() });
    await expect(service.createThread(null, input())).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(
      service.createThread(alice, input({ page: { url: "nope", origin: "", pathname: "" } })),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.getThread(alice, "thr_missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("sends agent fixes to pending_review and lets a human approve", async () => {
    const service = createAnnotateKitService({ storage: createMemoryStorage() });
    const { thread } = await service.createThread(alice, input());
    const working = await service.setThreadStatus(bot, thread.id, { status: "in_progress" });
    expect(working.status).toBe("in_progress");

    const proposed = await service.resolveThread(bot, thread.id, { note: "Matched card padding" });
    expect(proposed.status).toBe("pending_review");
    expect(proposed.resolution?.resolvedBy.id).toBe(bot.id);

    const approved = await service.resolveThread(alice, thread.id);
    expect(approved.status).toBe("resolved");
    expect(approved.resolution).toMatchObject({ resolvedBy: bot, reviewedBy: alice });

    const reopened = await service.reopenThread(alice, thread.id, { reason: "Still broken" });
    expect(reopened.status).toBe("open");
    expect(reopened).not.toHaveProperty("resolution");

    const { comments } = await service.getThread(alice, thread.id);
    expect(comments.map((c) => c.metadata?.event ?? "user")).toEqual([
      "user",
      "status",
      "resolve",
      "resolve",
      "reopen",
    ]);
    expect(comments[2]?.body).toBe("Claude proposed a fix for review: Matched card padding");
  });

  it("rejects invalid transitions and resolve via setThreadStatus", async () => {
    const service = createAnnotateKitService({
      storage: createMemoryStorage(),
      resolution: createManualResolution(),
    });
    const { thread } = await service.createThread(alice, input());
    await service.resolveThread(alice, thread.id);
    await expect(
      service.setThreadStatus(alice, thread.id, { status: "in_progress" }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(
      // @ts-expect-error resolved is not allowed here
      service.setThreadStatus(alice, thread.id, { status: "resolved" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps comment counts and enforces comment ownership", async () => {
    const service = createAnnotateKitService({ storage: createMemoryStorage() });
    const { thread, comments } = await service.createThread(alice, input());
    const reply = await service.addComment(bot, thread.id, { body: "On it" });
    expect((await service.getThread(alice, thread.id)).thread.commentCount).toBe(2);

    await expect(
      service.updateComment(bot, comments[0]?.id ?? "", { body: "hijack" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const edited = await service.updateComment(bot, reply.id, { body: "On it now" });
    expect(edited.editedAt).toBeDefined();

    await service.deleteComment(bot, reply.id);
    expect((await service.getThread(alice, thread.id)).thread.commentCount).toBe(1);
  });

  it("applies the authorizer", async () => {
    const service = createAnnotateKitService({
      storage: createMemoryStorage(),
      authorize: ({ actor, action }) => actor?.kind === "human" || action === "thread:read",
    });
    const { thread } = await service.createThread(alice, input());
    expect((await service.listThreads(bot)).items).toHaveLength(1);
    await expect(service.addComment(bot, thread.id, { body: "hi" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("manages groups and checks a thread's group project", async () => {
    const service = createAnnotateKitService({ storage: createMemoryStorage() });
    const group = await service.createGroup(alice, { projectId: "shop", name: " Checkout " });
    expect(group.name).toBe("Checkout");
    const other = await service.createGroup(alice, { projectId: "blog", name: "Blog" });
    await expect(service.createThread(alice, input({ groupId: other.id }))).rejects.toMatchObject({
      code: "invalid_input",
    });
    const { thread } = await service.createThread(alice, input({ groupId: group.id }));
    const updated = await service.updateThread(alice, thread.id, { groupId: null, title: "Pay" });
    expect(updated).not.toHaveProperty("groupId");
    expect(updated.title).toBe("Pay");
    await service.deleteGroup(alice, group.id);
    expect((await service.listGroups(alice, { projectId: "shop" })).items).toEqual([]);
  });
});
