import type { HumanActor, Thread } from "@annotatekit/core";
import { describe, expect, it } from "vitest";
import {
  agents,
  all,
  allow,
  anonymous,
  anyVerifier,
  apiKeyVerifier,
  createMemoryApiKeyStore,
  createRequestGuard,
  createRoleAuthorizer,
  deny,
  emailDomains,
  environments,
  groups,
  hashSharedPassword,
  hostJwtVerifier,
  hostSessionVerifier,
  mapGroups,
  mintApiKey,
  mintHostToken,
  not,
  origins,
  paths,
  readOnly,
  revokeApiKey,
  rules,
  sharedPasswordAuth,
  signToken,
  verifyToken,
} from "../src/index.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";
const T0 = Date.parse("2026-11-15T12:00:00Z");
const at = (ms: number) => () => ms;

const alan: HumanActor = {
  kind: "human",
  id: "usr_alan",
  name: "Alan",
  email: "alan@acme.com",
  emailVerified: true,
  provider: "host",
  groups: ["Eng"],
};

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://annotatekit.example.com/api/threads", { headers });
}

function bearer(token: string, extra: Record<string, string> = {}): Request {
  return req({ authorization: `Bearer ${token}`, ...extra });
}

describe("tokens", () => {
  it("round-trips and rejects tampering, wrong audience, expiry and long lifetimes", async () => {
    const token = await signToken(
      { iss: "shop", aud: "annotatekit", sub: "u1" },
      { secret: SECRET, ttlSeconds: 300, now: at(T0) },
    );
    const opts = { secret: SECRET, issuers: ["shop"], audience: "annotatekit", now: at(T0) };
    expect(await verifyToken(token, opts)).toMatchObject({ sub: "u1", iss: "shop" });
    expect(await verifyToken(`${token}x`, opts)).toBeNull();
    expect(await verifyToken(token, { ...opts, audience: "other" })).toBeNull();
    expect(await verifyToken(token, { ...opts, issuers: ["other"] })).toBeNull();
    expect(await verifyToken(token, { ...opts, now: at(T0 + 400_000) })).toBeNull();
    expect(await verifyToken(token, { ...opts, maxTtlSeconds: 60 })).toBeNull();
    expect(await verifyToken("a.b.c", opts)).toBeNull();
    const [, body, sig] = token.split(".");
    const none = btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "");
    expect(await verifyToken(`${none}.${body}.${sig}`, opts)).toBeNull();
  });

  it("refuses short secrets", async () => {
    await expect(
      signToken({ iss: "a", aud: "b", sub: "c" }, { secret: "short", ttlSeconds: 1 }),
    ).rejects.toThrow(/32 bytes/);
  });
});

describe("host mode", () => {
  it("verifies tokens minted by the app's backend", async () => {
    const token = await mintHostToken(alan, { secret: SECRET, issuer: "shop", now: at(T0) });
    const verifier = hostJwtVerifier({ secret: SECRET, issuer: "shop", now: at(T0 + 1000) });
    const principal = await verifier.verify(bearer(token));
    expect(principal?.actor).toEqual(alan);
    expect(principal?.expiresAt).toBe(T0 + 300_000);
    expect(await verifier.verify(req())).toBeNull();
    expect(
      await hostJwtVerifier({ secret: SECRET, issuer: "other", now: at(T0) }).verify(bearer(token)),
    ).toBeNull();
  });

  it("reuses the app's own session lookup", async () => {
    const verifier = hostSessionVerifier({
      verify: (r: Request) =>
        r.headers.get("cookie") === "sid=1" ? { ...alan, provider: undefined } : null,
    } as never);
    expect((await verifier.verify(req({ cookie: "sid=1" })))?.actor).toMatchObject({
      id: "usr_alan",
      kind: "human",
    });
    expect(await verifier.verify(req())).toBeNull();
  });
});

describe("shared password", () => {
  it("signs guests in with their own name and refuses wrong passwords", async () => {
    const passwordHash = await hashSharedPassword("hunter2", 1000);
    const auth = sharedPasswordAuth({ passwordHash, sessionSecret: SECRET, now: at(T0) });
    expect(await auth.signIn("wrong", "Eve")).toBeNull();
    const token = await auth.signIn("hunter2", "  Dana  ");
    expect(token).toBeTypeOf("string");
    const principal = await auth.verifier.verify(bearer(token as string));
    expect(principal?.actor).toMatchObject({
      kind: "human",
      name: "Dana",
      provider: "shared-password",
      groups: ["guest"],
    });
    // A host verifier with the same secret does not accept guest tokens, and vice versa.
    const host = hostJwtVerifier({ secret: SECRET, issuer: "annotatekit", now: at(T0) });
    expect(await host.verify(bearer(token as string))).toBeNull();
  });
});

