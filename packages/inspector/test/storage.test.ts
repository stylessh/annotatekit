// @vitest-environment happy-dom
import { type Actor, createAnnotateKitService, createMemoryStorage } from "@annotatekit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnnotationDraft,
  bindStorage,
  Capturer,
  draftToThreadInput,
  type Inspector,
  type InspectorEvents,
  type RenderableAnnotation,
  toRenderable,
} from "../src/index.js";

const actor: Actor = { kind: "human", id: "u1", name: "Alan" };

afterEach(() => {
  document.body.innerHTML = "";
});

function draftFor(selector: string, kind: AnnotationDraft["kind"] = "pin"): AnnotationDraft {
  const c = new Capturer(document);
  const snap = c.element(document.querySelector(selector) as Element);
  const draft: AnnotationDraft = {
    kind,
    comment: "Make this louder\nmore detail",
    anchor: snap.anchor,
    targets: [snap],
    fixed: false,
    context: c.context(snap, [snap]),
    page: c.page(),
  };
  if (kind === "pin") draft.position = { x: 0.5, y: 0.5 };
  return draft;
}

/** Just enough of an Inspector to drive bindStorage. */
function fakeInspector() {
  const handlers: { [K in keyof InspectorEvents]?: (p: InspectorEvents[K]) => void } = {};
  const setAnnotations = vi.fn<(list: RenderableAnnotation[]) => void>();
  const inspector = {
    on(event: keyof InspectorEvents, fn: (p: never) => void) {
      (handlers as Record<string, unknown>)[event] = fn;
      return () => {
        delete handlers[event];
      };
    },
    setAnnotations,
  } as unknown as Inspector;
  return { inspector, setAnnotations, create: (d: AnnotationDraft) => handlers.create?.(d) };
}

describe("draftToThreadInput", () => {
  it("creates a thread with its annotation and first comment through core's service", async () => {
    document.body.innerHTML = `<button data-testid="cta">Go</button>`;
    const service = createAnnotateKitService({ storage: createMemoryStorage() });
    const group = await service.createGroup(actor, {
      projectId: "p1",
      name: "Hero",
      color: "#f00",
    });
    const input = draftToThreadInput(draftFor("[data-testid=cta]"), {
      projectId: "p1",
      groupId: group.id,
    });
    const { thread, annotation, comments } = await service.createThread(actor, input);
    expect(thread).toMatchObject({
      projectId: "p1",
      status: "open",
      title: "Make this louder",
      groupId: group.id,
      commentCount: 1,
    });
    expect(annotation).toMatchObject({
      threadId: thread.id,
      kind: "pin",
      position: { x: 0.5, y: 0.5 },
      anchor: { selector: 'button[data-testid="cta"]' },
      metadata: { inspector: { fixed: false } },
    });
    expect(comments.map((c) => c.body)).toEqual(["Make this louder\nmore detail"]);
    if (!annotation) throw new Error("missing annotation");
    expect(toRenderable(thread, annotation, { color: "#f00" })).toMatchObject({
      id: thread.id,
      kind: "pin",
      status: "open",
      groupId: group.id,
      color: "#f00",
    });
  });
});

describe("bindStorage", () => {
  it("persists drafts and renders the page's threads", async () => {
    document.body.innerHTML = `<button data-testid="cta">Go</button>`;
    const storage = createMemoryStorage();
    const { inspector, setAnnotations, create } = fakeInspector();
    const onCreated = vi.fn();
    const binding = bindStorage(inspector, { storage, projectId: "p1", actor, onCreated });
    await binding.reload();
    expect(setAnnotations).toHaveBeenLastCalledWith([]);

    create(draftFor("[data-testid=cta]"));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    await binding.reload();

    const threads = await storage.threads.list({ projectId: "p1" });
    expect(threads.items).toHaveLength(1);
    expect(threads.items[0]?.createdBy).toEqual(actor);
    expect(
      (await storage.comments.list({ threadId: threads.items[0]?.id ?? "" })).items,
    ).toHaveLength(1);
    const last = setAnnotations.mock.lastCall?.[0];
    expect(last).toHaveLength(1);
    expect(last?.[0]).toMatchObject({ id: threads.items[0]?.id, kind: "pin" });

    // A change made elsewhere (say, an agent resolving the thread) shows up too.
    const thread = threads.items[0];
    if (!thread) throw new Error("missing thread");
    await storage.threads.put({ ...thread, status: "resolved" });
    await vi.waitFor(() =>
      expect(setAnnotations.mock.lastCall?.[0]?.[0]).toMatchObject({ status: "resolved" }),
    );
    binding.unbind();
  });
});
