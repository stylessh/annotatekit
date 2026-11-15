import { beforeAll, describe, expect, it } from "vitest";
import { createStandaloneAuth, entra, google, oidc, okta } from "../src/index.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";
const ISSUER = "https://idp.example.com";
const CLIENT = "client-123";

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A tiny in-memory IdP: discovery, JWKS and a token endpoint that mints RS256 ID tokens. */
class FakeIdp {
  keys!: CryptoKeyPair;
  publicJwk!: JsonWebKey;
  /** Code → claims to put in the ID token. */
  codes = new Map<string, Record<string, unknown>>();
  lastTokenRequest: URLSearchParams | undefined;
  issuer = ISSUER;

  async init() {
    this.keys = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    this.publicJwk = await crypto.subtle.exportKey("jwk", this.keys.publicKey);
  }

  async sign(claims: Record<string, unknown>, kid = "k1"): Promise<string> {
    const head = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
    const body = b64url(JSON.stringify(claims));
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      this.keys.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: this.issuer,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (input === `${ISSUER}/jwks`) {
      return Response.json({ keys: [{ ...this.publicJwk, kid: "k1", alg: "RS256" }] });
    }
    if (input === `${ISSUER}/token`) {
      const form = new URLSearchParams(String(init?.body));
      this.lastTokenRequest = form;
      const claims = this.codes.get(form.get("code") ?? "");
      if (!claims) return new Response("bad code", { status: 400 });
      return Response.json({ id_token: await this.sign(claims) });
    }
    return new Response("not found", { status: 404 });
  };
}

const idp = new FakeIdp();
beforeAll(() => idp.init());

function provider() {
  return oidc({
    id: "acme",
    issuer: ISSUER,
    clientId: CLIENT,
    clientSecret: "shh",
    fetch: idp.fetch,
  });
}

const now = () => Math.floor(Date.now() / 1000);