describe("whitelist rules", () => {
  const whitelist = rules(
    deny(not(origins(["https://*.acme.com", "http://localhost:*"])), "Unknown site"),
    deny(environments(["production"])),
    allow(all(emailDomains(["acme.com"]), groups(["Eng", "Design"]))),
    allow(all(agents(), paths(["/checkout/**"]))),
    readOnly(anonymous()),
  );

  it("lets the first matching rule decide", async () => {
    const check = (url: string, actor: HumanActor | null = alan, environment?: string) =>
      whitelist.check({ url, actor, ...(environment ? { environment } : {}) });
    expect(await check("https://staging.acme.com/x")).toEqual({ allowed: true });
    expect(await check("http://localhost:5173/")).toEqual({ allowed: true });
    expect(await check("https://evil.com/")).toEqual({ allowed: false, reason: "Unknown site" });
    expect(await check("https://staging.acme.com/", alan, "production")).toMatchObject({
      allowed: false,
    });
    expect(await check("https://staging.acme.com/", null)).toEqual({
      allowed: true,
      readOnly: true,
      signIn: true,
    });
    expect(await check("https://staging.acme.com/", { ...alan, emailVerified: false })).toEqual({
      allowed: false,
      reason: "No whitelist rule matched",
    });
    expect(await check("not a url")).toMatchObject({ allowed: false });
  });

  it("matches path globs by segment", async () => {
    const agent = { kind: "agent" as const, id: "a", name: "Claude" };
    const ok = (path: string) =>
      whitelist.check({ url: `https://a.acme.com${path}`, actor: agent });
    expect(await ok("/checkout/pay/now")).toEqual({ allowed: true });
    expect(await ok("/blog")).toMatchObject({ allowed: false });
  });
});

describe("roles", () => {
  const roles = mapGroups({
    admin: ["usr_root"],
    resolver: ["Eng"],
    commenter: ["*@agency.io", "guest"],
    default: "viewer",
  });

  it("maps groups, ids and verified emails, with a default", async () => {
    expect(await roles(alan)).toEqual(["resolver"]);
    expect(await roles({ ...alan, id: "usr_root" })).toEqual(["resolver", "admin"]);
    const agency = { ...alan, groups: [], email: "kim@agency.io" };
    expect(await roles(agency)).toEqual(["commenter"]);
    expect(await roles({ ...agency, emailVerified: false })).toEqual(["viewer"]);
    expect(await roles({ kind: "agent", id: "a", name: "A" })).toEqual([]);
  });

  it("caps shared-password guests at commenter", async () => {
    const guest: HumanActor = {
      kind: "human",
      id: "guest_1",
      name: "G",
      provider: "shared-password",
      groups: ["Eng"],
    };
    expect(await roles(guest)).toEqual(["commenter"]);
  });

  it("authorizes by scope, letting commenters manage only their own threads", async () => {
    const authorize = createRoleAuthorizer(mapGroups({ commenter: ["QA"], resolver: ["Eng"] }));
    const qa = { ...alan, id: "usr_qa", groups: ["QA"] };
    const mine = { createdBy: qa } as Thread;
    const theirs = { createdBy: alan } as Thread;
    expect(await authorize({ actor: qa, action: "comment:create" })).toBe(true);
    expect(await authorize({ actor: qa, action: "thread:resolve", thread: mine })).toBe(true);
    expect(await authorize({ actor: qa, action: "thread:resolve", thread: theirs })).toBe(false);
    expect(await authorize({ actor: alan, action: "thread:resolve", thread: mine })).toBe(true);
    expect(await authorize({ actor: alan, action: "group:manage" })).toBe(false);
    expect(await authorize({ actor: null, action: "thread:read" })).toBe(false);
  });
});

