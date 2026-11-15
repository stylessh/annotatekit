import {
  base64UrlDecode,
  base64UrlEncode,
  randomBase62,
  randomBytes,
  timingSafeEqual,
  utf8,
} from "./encoding.js";
import { actorFromClaims, DEFAULT_AUDIENCE } from "./host.js";
import { bearerToken, signToken, verifyToken } from "./jwt.js";
import type { Verifier } from "./verifier.js";

const PROVIDER = "shared-password";
const DEFAULT_ITERATIONS = 210_000;

/**
 * Hashes a shared password for storing in config, as
 * `pbkdf2-sha256$<iterations>$<salt>$<hash>`.
 */
export async function hashSharedPassword(
  password: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, iterations);
  return ["pbkdf2-sha256", String(iterations), base64UrlEncode(salt), hash].join("$");
}

/** Checks a password against a hash from {@link hashSharedPassword}. */
export async function checkSharedPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterations || !salt || !hash) return false;
  const count = Number(iterations);
  if (!Number.isInteger(count) || count < 1) return false;
  return timingSafeEqual(await pbkdf2(password, base64UrlDecode(salt), count), hash);
}

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return base64UrlEncode(new Uint8Array(bits));
}

export interface SharedPasswordOptions {
  /** Output of {@link hashSharedPassword}. */
  passwordHash: string;
  /** Secret used to sign guest session tokens, at least 32 bytes. */
  sessionSecret: string;
  /** Names this deployment in session tokens. Defaults to `annotatekit`. */
  issuer?: string;
  /** Guest session lifetime in seconds. Defaults to 7 days. */
  ttlSeconds?: number;
  now?: () => number;
}

export interface SharedPasswordAuth {
  /**
   * Exchanges the password and a self-entered display name for a guest
   * session token. Returns `null` when the password is wrong.
   */
  signIn(password: string, name: string): Promise<string | null>;
  verifier: Verifier;
}

/**
 * One password for a whole staging site. Every guest is a separate actor with
 * the name they typed, `provider: "shared-password"` and the `guest` group.
 * Role mappers cap these actors at `commenter` by default.
 */
export function sharedPasswordAuth(options: SharedPasswordOptions): SharedPasswordAuth {
  const issuer = options.issuer ?? DEFAULT_AUDIENCE;
  const ttlSeconds = options.ttlSeconds ?? 7 * 24 * 3600;
  const now = options.now ? { now: options.now } : {};
  return {
    async signIn(password, name) {
      if (!(await checkSharedPassword(password, options.passwordHash))) return null;
      const displayName = name.trim().slice(0, 80) || "Guest";
      return signToken(
        {
          iss: issuer,
          aud: DEFAULT_AUDIENCE,
          sub: `guest_${randomBase62(16)}`,
          name: displayName,
          provider: PROVIDER,
          groups: ["guest"],
        },
        { secret: options.sessionSecret, ttlSeconds, ...now },
      );
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
        if (!claims || claims.provider !== PROVIDER) return null;
        return { actor: actorFromClaims(claims, PROVIDER), expiresAt: claims.exp * 1000 };
      },
    },
  };
}
