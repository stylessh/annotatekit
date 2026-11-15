import {
  type Actor,
  type AuthAction,
  type AuthorizationRequest,
  type AuthScope,
  type Comment,
  type Group,
  scopesAllow,
  scopesForRoles,
  type Thread,
  type WhitelistAdapter,
} from "@annotatekit/core";
import type { RoleMapper } from "./roles.js";
import type { Verifier } from "./verifier.js";

export interface RequestGuardOptions {
  /** How to establish who sent the request. Combine several with `anyVerifier`. */
  verifier: Verifier;
  /** Whether AnnotateKit may run for this page and actor. */
  whitelist: WhitelistAdapter;
  /** Roles for human actors. Agents use the scopes on their credential. */
  roles: RoleMapper;
}

export interface GuardCheck {
  action: AuthAction;
  /**
   * The page the request was made from. Defaults to the request's `Origin`
   * (or `Referer`). Must share its origin with `Origin` when both are present.
   */
  pageUrl?: string;
  environment?: string;
  thread?: Thread;
  comment?: Comment;
  group?: Group;
}

export type GuardResult =
  | { ok: true; actor: Actor | null; scopes: AuthScope[]; readOnly: boolean }
  | { ok: false; status: 400 | 401 | 403; code: GuardFailure; reason: string; signIn?: boolean };

export type GuardFailure =
  | "bad_origin"
  | "missing_page"
  | "unauthenticated"
  | "not_whitelisted"
  | "read_only"
  | "forbidden";

export interface RequestGuard {
  /** Step 2 alone: who sent this request, or `null`. */
  authenticate(request: Request): Promise<{ actor: Actor; scopes: AuthScope[] } | null>;
  /** All four checks, in order: origin, credential, whitelist, permission. */
  check(request: Request, check: GuardCheck): Promise<GuardResult>;
}

/**
 * The server-side gate every storage call goes through. The browser runs the
 * same whitelist and permission checks for UX only; this is the one that counts.
 */
export function createRequestGuard(options: RequestGuardOptions): RequestGuard {
  async function authenticate(request: Request) {
    const principal = await options.verifier.verify(request);
    if (!principal) return null;
    const scopes =
      principal.scopes ??
      (principal.actor.kind === "human"
        ? scopesForRoles(await options.roles(principal.actor))
        : []);
    return { actor: principal.actor, scopes };
  }

  return {
    authenticate,
    async check(request, check) {
      // 1. Origin
      const origin = request.headers.get("origin");
      const pageUrl = check.pageUrl ?? origin ?? request.headers.get("referer") ?? undefined;
      if (origin && pageUrl && originOf(pageUrl) !== origin) {
        return fail(403, "bad_origin", `Origin ${origin} does not match the page`);
      }

      // 2. Credential
      const principal = await authenticate(request);
      const actor = principal?.actor ?? null;
      const scopes = principal?.scopes ?? [];

      // 3. Whitelist. Agents calling without a page (MCP over HTTP) skip page rules.
      let readOnly = false;
      if (pageUrl) {
        const context = { url: pageUrl, actor, ...envOf(check.environment) };
        const decision = await options.whitelist.check(context);
        if (!decision.allowed) {
          if (!actor && decision.signIn) {
            return fail(401, "unauthenticated", decision.reason ?? "Sign-in required", true);
          }
          return fail(403, "not_whitelisted", decision.reason ?? "Not whitelisted");
        }
        readOnly = decision.readOnly === true;
      } else if (actor?.kind !== "agent") {
        return fail(400, "missing_page", "Requests from people must name the page they came from");
      }

      // 4. Permission. Anonymous visitors only ever read, and only where a rule let them in.
      if (!actor) {
        if (check.action === "thread:read" && pageUrl) {
          return { ok: true, actor, scopes: ["annotations:read"], readOnly: true };
        }
        return fail(401, "unauthenticated", "Sign-in required", true);
      }
      if (readOnly && check.action !== "thread:read") {
        return fail(403, "read_only", "AnnotateKit is read-only here");
      }
      const request_: AuthorizationRequest = { actor, action: check.action };
      if (check.thread) request_.thread = check.thread;
      if (check.comment) request_.comment = check.comment;
      if (check.group) request_.group = check.group;
      if (!scopesAllow(scopes, request_)) {
        return fail(403, "forbidden", `Not allowed to ${check.action}`);
      }
      return { ok: true, actor, scopes, readOnly };
    },
  };
}

function fail(
  status: 400 | 401 | 403,
  code: GuardFailure,
  reason: string,
  signIn?: boolean,
): GuardResult {
  return signIn ? { ok: false, status, code, reason, signIn } : { ok: false, status, code, reason };
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function envOf(environment: string | undefined): { environment?: string } {
  return environment === undefined ? {} : { environment };
}
