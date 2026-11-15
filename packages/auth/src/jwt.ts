import { base64UrlDecode, base64UrlEncode, fromUtf8, randomBase62, utf8 } from "./encoding.js";

/** The registered and AnnotateKit claims this package reads and writes. */
export interface TokenClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  jti?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  groups?: string[];
  /** How the subject signed in, such as `host` or `shared-password`. */
  provider?: string;
  [claim: string]: unknown;
}

export interface SignOptions {
  /** Shared HMAC secret, at least 32 bytes. */
  secret: string;
  /** Lifetime in seconds. */
  ttlSeconds: number;
  now?: () => number;
}

export interface VerifyOptions {
  secret: string;
  /** Accepted issuers. */
  issuers: readonly string[];
  audience: string;
  /** Reject tokens whose lifetime (`exp - iat`) exceeds this many seconds. */
  maxTtlSeconds?: number;
  /** Allowed clock skew in seconds. Defaults to 30. */
  clockSkewSeconds?: number;
  now?: () => number;
}

const HEADER = base64UrlEncode(utf8(JSON.stringify({ alg: "HS256", typ: "JWT" })));
const MIN_SECRET_BYTES = 32;

/** Signs an HS256 JWT. `iat`, `exp` and a random `jti` are filled in. */
export async function signToken(
  claims: Omit<TokenClaims, "iat" | "exp">,
  options: SignOptions,
): Promise<string> {
  const iat = Math.floor((options.now ?? Date.now)() / 1000);
  const payload: TokenClaims = {
    jti: randomBase62(16),
    ...claims,
    iat,
    exp: iat + options.ttlSeconds,
  };
  const body = `${HEADER}.${base64UrlEncode(utf8(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(options.secret), utf8(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies an HS256 JWT and its `iss`, `aud`, `sub`, `exp` and `iat`.
 * Returns `null` when anything is off.
 */
export async function verifyToken(
  token: string,
  options: VerifyOptions,
): Promise<TokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  let claims: TokenClaims;
  try {
    const parsedHeader = JSON.parse(fromUtf8(base64UrlDecode(header))) as { alg?: unknown };
    if (parsedHeader.alg !== "HS256") return null;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(options.secret),
      base64UrlDecode(signature),
      utf8(`${header}.${body}`),
    );
    if (!valid) return null;
    claims = JSON.parse(fromUtf8(base64UrlDecode(body))) as TokenClaims;
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const now = Math.floor((options.now ?? Date.now)() / 1000);
  const skew = options.clockSkewSeconds ?? 30;
  if (typeof claims.exp !== "number" || typeof claims.iat !== "number") return null;
  if (claims.exp + skew < now || claims.iat - skew > now) return null;
  if (options.maxTtlSeconds !== undefined && claims.exp - claims.iat > options.maxTtlSeconds) {
    return null;
  }
  if (typeof claims.iss !== "string" || !options.issuers.includes(claims.iss)) return null;
  if (claims.aud !== options.audience) return null;
  if (typeof claims.sub !== "string" || claims.sub === "") return null;
  return claims;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const bytes = utf8(secret);
  if (bytes.length < MIN_SECRET_BYTES) {
    throw new Error(`AnnotateKit token secret must be at least ${MIN_SECRET_BYTES} bytes`);
  }
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Reads `Authorization: Bearer <token>` from a request. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}
