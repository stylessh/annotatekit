import type { Actor, Authorizer } from "@annotatekit/core";

/**
 * Who is calling, per request. This is the server-side twin of core's
 * `AuthAdapter`: wrap a session cookie, OIDC token or API key check behind it.
 */
export interface ServerAuth {
  /** The actor behind this request, or `null` when anonymous. */
  authenticate(request: Request): Promise<Actor | null> | Actor | null;
  /** Permission check passed to the service. Without it, any actor may do anything. */
  authorize?: Authorizer;
}

/** The header the dev auth and `@annotatekit/client` use to name the actor. */
export const ACTOR_HEADER = "x-annotatekit-actor";

/** Every request acts as the same actor. For single-user local setups and tests. */
export function createStaticServerAuth(actor: Actor | null): ServerAuth {
  return { authenticate: () => actor };
}

export interface TokenAuthOptions {
  /** Map of bearer token to the actor it identifies. */
  tokens: Record<string, Actor>;
  /** Actor for requests without a token. Defaults to `null` (anonymous). */
  anonymous?: Actor | null;
  authorize?: Authorizer;
}

/** Bearer tokens mapped to actors, e.g. API keys for CI agents. */
export function createTokenAuth(options: TokenAuthOptions): ServerAuth {
  const auth: ServerAuth = {
    authenticate(request) {
      const token = bearerToken(request);
      if (token === null) return options.anonymous ?? null;
      return Object.hasOwn(options.tokens, token) ? (options.tokens[token] ?? null) : null;
    },
  };
  if (options.authorize) auth.authorize = options.authorize;
  return auth;
}

/**
 * Trusts the actor JSON a client sends in the `x-annotatekit-actor` header.
 * **Local development only**: anyone can claim to be anyone.
 */
export function createDevAuth(options: { fallback?: Actor | null } = {}): ServerAuth {
  return {
    authenticate(request) {
      const raw = request.headers.get(ACTOR_HEADER);
      if (!raw) return options.fallback ?? null;
      return parseActor(raw);
    },
  };
}

/** Try each auth in order and use the first that finds an actor. */
export function composeServerAuth(...auths: ServerAuth[]): ServerAuth {
  const authorizers = auths.flatMap((a) => (a.authorize ? [a.authorize] : []));
  const auth: ServerAuth = {
    async authenticate(request) {
      for (const candidate of auths) {
        const actor = await candidate.authenticate(request);
        if (actor) return actor;
      }
      return null;
    },
  };
  if (authorizers.length > 0) {
    auth.authorize = async (req) => {
      for (const authorize of authorizers) if (!(await authorize(req))) return false;
      return true;
    };
  }
  return auth;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function parseActor(raw: string): Actor | null {
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if ((v.kind !== "human" && v.kind !== "agent") || typeof v.id !== "string" || !v.id) return null;
  if (typeof v.name !== "string" || !v.name) return null;
  if (v.kind === "human") {
    const actor: Actor = { kind: "human", id: v.id, name: v.name };
    if (typeof v.email === "string") actor.email = v.email;
    if (typeof v.avatarUrl === "string") actor.avatarUrl = v.avatarUrl;
    return actor;
  }
  const actor: Actor = { kind: "agent", id: v.id, name: v.name };
  if (typeof v.model === "string") actor.model = v.model;
  if (typeof v.onBehalfOf === "string") actor.onBehalfOf = v.onBehalfOf;
  return actor;
}
