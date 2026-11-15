import type { Annotation, Comment, Group, HumanActor, Thread } from "../src/index.js";

export const alice: HumanActor = { kind: "human", id: "usr_alice", name: "Alice" };

let clock = Date.parse("2026-01-01T00:00:00.000Z");
export function tick(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

export function makeThread(overrides: Partial<Thread> = {}): Thread {
  const at = tick();
  return {
    id: `thr_${Math.random().toString(16).slice(2)}`,
    projectId: "proj_1",
    annotationId: "ann_1",
    page: {
      url: "https://example.com/pricing",
      origin: "https://example.com",
      pathname: "/pricing",
    },
    status: "open",
    createdBy: alice,
    createdAt: at,
    updatedAt: at,
    commentCount: 0,
    ...overrides,
  };
}

export function makeAnnotation(threadId: string, overrides: Partial<Annotation> = {}): Annotation {
  const at = tick();
  return {
    id: `ann_${Math.random().toString(16).slice(2)}`,
    projectId: "proj_1",
    threadId,
    kind: "pin",
    position: { x: 0.5, y: 0.5 },
    anchor: {
      selector: "main > button.cta",
      tagName: "button",
      rect: { x: 10, y: 20, width: 100, height: 40 },
      scroll: { x: 0, y: 0 },
    },
    context: { viewport: { width: 1280, height: 800, devicePixelRatio: 2 } },
    createdBy: alice,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export function makeComment(threadId: string, overrides: Partial<Comment> = {}): Comment {
  const at = tick();
  return {
    id: `cmt_${Math.random().toString(16).slice(2)}`,
    threadId,
    author: alice,
    body: "This button is misaligned",
    format: "markdown",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

export function makeGroup(overrides: Partial<Group> = {}): Group {
  const at = tick();
  return {
    id: `grp_${Math.random().toString(16).slice(2)}`,
    projectId: "proj_1",
    name: "Checkout polish",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}
