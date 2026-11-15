import { type AnnotateKitClient, createAnnotateKitClient } from "@annotatekit/client";
import type { HumanActor, StorageChange } from "@annotatekit/core";
import { createSqliteStorage } from "@annotatekit/sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeServerAuth,
  createAnnotateKitServer,
  createDevAuth,
  createStaticServerAuth,
  createTokenAuth,
  type RunningServer,
  serve,
} from "../src/index.js";

const alan: HumanActor = { kind: "human", id: "usr_alan", name: "Alan" };

const newThread = {
  projectId: "shop",
  page: {
    url: "https://shop.example.com/checkout",
    origin: "https://shop.example.com",
    pathname: "/checkout",
  },
  annotation: {
    kind: "pin" as const,
    position: { x: 0.5, y: 0.5 },
    anchor: {
      selector: '[data-testid="pay"]',
      tagName: "button",
      rect: { x: 0, y: 0, width: 100, height: 40 },
      scroll: { x: 0, y: 0 },
    },
    context: { viewport: { width: 1280, height: 800, devicePixelRatio: 2 } },
  },
  comment: { body: "Padding is off" },
};

describe("server over HTTP with the client", () => {
  let running: RunningServer;
  let client: AnnotateKitClient;
  let agentClient: AnnotateKitClient;

  beforeAll(async () => {
    const app = createAnnotateKitServer({
      storage: createSqliteStorage(),
      auth: composeServerAuth(
        createTokenAuth({ tokens: { "secret-1": { kind: "agent", id: "agt_ci", name: "CI" } } }),
        createDevAuth(),
      ),
      cors: { origins: ["http://localhost:*"] },
      heartbeatMs: 50,
    });
    running = await serve(app.fetch, { port: 0 });
    client = createAnnotateKitClient({ baseUrl: `${running.url}/v1`, reconnectMs: 50 });
    agentClient = createAnnotateKitClient({ baseUrl: `${running.url}/v1`, token: "secret-1" });
  });
  afterAll(() => running.close());

  it("creates, lists, comments and resolves through review", async () => {
    const created = await client.createThread(alan, newThread);
    expect(created.thread.createdBy).toEqual(alan);
    expect(created.comments).toHaveLength(1);

    const list = await client.listThreads(null, { projectId: "shop", status: ["open"] });
    expect(list.items.map((t) => t.id)).toContain(created.thread.id);

    await agentClient.setThreadStatus(null, created.thread.id, { status: "in_progress" });
    const proposed = await agentClient.resolveThread(null, created.thread.id, {
      note: "Fixed in PayButton.tsx",
    });
    expect(proposed.status).toBe("pending_review");
    expect(proposed.resolution?.resolvedBy.id).toBe("agt_ci");

    const approved = await client.resolveThread(alan, created.thread.id);
    expect(approved.status).toBe("resolved");

    const detail = await client.getThread(null, created.thread.id);
    expect(detail.comments.length).toBe(4);
  });

  it("maps errors to codes and statuses", async () => {
    await expect(client.getThread(null, "thr_missing")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(client.createThread(null, newThread)).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(client.listThreads(null, { status: "bogus" as never })).rejects.toMatchObject({
      code: "invalid_input",
    });
    const res = await fetch(`${running.url}/v1/threads`, {
      method: "POST",
      headers: { "x-annotatekit-actor": JSON.stringify(alan) },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect((await fetch(`${running.url}/v1/nope`)).status).toBe(404);
    expect((await fetch(`${running.url}/v1/threads`, { method: "PUT" })).status).toBe(405);
  });

  it("answers CORS preflight for allowed origins only", async () => {
    const ok = await fetch(`${running.url}/v1/threads`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const denied = await fetch(`${running.url}/v1/threads`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("streams changes to subscribers", async () => {
    const changes: StorageChange[] = [];
    const stop = client.subscribe((c) => changes.push(c), { projectId: "shop" });
    await new Promise((r) => setTimeout(r, 100));
    const { thread } = await client.createThread(alan, newThread);
    await waitFor(() => changes.some((c) => c.type === "put" && c.id === thread.id));
    await waitFor(() => changes.some((c) => c.collection === "comments"));
    stop();
  });

  it("manages groups", async () => {
    const group = await client.createGroup(alan, { projectId: "shop", name: "Checkout" });
    expect((await client.listGroups(null, { projectId: "shop" })).items).toEqual([group]);
    const renamed = await client.updateGroup(alan, group.id, { name: "Checkout polish" });
    expect(renamed.name).toBe("Checkout polish");
    await client.deleteGroup(alan, group.id);
    expect((await client.listGroups(null, { projectId: "shop" })).items).toEqual([]);
  });
});

describe("server options", () => {
  it("rejects origins the whitelist blocks", async () => {
    const app = createAnnotateKitServer({
      storage: createSqliteStorage(),
      auth: createStaticServerAuth(alan),
      whitelist: { check: ({ url }) => ({ allowed: url.startsWith("http://localhost") }) },
    });
    const blocked = await app.fetch(
      new Request("http://x/v1/threads", { headers: { origin: "https://evil.example" } }),
    );
    expect(blocked.status).toBe(403);
    const allowed = await app.fetch(
      new Request("http://x/v1/threads", { headers: { origin: "http://localhost:3000" } }),
    );
    expect(allowed.status).toBe(200);
    // Agents and scripts send no Origin.
    expect((await app.fetch(new Request("http://x/v1/threads"))).status).toBe(200);
  });

  it("enforces read-only and sign-in whitelist decisions", async () => {
    const app = createAnnotateKitServer({
      storage: createSqliteStorage(),
      auth: createStaticServerAuth(null),
      whitelist: {
        check: ({ url, actor }) =>
          url.includes("prod")
            ? { allowed: true, readOnly: true }
            : actor
              ? { allowed: true }
              : { allowed: false, signIn: true, reason: "Sign-in required" },
      },
    });
    const prod = { origin: "https://prod.example" };
    expect((await app.fetch(new Request("http://x/v1/threads", { headers: prod }))).status).toBe(
      200,
    );
    const write = await app.fetch(
      new Request("http://x/v1/threads", { method: "POST", headers: prod, body: "{}" }),
    );
    expect(write.status).toBe(403);
    const staging = { origin: "https://staging.example" };
    expect((await app.fetch(new Request("http://x/v1/threads", { headers: staging }))).status).toBe(
      401,
    );
  });

  it("mounts extra handlers and honours basePath", async () => {
    const app = createAnnotateKitServer({
      storage: createSqliteStorage(),
      auth: createStaticServerAuth(null),
      basePath: "/api/annotatekit",
      mount: { "/mcp": async () => new Response("mcp here") },
    });
    expect(await (await app.fetch(new Request("http://x/mcp"))).text()).toBe("mcp here");
    const health = await app.fetch(new Request("http://x/api/annotatekit/health"));
    expect(await health.json()).toEqual({ ok: true, events: true });
  });
});

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