describe("oidc provider", () => {
  it("builds a PKCE authorization URL from discovery", async () => {
    const url = new URL(
      await provider().authorizationUrl({
        redirectUri: "https://ak.example.com/auth/acme/callback",
        state: "s",
        nonce: "n",
        codeChallenge: "c",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: CLIENT,
      scope: "openid email profile",
      state: "s",
      nonce: "n",
      code_challenge: "c",
      code_challenge_method: "S256",
    });
  });

  it("verifies the ID token and maps it to an actor", async () => {
    idp.codes.set("good", {
      iss: ISSUER,
      aud: CLIENT,
      sub: "00u1",
      exp: now() + 300,
      iat: now(),
      nonce: "n1",
      email: "alan@acme.com",
      email_verified: true,
      name: "Alan",
      groups: ["Eng"],
    });
    const actor = await provider().exchange({
      code: "good",
      redirectUri: "https://x/cb",
      codeVerifier: "v",
      nonce: "n1",
    });
    expect(actor).toEqual({
      kind: "human",
      id: "acme|00u1",
      name: "Alan",
      provider: "oidc:acme",
      email: "alan@acme.com",
      emailVerified: true,
      groups: ["Eng"],
    });
    expect(idp.lastTokenRequest?.get("code_verifier")).toBe("v");
  });

  it("refuses wrong nonce, audience, issuer, expiry and forged signatures", async () => {
    const base = { iss: ISSUER, aud: CLIENT, sub: "u", exp: now() + 300, iat: now(), nonce: "n" };
    const cases: Record<string, Record<string, unknown>> = {
      nonce: { ...base, nonce: "other" },
      aud: { ...base, aud: "someone-else" },
      iss: { ...base, iss: "https://evil.example.com" },
      exp: { ...base, exp: now() - 3600 },
    };
    for (const [code, claims] of Object.entries(cases)) {
      idp.codes.set(code, claims);
      await expect(
        provider().exchange({ code, redirectUri: "r", codeVerifier: "v", nonce: "n" }),
      ).rejects.toThrow();
    }
    // A token signed by a different key with the same kid.
    const realSign = idp.sign.bind(idp);
    const other = new FakeIdp();
    await other.init();
    idp.sign = (claims) => other.sign(claims);
    idp.codes.set("forged", base);
    await expect(
      provider().exchange({ code: "forged", redirectUri: "r", codeVerifier: "v", nonce: "n" }),
    ).rejects.toThrow(/signature/);
    idp.sign = realSign;
  });

  it("presets fill in issuers", async () => {
    expect(okta({ domain: "acme.okta.com", clientId: "a", clientSecret: "b" }).id).toBe("okta");
    expect(entra({ tenantId: "t", clientId: "a", clientSecret: "b" }).id).toBe("entra");
    const g = google({
      hostedDomain: "acme.com",
      clientId: "a",
      clientSecret: "b",
      fetch: async () =>
        Response.json({
          issuer: "https://accounts.google.com",
          authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        }),
    });
    const url = new URL(
      await g.authorizationUrl({ redirectUri: "r", state: "s", nonce: "n", codeChallenge: "c" }),
    );
    expect(url.searchParams.get("hd")).toBe("acme.com");
  });
});

describe("standalone login", () => {
  const auth = createStandaloneAuth({
    providers: [provider()],
    sessionSecret: SECRET,
    baseUrl: "https://ak.example.com/auth",
    allowedOrigins: ["https://*.acme.com"],
  });

  async function login(origin = "https://staging.acme.com") {
    const res = await auth.handler(
      new Request(`https://ak.example.com/auth/acme/login?origin=${encodeURIComponent(origin)}`),
    );
    return res;
  }

  it("lists providers", async () => {
    const res = await auth.handler(new Request("https://ak.example.com/auth/providers"));
    expect(await res.json()).toEqual({ providers: ["acme"] });
  });

  it("runs the popup flow end to end and issues a verifiable session", async () => {
    const start = await login();
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get("location") as string);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://ak.example.com/auth/acme/callback",
    );
    const cookie = (start.headers.get("set-cookie") as string).split(";")[0] as string;
    expect(start.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax; Secure/);

    idp.codes.set("flow", {
      iss: ISSUER,
      aud: CLIENT,
      sub: "00u9",
      exp: now() + 300,
      iat: now(),
      nonce: authorize.searchParams.get("nonce"),
      email: "dana@acme.com",
      email_verified: true,
      name: "Dana",
    });
    const state = authorize.searchParams.get("state");
    const done = await auth.handler(
      new Request(`https://ak.example.com/auth/acme/callback?code=flow&state=${state}`, {
        headers: { cookie },
      }),
    );
    expect(done.status).toBe(200);
    const html = await done.text();
    expect(html).toContain('"origin":"https://staging.acme.com"');
    const token = /"token":"([^"]+)"/.exec(html)?.[1] as string;
    expect(token).toBeTruthy();

    // PKCE: the verifier sent to the IdP matches the challenge sent to authorize.
    const verifier = idp.lastTokenRequest?.get("code_verifier") as string;
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    expect(b64url(digest)).toBe(authorize.searchParams.get("code_challenge"));

    const principal = await auth.verifier.verify(
      new Request("https://x", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(principal?.actor).toMatchObject({
      id: "acme|00u9",
      email: "dana@acme.com",
      emailVerified: true,
      provider: "oidc:acme",
    });
  });

  it("refuses unknown origins, missing state cookies and mismatched state", async () => {
    expect((await login("https://evil.com")).status).toBe(403);
    const noCookie = await auth.handler(
      new Request("https://ak.example.com/auth/acme/callback?code=x&state=y"),
    );
    expect(noCookie.status).toBe(400);
    const start = await login();
    const cookie = (start.headers.get("set-cookie") as string).split(";")[0] as string;
    const mismatch = await auth.handler(
      new Request("https://ak.example.com/auth/acme/callback?code=x&state=wrong", {
        headers: { cookie },
      }),
    );
    expect(await mismatch.text()).toContain("annotatekit:error");
    expect((await auth.handler(new Request("https://ak.example.com/auth/nope/login"))).status).toBe(
      404,
    );
  });
});
