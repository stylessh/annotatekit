import type { HumanActor } from "@annotatekit/core";
import { openDatabase } from "@annotatekit/sqlite";
import { describe, expect, it } from "vitest";
import {
  apiKeyVerifier,
  createSqliteApiKeyStore,
  createSqliteUsedTokenStore,
  type MagicLinkEmail,
  magicLinkAuth,
  mintApiKey,
  revokeApiKey,
} from "../src/index.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";
const alan: HumanActor = { kind: "human", id: "usr_alan", name: "Alan" };
const bearer = (t: string) =>
  new Request("https://x", { headers: { authorization: `Bearer ${t}` } });

describe("SQLite API key store", () => {
  it("persists keys across store instances and supports revoke and listing", async () => {
    const db = openDatabase(":memory:");
    const store = createSqliteApiKeyStore(db);
    const { key, record } = await mintApiKey({
      store,
      minter: alan,
      minterScopes: ["annotations:read", "annotations:write"],
      scopes: ["annotations:read"],
      name: "Claude Code",
    });
    const reopened = createSqliteApiKeyStore(db);
    expect(await reopened.list({ onBehalfOf: "usr_alan" })).toEqual([record]);
    expect(await reopened.list({ onBehalfOf: "someone" })).toEqual([]);

    const principal = await apiKeyVerifier({ store: reopened }).verify(bearer(key));
    expect(principal?.scopes).toEqual(["annotations:read"]);
    expect((await reopened.list())[0]?.lastUsedAt).toBeTypeOf("number");

    await revokeApiKey(reopened, record.id);
    expect(await apiKeyVerifier({ store }).verify(bearer(key))).toBeNull();
  });
});

describe("magic links", () => {
  function setup(overrides: Partial<Parameters<typeof magicLinkAuth>[0]> = {}) {
    const sent: MagicLinkEmail[] = [];
    const auth = magicLinkAuth({
      mailer: { send: async (m) => void sent.push(m) },
      sessionSecret: SECRET,
      baseUrl: "https://ak.example.com/auth",
      allowedOrigins: ["https://*.acme.com"],
      allowedDomains: ["acme.com"],
      usedTokens: createSqliteUsedTokenStore(openDatabase(":memory:")),
      ...overrides,
    });
    const ask = (body: unknown) =>
      auth.handler(
        new Request("https://ak.example.com/auth/magic-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    return { auth, sent, ask };
  }

  it("emails a one-time link that redirects with a verifiable session", async () => {
    const { auth, sent, ask } = setup();
    const res = await ask({
      email: " Dana@Acme.com ",
      returnTo: "https://staging.acme.com/checkout",
    });
    expect(res.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "dana@acme.com", origin: "https://staging.acme.com" });

    const link = sent[0]?.url as string;
    expect(link.startsWith("https://ak.example.com/auth/magic-link/verify?token=")).toBe(true);
    const done = await auth.handler(new Request(link));
    expect(done.status).toBe(303);
    const location = new URL(done.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe("https://staging.acme.com/checkout");
    const session = location.hash.replace("#annotatekit_session=", "");

    const principal = await auth.verifier.verify(bearer(session));
    expect(principal?.actor).toMatchObject({
      kind: "human",
      id: "email|dana@acme.com",
      email: "dana@acme.com",
      emailVerified: true,
      provider: "magic-link",
    });

    const again = await auth.handler(new Request(link));
    expect(again.status).toBe(400);
    expect(await again.text()).toMatch(/already used/);
  });

  it("stays quiet about disallowed domains and refuses unknown sites and bad input", async () => {
    const { sent, ask, auth } = setup();
    expect(
      (await ask({ email: "eve@evil.com", returnTo: "https://staging.acme.com/" })).status,
    ).toBe(202);
    expect(sent).toHaveLength(0);
    expect((await ask({ email: "dana@acme.com", returnTo: "https://evil.com/" })).status).toBe(403);
    expect((await ask({ email: "nope", returnTo: "https://staging.acme.com/" })).status).toBe(400);
    expect(
      (await auth.handler(new Request("https://ak.example.com/auth/magic-link/verify?token=junk")))
        .status,
    ).toBe(400);
  });

  it("expires links", async () => {
    let t = Date.parse("2026-11-15T12:00:00Z");
    const { auth, sent, ask } = setup({ now: () => t });
    await ask({ email: "dana@acme.com", returnTo: "https://staging.acme.com/" });
    t += 16 * 60 * 1000;
    expect((await auth.handler(new Request(sent[0]?.url as string))).status).toBe(400);
  });
});
