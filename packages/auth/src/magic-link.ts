import type { AuditLog } from "@annotatekit/core";
import { recordAudit } from "./audit.js";
import { actorFromClaims, DEFAULT_AUDIENCE } from "./host.js";
import { bearerToken, signToken, verifyToken } from "./jwt.js";
import type { Verifier } from "./verifier.js";

/** Sends the sign-in email. Wrap Resend, Postmark, SES, nodemailer or anything else. */
export interface Mailer {
  send(message: MagicLinkEmail): Promise<void>;
}

export interface MagicLinkEmail {
  to: string;
  /** The link to put in the email. */
  url: string;
  /** Epoch milliseconds after which the link stops working. */
  expiresAt: number;
  /** The site the person asked from, for the email copy. */
  origin: string;
}

/** Prints links instead of sending email. For local development only. */
export function consoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async send({ to, url }) {
      log(`[annotatekit] sign-in link for ${to}: ${url}`);
    },
  };
}

/** Remembers which one-time tokens were used. */
export interface UsedTokenStore {
  /** Marks `id` used. Returns `false` when it already was. */
  claim(id: string, expiresAt: number, now: number): Promise<boolean>;
}

export function createMemoryUsedTokenStore(): UsedTokenStore {
  const used = new Map<string, number>();
  return {
    async claim(id, expiresAt, now) {
      for (const [key, exp] of used) if (exp < now) used.delete(key);
      if (used.has(id)) return false;
      used.set(id, expiresAt);
      return true;
    },
  };
}

export interface MagicLinkOptions {
  mailer: Mailer;
  /** Signs links and sessions, at least 32 bytes. */
  sessionSecret: string;
  /** Public URL where `handler` is mounted, e.g. `https://annotatekit.acme.com/auth`. */
  baseUrl: string;
  /** Sites that may ask for a link and receive the session, `*` wildcards allowed. */
  allowedOrigins: string[];
  /**
   * Email domains that may sign in, e.g. `["acme.com", "agency.io"]`. Leave out
   * to allow any address, then restrict with whitelist rules.
   */
  allowedDomains?: string[];
  /** Where used links are remembered. Defaults to memory; use SQLite when running several instances. */
  usedTokens?: UsedTokenStore;
  /** Link lifetime in seconds. Defaults to 900 (15 minutes). */
  linkTtlSeconds?: number;
  /** Session lifetime in seconds. Defaults to 8 hours. */
  sessionTtlSeconds?: number;
  issuer?: string;
  /** Records links sent (`magic-link:send`) and sessions issued or refused (`session:issue`). */
  audit?: AuditLog;
  now?: () => number;
}

export interface MagicLinkAuth {
  /**
   * Web-standard handler:
   *
   * - `POST /magic-link` with `{ email, returnTo }`: emails a one-time link.
   *   Always answers 202, so it doesn't reveal which addresses may sign in.
   * - `GET /magic-link/verify?token=…`: redirects to `returnTo` with
   *   `#annotatekit_session=<token>`, which the widget reads and clears.
   */
  handler(request: Request): Promise<Response>;
  verifier: Verifier;
}

