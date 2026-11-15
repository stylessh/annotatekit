import type { HumanActor } from "@annotatekit/core";
import { actorFromClaims, DEFAULT_AUDIENCE } from "./host.js";
import { bearerToken, signToken, verifyToken } from "./jwt.js";
import { type OidcProvider, pkceChallenge, randomState } from "./oidc.js";
import type { Verifier } from "./verifier.js";

/**
 * A sign-in method the standalone handler can run: OIDC providers from
 * `oidc()`, or others such as SAML from `@annotatekit/auth-saml`.
 */
export interface LoginProvider {
  readonly id: string;
  /** `query` when the IdP redirects back with GET (OIDC), `form_post` when it POSTs (SAML). */
  readonly responseMode?: "query" | "form_post";
  /** The URL to send the browser to. Echo `state` back (as `state` or SAML `RelayState`). */
  begin(params: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string>;
  /** Verifies the IdP's response and returns who signed in. Throws on any failure. */
  complete(params: {
    params: URLSearchParams;
    redirectUri: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<HumanActor>;
}

function toLoginProvider(provider: OidcProvider | LoginProvider): LoginProvider {
  if ("begin" in provider) return provider;
  return {
    id: provider.id,
    responseMode: "query",
    begin: (params) => provider.authorizationUrl(params),
    complete: ({ params, redirectUri, codeVerifier, nonce }) => {
      const code = params.get("code");
      if (!code) throw new Error("No authorization code");
      return provider.exchange({ code, redirectUri, codeVerifier, nonce });
    },
  };
}

export interface StandaloneAuthOptions {
  /** Identity providers people can sign in with, by `provider.id`. */
  providers: (OidcProvider | LoginProvider)[];
  /** Signs AnnotateKit sessions and login state, at least 32 bytes. */
  sessionSecret: string;
  /** Public URL of this handler, e.g. `https://annotatekit.acme.com/auth`. Callbacks go to `<baseUrl>/<id>/callback`. */
  baseUrl: string;
  /**
   * Origins of the sites that embed the widget, `*` wildcards allowed. The
   * session is only handed to a page on one of these.
   */
  allowedOrigins: string[];
  /** Names this deployment in session tokens. Defaults to `annotatekit`. */
  issuer?: string;
  /** Session lifetime in seconds. Defaults to 8 hours. */
  sessionTtlSeconds?: number;
  now?: () => number;
}

export interface StandaloneAuth {
  /**
   * Web-standard handler for the login routes. Mount it at the path of
   * `baseUrl`, e.g. `createAnnotateKitServer({ mount: { "/auth": auth.handler } })`.
   *
   * - `GET /providers`: the provider ids, for the sign-in menu.
   * - `GET /<id>/login?origin=<page origin>`: opens the IdP (in a popup).
   * - `GET` (or `POST` for SAML) `/<id>/callback`: finishes the login and posts the session to the opener.
   */
  handler(request: Request): Promise<Response>;
  /** Verifies the session tokens this handler issues. */
  verifier: Verifier;
}

/** Message the popup posts to `window.opener` after a login. */
export interface StandaloneSessionMessage {
  type: "annotatekit:session";
  token: string;
  expiresAt: number;
}

export interface StandaloneErrorMessage {
  type: "annotatekit:error";
  error: string;
}

const STATE_COOKIE = "annotatekit_oidc";
const STATE_TTL = 600;

/**
 * AnnotateKit's own login for sites whose auth you don't own: OIDC with
 * Authorization Code and PKCE, run by this backend as a confidential client.
 * The IdP's tokens never reach the browser; the widget gets a short AnnotateKit
 * session instead.
 */
export function createStandaloneAuth(options: StandaloneAuthOptions): StandaloneAuth {
  const base = new URL(options.baseUrl.replace(/\/+$/, ""));
  const basePath = base.pathname === "/" ? "" : base.pathname;
  const issuer = options.issuer ?? DEFAULT_AUDIENCE;
  const ttlSeconds = options.sessionTtlSeconds ?? 8 * 3600;
  const now = options.now ? { now: options.now } : {};
  const secure = base.protocol === "https:";
  const providers = new Map(options.providers.map((p) => [p.id, toLoginProvider(p)]));
  const originRes = options.allowedOrigins.map(
    (o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`),
  );
  const originAllowed = (origin: string) => originRes.some((re) => re.test(origin));
  const redirectUri = (id: string) => `${base.origin}${basePath}/${id}/callback`;

  async function login(provider: LoginProvider, url: URL): Promise<Response> {
    const origin = url.searchParams.get("origin") ?? "";
    if (!originAllowed(origin)) return text(403, "This site may not sign in to AnnotateKit");
    const state = randomState();
    const nonce = randomState();
    const verifier = randomState() + randomState();
    const location = await provider.begin({
      redirectUri: redirectUri(provider.id),
      state,
      nonce,
      codeChallenge: await pkceChallenge(verifier),
    });
    const cookie = await signToken(
      {
        iss: issuer,
        aud: `${DEFAULT_AUDIENCE}:login`,
        sub: provider.id,
        state,
        nonce,
        verifier,
        origin,
      },
      { secret: options.sessionSecret, ttlSeconds: STATE_TTL, ...now },
    );
    return new Response(null, {
      status: 302,
      headers: {
        location,
        "set-cookie": stateCookie(cookie, STATE_TTL, provider.responseMode === "form_post"),
        "cache-control": "no-store",
      },
    });
  }

  async function callback(provider: LoginProvider, request: Request, url: URL): Promise<Response> {
    let params = url.searchParams;
    if (request.method === "POST") {
      try {
        params = new URLSearchParams(await request.text());
      } catch {
        return text(400, "Unreadable sign-in response");
      }
    }
    const raw = readCookie(request, STATE_COOKIE);
    const flow = raw
      ? await verifyToken(raw, {
          secret: options.sessionSecret,
          issuers: [issuer],
          audience: `${DEFAULT_AUDIENCE}:login`,
          maxTtlSeconds: STATE_TTL,
          ...now,
        })
      : null;
    const clear = stateCookie("", 0);
    if (!flow || flow.sub !== provider.id || typeof flow.origin !== "string") {
      return text(400, "Login expired or was started elsewhere. Try again.", clear);
    }
    const origin = flow.origin;
    if (!originAllowed(origin)) return text(403, "This site may not sign in to AnnotateKit", clear);
    if (params.get("error")) {
      return popup(
        origin,
        { type: "annotatekit:error", error: "Sign-in was cancelled or refused" },
        clear,
      );
    }
    if ((params.get("state") ?? params.get("RelayState")) !== flow.state) {
      return popup(origin, { type: "annotatekit:error", error: "Login state mismatch" }, clear);
    }
    try {
      const actor = await provider.complete({
        params,
        redirectUri: redirectUri(provider.id),
        codeVerifier: String(flow.verifier),
        nonce: String(flow.nonce),
      });
      const claims: Parameters<typeof signToken>[0] = {
        iss: issuer,
        aud: DEFAULT_AUDIENCE,
        sub: actor.id,
        name: actor.name,
        provider: actor.provider ?? `oidc:${provider.id}`,
      };
      if (actor.email !== undefined) claims.email = actor.email;
      if (actor.emailVerified !== undefined) claims.email_verified = actor.emailVerified;
      if (actor.avatarUrl !== undefined) claims.picture = actor.avatarUrl;
      if (actor.groups !== undefined) claims.groups = actor.groups;
      const token = await signToken(claims, { secret: options.sessionSecret, ttlSeconds, ...now });
      const expiresAt = (options.now ?? Date.now)() + ttlSeconds * 1000;
      return popup(origin, { type: "annotatekit:session", token, expiresAt }, clear);
    } catch {
      return popup(origin, { type: "annotatekit:error", error: "Sign-in failed" }, clear);
    }
  }

  // A SAML IdP POSTs back cross-site, which only carries SameSite=None cookies.
  function stateCookie(value: string, maxAge: number, crossSitePost = false): string {
    const parts = [
      `${STATE_COOKIE}=${value}`,
      `Path=${basePath || "/"}`,
      `Max-Age=${maxAge}`,
      "HttpOnly",
      crossSitePost && secure ? "SameSite=None" : "SameSite=Lax",
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
  }

  return {
    async handler(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(basePath)) return text(404, "Not found");
      const path = url.pathname.slice(basePath.length);
      if (path === "/providers") {
        return Response.json({ providers: [...providers.keys()] });
      }
      const match = /^\/([A-Za-z0-9_-]+)\/(login|callback)$/.exec(path);
      const provider = match ? providers.get(match[1] as string) : undefined;
      if (!match || !provider) return text(404, "Not found");
      if (match[2] === "login") {
        return request.method === "GET" ? login(provider, url) : text(405, "Method not allowed");
      }
      const allowed = provider.responseMode === "form_post" ? "POST" : "GET";
      if (request.method !== allowed) return text(405, "Method not allowed");
      return callback(provider, request, url);
    },
    verifier: {
      async verify(request) {
        const token = bearerToken(request);
        if (!token) return null;
        const claims = await verifyToken(token, {
          secret: options.sessionSecret,
          issuers: [issuer],
          audience: DEFAULT_AUDIENCE,
          maxTtlSeconds: ttlSeconds,
          ...now,
        });
        const provider = claims?.provider;
        if (!claims || typeof provider !== "string" || !/^(oidc|saml):/.test(provider)) return null;
        return { actor: actorFromClaims(claims, provider), expiresAt: claims.exp * 1000 };
      },
    },
  };
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

function text(status: number, body: string, cookie?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(body, { status, headers });
}

/** A page that hands the result to the opener, only at `origin`, then closes. */
function popup(
  origin: string,
  message: StandaloneSessionMessage | StandaloneErrorMessage,
  cookie: string,
): Response {
  const data = JSON.stringify({ origin, message }).replace(/</g, "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><title>AnnotateKit</title><p>You can close this window.</p><script>(function(){var d=${data};if(window.opener){window.opener.postMessage(d.message,d.origin);}window.close();})();</script>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'",
      "referrer-policy": "no-referrer",
      "set-cookie": cookie,
    },
  });
}
