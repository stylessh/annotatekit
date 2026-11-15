import { createAnnotateKitClient } from "@annotatekit/client";
import { createMemoryAuditLog, type HumanActor } from "@annotatekit/core";
import { createAnnotateKitServer } from "@annotatekit/server";
import { createSqliteStorage } from "@annotatekit/sqlite";
import { describe, expect, it } from "vitest";
import {
  anyVerifier,
  apiKeyVerifier,
  createApiKeyHandler,
  createMemoryApiKeyStore,
  createServerAuth,
  hashSharedPassword,
  hostJwtVerifier,
  mapGroups,
  mintHostToken,
  sharedPasswordAuth,
} from "../src/index.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";

const admin: HumanActor = { kind: "human", id: "usr_admin", name: "Admin", groups: ["admins"] };
const dana: HumanActor = { kind: "human", id: "usr_dana", name: "Dana", groups: ["eng"] };

async function setup(mintScope?: "annotations:write") {
  const store = createMemoryApiKeyStore();
  const audit = createMemoryAuditLog();
  const roles = mapGroups({ admin: ["admins"], commenter: ["eng"] });
  const guests = sharedPasswordAuth({
    passwordHash: await hashSharedPassword("open sesame"),
    sessionSecret: SECRET,
  });
  const humans = anyVerifier(hostJwtVerifier({ secret: SECRET, issuer: "shop" }), guests.verifier);
  const keys = createApiKeyHandler({
    store,
    verifier: anyVerifier(humans, apiKeyVerifier({ store })),
    roles,
    audit,
    ...(mintScope ? { mintScope } : {}),
  });
  const app = createAnnotateKitServer({
    storage: createSqliteStorage(),
    auth: createServerAuth({ verifier: anyVerifier(humans, apiKeyVerifier({ store })), roles }),
    mount: { "/v1/keys": keys },
  });
  const token = (actor: HumanActor) => mintHostToken(actor, { secret: SECRET, issuer: "shop" });
  const clientFor = (bearer: string) =>
    createAnnotateKitClient({
      baseUrl: "http://x/v1",
      token: bearer,
      fetch: (input, init) => app.fetch(new Request(input, init)),
    });
  return { store, audit, app, token, clientFor, guests };
}

describe("createApiKeyHandler", () => {
  it("lets an admin mint, list and revoke keys, and the key works until revoked", async () => {
    const { clientFor, token, audit } = await setup();
    const client = clientFor(await token(admin));

    const before = await client.apiKeys.list();
    expect(before).toMatchObject({ keys: [], admin: true });
    expect(before.grantable).toContain("project:admin");

    const { key, record } = await client.apiKeys.create({
      name: "Claude Code",
      scopes: ["annotations:read", "annotations:write"],
      expiresInDays: 7,
    });
    expect(key).toMatch(/^ak_live_/);
    expect(record).not.toHaveProperty("hash");
    expect(record).toMatchObject({ name: "Claude Code", onBehalfOf: "usr_admin" });

    const agent = clientFor(key);
    expect((await agent.listThreads(null)).items).toEqual([]);
    // Agents can't manage keys, even with a valid key.
    await expect(agent.apiKeys.list()).rejects.toMatchObject({ code: "forbidden" });

    const listed = (await client.apiKeys.list()).keys;
    expect(listed.map((k) => k.id)).toEqual([record.id]);
    expect(listed[0]?.lastUsedAt).toBeTypeOf("number");

    await client.apiKeys.revoke(record.id);
    // A revoked key is no credential at all, and anonymous reads are off.
    await expect(agent.listThreads(null)).rejects.toMatchObject({ code: "forbidden" });
    expect((await client.apiKeys.list()).keys[0]?.revokedAt).toBeTypeOf("number");

    const events = await audit.list();
    expect(events.map((e) => [e.action, e.decision])).toEqual([
      ["apikey:revoke", "allow"],
      ["apikey:mint", "allow"],
    ]);
    expect(events[1]).toMatchObject({
      actor: { id: "usr_admin" },
      target: { type: "apikey", id: record.id },
      details: { scopes: "annotations:read annotations:write" },
    });
  });

  it("needs project:admin to mint by default, and never grants more than you hold", async () => {
    const { clientFor, token, audit } = await setup();
    const client = clientFor(await token(dana));
    expect(await client.apiKeys.list()).toEqual({ keys: [], grantable: [], admin: false });
    await expect(client.apiKeys.create({ scopes: ["annotations:read"] })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await audit.list())[0]).toMatchObject({ action: "apikey:mint", decision: "deny" });

    const open = await setup("annotations:write");
    const commenter = open.clientFor(await open.token(dana));
    expect((await commenter.apiKeys.list()).grantable).toEqual([
      "annotations:read",
      "annotations:write",
    ]);
    await expect(
      commenter.apiKeys.create({ scopes: ["annotations:resolve"] }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const { record } = await commenter.apiKeys.create({ scopes: ["annotations:read"] });
    expect(record.name).toBe("Agent");
  });

  it("keeps people to their own keys unless they are admins", async () => {
    const { clientFor, token } = await setup("annotations:write");
    const asAdmin = clientFor(await token(admin));
    const asDana = clientFor(await token(dana));
    const mine = await asDana.apiKeys.create({ scopes: ["annotations:read"] });
    const theirs = await asAdmin.apiKeys.create({ scopes: ["annotations:read"] });

    expect((await asDana.apiKeys.list({ all: true })).keys.map((k) => k.id)).toEqual([
      mine.record.id,
    ]);
    expect((await asAdmin.apiKeys.list()).keys.map((k) => k.id)).toEqual([theirs.record.id]);
    expect((await asAdmin.apiKeys.list({ all: true })).keys).toHaveLength(2);

    await expect(asDana.apiKeys.revoke(theirs.record.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await asAdmin.apiKeys.revoke(mine.record.id);
    await expect(asAdmin.apiKeys.revoke("key_nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses guests, anonymous callers and form posts", async () => {
    const { app, guests, token } = await setup("annotations:write");
    const guestToken = (await guests.signIn("open sesame", "Visitor")) as string;
    const post = (headers: Record<string, string>, body = '{"scopes":["annotations:read"]}') =>
      app.fetch(new Request("http://x/v1/keys", { method: "POST", headers, body }));

    const guest = await post({
      authorization: `Bearer ${guestToken}`,
      "content-type": "application/json",
    });
    expect(guest.status).toBe(403);
    expect(await guest.text()).toContain("Guests");
    expect((await post({ "content-type": "application/json" })).status).toBe(401);
    const form = await post(
      { authorization: `Bearer ${await token(dana)}`, "content-type": "text/plain" },
      '{"scopes":["annotations:read"]}',
    );
    expect(form.status).toBe(400);
    const list = await app.fetch(new Request("http://x/v1/keys"));
    expect(list.status).toBe(401);
    expect(((await list.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });
});