const PROVIDER = "magic-link";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Passwordless sign-in by emailed link, for small teams and clients without an IdP. */
export function magicLinkAuth(options: MagicLinkOptions): MagicLinkAuth {
  const base = new URL(options.baseUrl.replace(/\/+$/, ""));
  const basePath = base.pathname === "/" ? "" : base.pathname;
  const issuer = options.issuer ?? DEFAULT_AUDIENCE;
  const linkTtl = options.linkTtlSeconds ?? 900;
  const sessionTtl = options.sessionTtlSeconds ?? 8 * 3600;
  const clock = options.now ?? Date.now;
  const now = options.now ? { now: options.now } : {};
  const used = options.usedTokens ?? createMemoryUsedTokenStore();
  const domains = options.allowedDomains?.map((d) => d.toLowerCase().replace(/^@/, ""));
  const originRes = options.allowedOrigins.map(
    (o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`),
  );
  const originAllowed = (origin: string) => originRes.some((re) => re.test(origin));
  const linkAudience = `${DEFAULT_AUDIENCE}:magic-link`;

  async function start(request: Request): Promise<Response> {
    let body: { email?: unknown; returnTo?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return text(400, "Expected JSON");
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const returnTo = typeof body.returnTo === "string" ? safeUrl(body.returnTo) : null;
    if (!EMAIL.test(email) || email.length > 254) return text(400, "Enter a valid email");
    if (!returnTo || !originAllowed(returnTo.origin)) {
      return text(403, "This site may not sign in to AnnotateKit");
    }
    const domain = email.split("@").pop() ?? "";
    if (domains && !domains.includes(domain)) {
      await recordAudit(options.audit, {
        actor: null,
        action: "magic-link:send",
        decision: "deny",
        reason: `Email domain ${domain} may not sign in`,
        origin: returnTo.origin,
      });
      return accepted();
    }

    const token = await signToken(
      { iss: issuer, aud: linkAudience, sub: email, returnTo: returnTo.toString() },
      { secret: options.sessionSecret, ttlSeconds: linkTtl, ...now },
    );
    const url = `${base.origin}${basePath}/magic-link/verify?token=${encodeURIComponent(token)}`;
    await options.mailer.send({
      to: email,
      url,
      expiresAt: clock() + linkTtl * 1000,
      origin: returnTo.origin,
    });
    await recordAudit(options.audit, {
      actor: null,
      action: "magic-link:send",
      decision: "allow",
      origin: returnTo.origin,
      details: { domain },
    });
    return accepted();
  }

  async function verify(url: URL): Promise<Response> {
    const claims = await verifyToken(url.searchParams.get("token") ?? "", {
      secret: options.sessionSecret,
      issuers: [issuer],
      audience: linkAudience,
      maxTtlSeconds: linkTtl,
      ...now,
    });
    const returnTo = typeof claims?.returnTo === "string" ? safeUrl(claims.returnTo) : null;
    if (!claims?.jti || !returnTo || !originAllowed(returnTo.origin)) {
      return text(400, "This link is invalid or has expired. Ask for a new one.");
    }
    if (!(await used.claim(claims.jti, claims.exp * 1000, clock()))) {
      await recordAudit(options.audit, {
        actor: null,
        action: "session:issue",
        decision: "deny",
        reason: "Link already used",
        origin: returnTo.origin,
        details: { provider: PROVIDER },
      });
      return text(400, "This link was already used. Ask for a new one.");
    }
    const email = claims.sub;
    const session = await signToken(
      {
        iss: issuer,
        aud: DEFAULT_AUDIENCE,
        sub: `email|${email}`,
        name: email.split("@")[0] ?? email,
        email,
        email_verified: true,
        provider: PROVIDER,
      },
      { secret: options.sessionSecret, ttlSeconds: sessionTtl, ...now },
    );
    await recordAudit(options.audit, {
      actor: {
        kind: "human",
        id: `email|${email}`,
        name: email.split("@")[0] ?? email,
        provider: PROVIDER,
      },
      action: "session:issue",
      decision: "allow",
      origin: returnTo.origin,
      details: { provider: PROVIDER },
    });
    returnTo.hash = `annotatekit_session=${session}`;
    return new Response(null, {
      status: 303,
      headers: {
        location: returnTo.toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  return {
    async handler(request) {
      const url = new URL(request.url);
      const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : "";
      if (path === "/magic-link" && request.method === "POST") return start(request);
      if (path === "/magic-link/verify" && request.method === "GET") return verify(url);
      return text(404, "Not found");
    },
    verifier: {
      async verify(request) {
        const token = bearerToken(request);
        if (!token) return null;
        const claims = await verifyToken(token, {
          secret: options.sessionSecret,
          issuers: [issuer],
          audience: DEFAULT_AUDIENCE,
          maxTtlSeconds: sessionTtl,
          ...now,
        });
        if (claims?.provider !== PROVIDER) return null;
        return { actor: actorFromClaims(claims, PROVIDER), expiresAt: claims.exp * 1000 };
      },
    },
  };
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function accepted(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
