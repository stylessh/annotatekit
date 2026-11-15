import type { HumanActor } from "@annotatekit/core";
import { createAnnotateKitServer } from "@annotatekit/server";
import { createSqliteStorage } from "@annotatekit/sqlite";
import { describe, expect, it } from "vitest";
import {
  allow,
  anonymous,
  anyVerifier,
  apiKeyVerifier,
  createMemoryApiKeyStore,
  createServerAuth,
  emailDomains,
  hostJwtVerifier,
  mapGroups,
  mintApiKey,
  mintHostToken,
  readOnly,
  rules,
} from "../src/index.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";

const admin: HumanActor = {
  kind: "human",
  id: "usr_admin",
  name: "Admin",
  email: "admin@acme.com",
  emailVerified: true,
  groups: ["annotatekit-admins"],
};

describe("createServerAuth with @annotatekit/server", async () => {
  const keys = createMemoryApiKeyStore();
  const app = createAnnotateKitServer({
    storage: createSqliteStorage(),
    auth: createServerAuth({
      verifier: anyVerifier(
        hostJwtVerifier({ secret: SECRET, issuer: "shop" }),
        apiKeyVerifier({ store: keys }),
      ),
      roles: mapGroups({ admin: ["annotatekit-admins"], default: "commenter" }),
      anonymousRead: true,
    }),
    whitelist: rules(allow(emailDomains(["acme.com"])), readOnly(anonymous())),
  });
  const adminToken = await mintHostToken(admin, { secret: SECRET, issuer: "shop" });
  const { key } = await mintApiKey({
    store: keys,
    minter: admin,
    minterScopes: ["annotations:read", "annotations:write"],
    scopes: ["annotations:read", "annotations:write"],
    name: "Claude Code",
  });
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    app.fetch(
      new Request(`http://x/v1${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const page = { origin: "https://staging.acme.com" };

  it("lets the admin manage groups and keeps the agent to its scopes", async () => {
    const group = { projectId: "shop", name: "Checkout" };
    const asAdmin = await call(
      "POST",
      "/groups",
      { ...page, authorization: `Bearer ${adminToken}` },
      group,
    );
    expect(asAdmin.status).toBe(201);
    const asAgent = await call("POST", "/groups", { authorization: `Bearer ${key}` }, group);
    expect(asAgent.status).toBe(403);
    expect((await call("GET", "/threads", { authorization: `Bearer ${key}` })).status).toBe(200);
  });

  it("lets anonymous visitors read but not write, and rejects forged credentials", async () => {
    expect((await call("GET", "/threads", page)).status).toBe(200);
    expect((await call("POST", "/groups", page, { projectId: "shop", name: "x" })).status).toBe(
      403,
    );
    const forged = await call(
      "POST",
      "/groups",
      { authorization: "Bearer ak_live_forged" },
      {
        projectId: "shop",
        name: "x",
      },
    );
    expect([401, 403]).toContain(forged.status);
  });
});
