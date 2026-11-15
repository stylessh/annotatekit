import { describe, expect, it } from "vitest";
import {
  type AgentActor,
  canTransition,
  createId,
  createManualResolution,
  createReviewResolution,
  createStaticAuth,
  createStaticWhitelist,
  highestRole,
  isAnnotateKitError,
  isAuthScope,
  scopesAllow,
  scopesForRoles,
} from "../src/index.js";
import { alice, makeThread } from "./fixtures.js";

const agent: AgentActor = { kind: "agent", id: "agt_claude", name: "Claude", onBehalfOf: alice.id };
const now = () => "2026-02-02T00:00:00.000Z";

describe("createStaticWhitelist", () => {
  const whitelist = createStaticWhitelist({
    origins: ["https://*.vercel.app", "http://localhost:3000"],
    paths: ["/app/*", "/"],
    allowAnonymous: false,
    allowActor: (actor) => actor.kind === "agent" || actor.id.startsWith("usr_"),
  });

  it("allows matching origin, path and actor", () => {
    expect(
      whitelist.check({ url: "https://my-pr-12.vercel.app/app/settings", actor: alice }),
    ).toEqual({
      allowed: true,
    });
    expect(whitelist.check({ url: "http://localhost:3000/", actor: agent })).toEqual({
      allowed: true,
    });
  });

  it("explains why it refuses", () => {
    const check = (url: string, actor = alice as typeof alice | null) =>
      whitelist.check({ url, actor });
    expect(check("https://evil.com/app/x")).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/Origin/),
    });
    expect(check("https://x.vercel.app.evil.com/app")).toMatchObject({ allowed: false });
    expect(check("https://x.vercel.app/blog")).toMatchObject({
      reason: expect.stringMatching(/Path/),
    });
    expect(check("https://x.vercel.app/app/x", null)).toMatchObject({ reason: "Sign-in required" });
    expect(
      whitelist.check({
        url: "https://x.vercel.app/",
        actor: { kind: "human", id: "guest", name: "G" },
      }),
    ).toMatchObject({ allowed: false });
    expect(check("not a url")).toMatchObject({ allowed: false });
  });

  it("checks environments and allows everything with no rules", () => {
    const envs = createStaticWhitelist({ environments: ["preview"] });
    expect(envs.check({ url: "https://a.com", actor: null, environment: "preview" })).toEqual({
      allowed: true,
    });
    expect(envs.check({ url: "https://a.com", actor: null })).toMatchObject({ allowed: false });
    expect(createStaticWhitelist().check({ url: "https://a.com/x", actor: null })).toEqual({
      allowed: true,
    });
  });
});

describe("createStaticAuth", () => {
  it("returns the configured actor", async () => {
    expect(await createStaticAuth(alice).getActor()).toEqual(alice);
    expect(await createStaticAuth(null).getActor()).toBeNull();
  });
});

describe("thread status transitions", () => {
  it("allows reopening closed threads but not skipping back to in_progress", () => {
    expect(canTransition("open", "resolved")).toBe(true);
    expect(canTransition("resolved", "open")).toBe(true);
    expect(canTransition("resolved", "in_progress")).toBe(false);
    expect(canTransition("dismissed", "resolved")).toBe(false);
  });
});

describe("createManualResolution", () => {
  it("resolves immediately with a resolution record", async () => {
    const resolution = createManualResolution({ now });
    const outcome = await resolution.resolve({
      thread: makeThread(),
      actor: agent,
      note: "Fixed padding",
      reference: { kind: "commit", url: "https://github.com/o/r/commit/abc" },
    });
    expect(outcome).toEqual({
      status: "resolved",
      resolution: {
        resolvedBy: agent,
        resolvedAt: now(),
        note: "Fixed padding",
        reference: { kind: "commit", url: "https://github.com/o/r/commit/abc" },
      },
    });
  });

  it("refuses invalid transitions", async () => {
    const resolution = createManualResolution({ now });
    const error = await resolution
      .resolve({ thread: makeThread({ status: "dismissed" }), actor: alice })
      .catch((e: unknown) => e);
    expect(isAnnotateKitError(error) && error.code).toBe("invalid_transition");
    await expect(
      resolution.reopen?.({ thread: makeThread({ status: "resolved" }), actor: alice }),
    ).resolves.toEqual({
      status: "open",
    });
  });
});

describe("createReviewResolution", () => {
  const resolution = createReviewResolution({ now });

  it("parks agent fixes in pending_review", async () => {
    const outcome = await resolution.resolve({ thread: makeThread(), actor: agent, note: "Done" });
    expect(outcome.status).toBe("pending_review");
    expect(outcome.resolution?.resolvedBy).toEqual(agent);
  });

  it("lets a human approve a pending fix", async () => {
    const pending = makeThread({
      status: "pending_review",
      resolution: { resolvedBy: agent, resolvedAt: "2026-02-01T00:00:00.000Z", note: "Done" },
    });
    const outcome = await resolution.resolve({ thread: pending, actor: alice });
    expect(outcome).toEqual({
      status: "resolved",
      resolution: {
        resolvedBy: agent,
        resolvedAt: "2026-02-01T00:00:00.000Z",
        note: "Done",
        reviewedBy: alice,
        reviewedAt: now(),
      },
    });
  });

  it("does not let an agent approve its own fix", async () => {
    const pending = makeThread({
      status: "pending_review",
      resolution: { resolvedBy: agent, resolvedAt: now() },
    });
    await expect(resolution.resolve({ thread: pending, actor: agent })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("resolves human fixes directly", async () => {
    expect((await resolution.resolve({ thread: makeThread(), actor: alice })).status).toBe(
      "resolved",
    );
  });
});

describe("createId", () => {
  it("creates unique prefixed ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId("thr")));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^thr_[0-9a-f]{32}$/);
  });
});

describe("scopes and roles", () => {
  it("expands roles to scopes and checks actions, including ownership", () => {
    expect(scopesForRoles(["commenter"])).toEqual(["annotations:read", "annotations:write"]);
    expect(scopesForRoles(["viewer", "resolver"])).toEqual([
      "annotations:read",
      "annotations:write",
      "annotations:resolve",
    ]);
    expect(highestRole(["viewer", "admin", "commenter"])).toBe("admin");
    expect(highestRole([])).toBeUndefined();
    const mine = makeThread({ createdBy: alice });
    const write = ["annotations:write"] as const;
    expect(scopesAllow(write, { actor: alice, action: "thread:resolve", thread: mine })).toBe(true);
    expect(scopesAllow(write, { actor: agent, action: "thread:resolve", thread: mine })).toBe(
      false,
    );
    expect(scopesAllow(["annotations:resolve"], { actor: agent, action: "thread:resolve" })).toBe(
      true,
    );
    expect(scopesAllow(["annotations:read"], { actor: alice, action: "comment:create" })).toBe(
      false,
    );
    expect(isAuthScope("annotations:read")).toBe(true);
    expect(isAuthScope("root")).toBe(false);
  });
});