describe("API keys", () => {
  it("mints scoped keys that verify, expire and revoke", async () => {
    const store = createMemoryApiKeyStore();
    const { key, record } = await mintApiKey({
      store,
      minter: alan,
      minterScopes: ["annotations:read", "annotations:write", "annotations:resolve"],
      scopes: ["annotations:read", "annotations:write"],
      name: "Claude Code",
      expiresInDays: 1,
      now: at(T0),
    });
    expect(key).toMatch(/^ak_live_[A-Za-z0-9]{32}$/);
    expect(record.hash).not.toContain(key);
    expect(JSON.stringify(await store.list())).not.toContain(key);

    const verifier = apiKeyVerifier({ store, now: at(T0 + 1000) });
    const principal = await verifier.verify(bearer(key));
    expect(principal).toMatchObject({
      actor: { kind: "agent", name: "Claude Code", onBehalfOf: "usr_alan" },
      scopes: ["annotations:read", "annotations:write"],
    });
    expect((await store.list())[0]?.lastUsedAt).toBe(T0 + 1000);

    const narrowed = apiKeyVerifier({
      store,
      now: at(T0),
      currentScopes: () => ["annotations:read"],
    });
    expect((await narrowed.verify(bearer(key)))?.scopes).toEqual(["annotations:read"]);

    expect(
      await apiKeyVerifier({ store, now: at(T0 + 2 * 86_400_000) }).verify(bearer(key)),
    ).toBeNull();
    await revokeApiKey(store, record.id, T0);
    expect(await verifier.verify(bearer(key))).toBeNull();
    expect(await verifier.verify(bearer("ak_live_nope"))).toBeNull();
  });

  it("never grants more than the minter holds", async () => {
    await expect(
      mintApiKey({
        store: createMemoryApiKeyStore(),
        minter: alan,
        minterScopes: ["annotations:read"],
        scopes: ["annotations:resolve"],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      mintApiKey({
        store: createMemoryApiKeyStore(),
        minter: alan,
        minterScopes: ["annotations:read"],
        scopes: ["annotations:read"],
        expiresInDays: 400,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("request guard", () => {
  const store = createMemoryApiKeyStore();
  const guard = createRequestGuard({
    verifier: anyVerifier(
      hostJwtVerifier({ secret: SECRET, issuer: "shop", now: at(T0) }),
      apiKeyVerifier({ store, now: at(T0) }),
    ),
    whitelist: rules(
      deny(not(origins(["https://*.acme.com"]))),
      readOnly(environments(["production"])),
      allow(emailDomains(["acme.com"])),
      allow(agents()),
      readOnly(anonymous()),
    ),
    roles: mapGroups({ resolver: ["Eng"], default: "commenter" }),
  });
  const page = "https://staging.acme.com/checkout";
  const origin = { origin: "https://staging.acme.com" };

  it("accepts a verified, whitelisted, permitted request", async () => {
    const token = await mintHostToken(alan, { secret: SECRET, issuer: "shop", now: at(T0) });
    const result = await guard.check(bearer(token, origin), {
      action: "thread:create",
      pageUrl: page,
    });
    expect(result).toMatchObject({ ok: true, actor: { id: "usr_alan" }, readOnly: false });
  });

  it("refuses each failure with the right status", async () => {
    const token = await mintHostToken(alan, { secret: SECRET, issuer: "shop", now: at(T0) });
    const check = (r: Request, action = "thread:create" as const, extra = {}) =>
      guard.check(r, { action, pageUrl: page, ...extra });

    expect(await check(bearer(token, { origin: "https://evil.com" }))).toMatchObject({
      ok: false,
      status: 403,
      code: "bad_origin",
    });
    expect(await check(bearer(`${token}x`, origin))).toMatchObject({
      status: 401,
      code: "unauthenticated",
      signIn: true,
    });
    expect(await guard.check(req(origin), { action: "thread:read", pageUrl: page })).toMatchObject({
      ok: true,
      actor: null,
      readOnly: true,
    });
    expect(
      await check(bearer(token, origin), "thread:create", { environment: "production" }),
    ).toMatchObject({ status: 403, code: "read_only" });
    expect(await check(bearer(token, origin), "group:manage" as never)).toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(await guard.check(bearer(token), { action: "thread:read" })).toMatchObject({
      status: 400,
      code: "missing_page",
    });
  });

  it("lets agents call without a page, limited to their key's scopes", async () => {
    const { key } = await mintApiKey({
      store,
      minter: alan,
      minterScopes: ["annotations:read", "annotations:write", "annotations:resolve"],
      scopes: ["annotations:read", "annotations:write"],
      now: at(T0),
    });
    expect(await guard.check(bearer(key), { action: "comment:create" })).toMatchObject({
      ok: true,
      actor: { kind: "agent", onBehalfOf: "usr_alan" },
    });
    // Without annotations:resolve the agent only closes what Alan opened, as Alan could.
    expect(
      await guard.check(bearer(key), {
        action: "thread:resolve",
        thread: { createdBy: alan } as Thread,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await guard.check(bearer(key), {
        action: "thread:resolve",
        thread: { createdBy: { kind: "human", id: "usr_bea", name: "Bea" } } as Thread,
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("guest policy", () => {
  const guest: HumanActor = {
    kind: "human",
    id: "guest_1",
    name: "Guest",
    provider: "shared-password",
    groups: ["guest"],
  };
  const own = { createdBy: guest } as Thread;
  const roles = mapGroups({ default: "commenter" });

  it("lets guests comment but not resolve, even their own threads, by default", async () => {
    const authorize = createRoleAuthorizer(roles);
    expect(await authorize({ actor: guest, action: "comment:create" })).toBe(true);
    expect(await authorize({ actor: guest, action: "thread:create" })).toBe(true);
    expect(await authorize({ actor: guest, action: "thread:resolve", thread: own })).toBe(false);
    const relaxed = createRoleAuthorizer(roles, undefined, "own-threads");
    expect(await relaxed({ actor: guest, action: "thread:resolve", thread: own })).toBe(true);
  });
});
