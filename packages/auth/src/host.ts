import type { HumanActor } from "@annotatekit/core";
import { bearerToken, signToken, type TokenClaims, type TokenInput, verifyToken } from "./jwt.js";
import type { Verifier } from "./verifier.js";

export const DEFAULT_AUDIENCE = "annotatekit";

export interface MintHostTokenOptions {
  /** HMAC secret shared with the AnnotateKit server, at least 32 bytes. */
  secret: string;
  /** Names your app, checked by the verifier. */
  issuer: string;
  /** Lifetime in seconds. Defaults to 300 (5 minutes). */
  ttlSeconds?: number;
  audience?: string;
  now?: () => number;
}

/**
 * Mints a short-lived token for the user signed in to your app. Call it from
 * your backend (for example `GET /api/annotatekit-token`) and hand the token
 * to the widget, which sends it as a bearer on every storage call.
 */
export function mintHostToken(
  user: Pick<HumanActor, "id" | "name"> & Partial<HumanActor>,
  options: MintHostTokenOptions,
): Promise<string> {
  const claims: TokenInput = {
    iss: options.issuer,
    aud: options.audience ?? DEFAULT_AUDIENCE,
    sub: user.id,
    name: user.name,
    provider: "host",
  };
  if (user.email !== undefined) claims.email = user.email;
  if (user.emailVerified !== undefined) claims.email_verified = user.emailVerified;
  if (user.avatarUrl !== undefined) claims.picture = user.avatarUrl;
  if (user.groups !== undefined) claims.groups = user.groups;
  return signToken(claims, {
    secret: options.secret,
    ttlSeconds: options.ttlSeconds ?? 300,
    ...(options.now ? { now: options.now } : {}),
  });
}

export interface HostJwtVerifierOptions {
  secret: string;
  /** Accepted issuers: one per app that mints tokens. */
  issuer: string | string[];
  audience?: string;
  /** Tokens living longer than this are refused. Defaults to 3600 (1 hour). */
  maxTtlSeconds?: number;
  now?: () => number;
}

/** Verifies tokens minted by {@link mintHostToken}. */
export function hostJwtVerifier(options: HostJwtVerifierOptions): Verifier {
  const issuers = Array.isArray(options.issuer) ? options.issuer : [options.issuer];
  return {
    async verify(request) {
      const token = bearerToken(request);
      if (!token) return null;
      const claims = await verifyToken(token, {
        secret: options.secret,
        issuers,
        audience: options.audience ?? DEFAULT_AUDIENCE,
        maxTtlSeconds: options.maxTtlSeconds ?? 3600,
        ...(options.now ? { now: options.now } : {}),
      });
      if (claims?.provider !== "host") return null;
      return { actor: actorFromClaims(claims, "host"), expiresAt: claims.exp * 1000 };
    },
  };
}

export interface HostSessionOptions {
  /**
   * Look up the signed-in user with your app's own session (a cookie, a
   * header) and map it to an actor, or return `null`.
   */
  verify(request: Request): Promise<HumanActor | null> | HumanActor | null;
}

/** For storage that runs inside your app's own server: reuse its session lookup. */
export function hostSessionVerifier(options: HostSessionOptions): Verifier {
  return {
    async verify(request) {
      const actor = await options.verify(request);
      if (!actor) return null;
      return { actor: { provider: "host", ...actor, kind: "human" } };
    },
  };
}

export function actorFromClaims(claims: TokenClaims, fallbackProvider: string): HumanActor {
  const actor: HumanActor = {
    kind: "human",
    id: claims.sub,
    name: typeof claims.name === "string" && claims.name ? claims.name : claims.sub,
    provider: typeof claims.provider === "string" ? claims.provider : fallbackProvider,
  };
  if (typeof claims.email === "string") actor.email = claims.email;
  if (typeof claims.email_verified === "boolean") actor.emailVerified = claims.email_verified;
  if (typeof claims.picture === "string") actor.avatarUrl = claims.picture;
  if (Array.isArray(claims.groups)) {
    actor.groups = claims.groups.filter((g): g is string => typeof g === "string");
  }
  return actor;
}
