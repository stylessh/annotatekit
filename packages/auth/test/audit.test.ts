import { createMemoryAuditLog, type HumanActor } from "@annotatekit/core";
import { createAnnotateKitServer } from "@annotatekit/server";
import { createSqliteAuditLog, createSqliteStorage, openDatabase } from "@annotatekit/sqlite";
import { describe, expect, it } from "vitest";
import {
  allow,
  createServerAuth,
  emailDomains,
  hostJwtVerifier,
  type MagicLinkEmail,
  magicLinkAuth,
  mapGroups,
  mintHostToken,
  rules,
} from "../src/index.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";
const origin = "https://staging.acme.com";

const admin: HumanActor = {
  kind: "human",
  id: "usr_admin",
  name: "Admin",
  email: "admin@acme.com",
  emailVerified: true,
  groups: ["annotatekit-admins"],
};
const viewer: HumanActor = {
  kind: "human",
  id: "usr_view",
  name: "Viewer",
  email: "view@acme.com",
  emailVerified: true,
  groups: ["viewers"],
};

const thread = {
  projectId: "shop",
  page: { url: `${origin}/checkout`, origin, pathname: "/checkout" },
  annotation: {
    kind: "pin" as const,
    position: { x: 0.5, y: 0.5 },
    anchor: {
      selector: "#pay",
      tagName: "button",
      rect: { x: 0, y: 0, width: 100, height: 40 },
      scroll: { x: 0, y: 0 },
    },
    context: { viewport: { width: 1280, height: 800, devicePixelRatio: 2 } },
  },
  comment: { body: "Button is misaligned" },
};

async function setup(withAuthorizer = true) {
  const db = openDatabase(":memory:");
  const audit = createSqliteAuditLog({ database: db });
  const serverAuth = createServerAuth({
    verifier: hostJwtVerifier({ secret: SECRET, issuer: "shop" }),
    roles: mapGroups({ admin: ["annotatekit-admins"], viewer: ["viewers"] }),
  });
  const app = createAnnotateKitServer({
    storage: createSqliteStorage({ database: db }),
    auth: withAuthorizer ? serverAuth : { authenticate: serverAuth.authenticate },
    whitelist: rules(allow(emailDomains(["acme.com"]))),
    audit,
  });
  const tokens = {
    admin: await mintHostToken(admin, { secret: SECRET, issuer: "shop" }),
    viewer: await mintHostToken(viewer, { secret: SECRET, issuer: "shop" }),
  };
  const call = (method: string, path: string, token?: string, body?: unknown) =>
    app.fetch(
      new Request(`http://x/v1${path}`, {
        method,
        headers: {
          origin,
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { audit, call, tokens };
}

describe("audit log", () => {
  it("records writes and refusals, but not plain reads", async () => {
    const { audit, call, tokens } = await setup();
    const created = await call("POST", "/threads", tokens.admin, thread);
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { thread: { id: string } }).thread.id;

    expect((await call("GET", "/threads", tokens.viewer)).status).toBe(200);
    expect((await call("POST", `/threads/${id}/resolve`, tokens.viewer)).status).toBe(403);
    expect((await call("POST", `/threads/${id}/resolve`, tokens.admin)).status).toBe(200);
    expect((await call("DELETE", "/threads/thr_missing", tokens.admin)).status).toBe(404);
    expect((await call("POST", "/threads", undefined, thread)).status).toBe(401);

    const events = await audit.list();
    expect(events.map((e) => [e.action, e.decision, e.actor?.id ?? null])).toEqual([
      ["thread:create", "deny", null],
      ["thread:delete", "error", "usr_admin"],
      ["thread:resolve", "allow", "usr_admin"],
      ["thread:resolve", "deny", "usr_view"],
      ["thread:create", "allow", "usr_admin"],
    ]);
    const denied = events[3];
    expect(denied).toMatchObject({
      target: { type: "thread", id },
      origin,
      status: 403,
      actor: { kind: "human", name: "Viewer", provider: "host" },
    });
    expect(denied?.reason).toBeTruthy();
    // Email and groups stay out of the log.
    expect(JSON.stringify(events)).not.toContain("view@acme.com");
  });

  it("serves the log to admins only, and filters it", async () => {
    const { call, tokens } = await setup();
    await call("POST", "/threads", tokens.viewer, thread);
    await call("POST", "/threads", tokens.admin, thread);

    expect((await call("GET", "/audit", tokens.viewer)).status).toBe(403);
    expect((await call("GET", "/audit")).status).toBe(401);
    const res = await call("GET", "/audit?decision=deny", tokens.admin);
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as {
      events: { action: string; actor: { id: string } }[];
    };
    // The two refused audit reads and the viewer's refused create, newest first.
    expect(events.map((e) => e.action)).toEqual(["audit:read", "audit:read", "thread:create"]);

    const mine = (await (
      await call("GET", "/audit?actorId=usr_admin&limit=1", tokens.admin)
    ).json()) as {
      events: { action: string }[];
    };
    // Reading the log is itself recorded.
    expect(mine.events).toHaveLength(1);
    expect(mine.events[0]?.action).toBe("audit:read");
    expect((await call("GET", "/audit?decision=maybe", tokens.admin)).status).toBe(400);
  });

  it("refuses to serve the log when no authorizer can tell who is an admin", async () => {
    const { call, tokens } = await setup(false);
    expect((await call("GET", "/audit", tokens.admin)).status).toBe(403);
  });

  it("keeps working when the log cannot be written", async () => {
    const app = createAnnotateKitServer({
      storage: createSqliteStorage(),
      auth: { authenticate: () => admin },
      audit: {
        record: async () => {
          throw new Error("disk full");
        },
        list: async () => [],
      },
    });
    const error = console.error;
    console.error = () => {};
    try {
      const res = await app.fetch(
        new Request("http://x/v1/threads", { method: "POST", body: JSON.stringify(thread) }),
      );
      expect(res.status).toBe(201);
    } finally {
      console.error = error;
    }
  });

  it("records magic-link sends and sessions", async () => {
    const audit = createMemoryAuditLog();
    const sent: MagicLinkEmail[] = [];
    const auth = magicLinkAuth({
      mailer: { send: async (m) => void sent.push(m) },
      sessionSecret: SECRET,
      baseUrl: "https://ak.example.com/auth",
      allowedOrigins: ["https://*.acme.com"],
      allowedDomains: ["acme.com"],
      audit,
    });
    const ask = (email: string) =>
      auth.handler(
        new Request("https://ak.example.com/auth/magic-link", {
          method: "POST",
          body: JSON.stringify({ email, returnTo: `${origin}/` }),
        }),
      );
    await ask("eve@evil.com");
    await ask("dana@acme.com");
    const link = sent[0]?.url as string;
    await auth.handler(new Request(link));
    await auth.handler(new Request(link));

    const events = await audit.list();
    expect(events.map((e) => [e.action, e.decision, e.actor?.id ?? null])).toEqual([
      ["session:issue", "deny", null],
      ["session:issue", "allow", "email|dana@acme.com"],
      ["magic-link:send", "allow", null],
      ["magic-link:send", "deny", null],
    ]);
    expect(events[3]?.reason).toContain("evil.com");
    expect(await audit.list({ action: "session:issue", decision: "allow" })).toHaveLength(1);
  });
});
