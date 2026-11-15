import type { Actor } from "../models.js";
import type { AuthAction, AuthorizationRequest } from "./auth.js";

/**
 * Coarse permissions shared by human roles and agent API keys. The names match
 * the MCP server's scopes, so both are checked against the same strings.
 */
export type AuthScope =
  | "annotations:read"
  | "annotations:write"
  | "annotations:resolve"
  | "annotations:moderate"
  | "project:admin";

export const AUTH_SCOPES: readonly AuthScope[] = [
  "annotations:read",
  "annotations:write",
  "annotations:resolve",
  "annotations:moderate",
  "project:admin",
];

/** Built-in roles, from least to most privileged. */
export type Role = "viewer" | "commenter" | "resolver" | "admin";

export const ROLES: readonly Role[] = ["viewer", "commenter", "resolver", "admin"];

export const ROLE_SCOPES: Readonly<Record<Role, readonly AuthScope[]>> = {
  viewer: ["annotations:read"],
  commenter: ["annotations:read", "annotations:write"],
  resolver: ["annotations:read", "annotations:write", "annotations:resolve"],
  admin: AUTH_SCOPES,
};

/** The actions each scope grants on anything, regardless of who authored it. */
const SCOPE_ACTIONS: Readonly<Record<AuthScope, readonly AuthAction[]>> = {
  "annotations:read": ["thread:read"],
  "annotations:write": ["thread:create", "comment:create"],
  "annotations:resolve": ["thread:resolve", "thread:update"],
  "annotations:moderate": ["thread:update", "thread:delete", "comment:update", "comment:delete"],
  "project:admin": ["group:manage", "audit:read"],
};

/** Actions `annotations:write` grants only on threads or comments the actor authored. */
const OWN_ACTIONS: readonly AuthAction[] = [
  "thread:update",
  "thread:resolve",
  "thread:delete",
  "comment:update",
  "comment:delete",
];

export function isAuthScope(value: string): value is AuthScope {
  return (AUTH_SCOPES as readonly string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** All scopes granted by a set of roles. */
export function scopesForRoles(roles: Iterable<Role>): AuthScope[] {
  const out = new Set<AuthScope>();
  for (const role of roles) for (const scope of ROLE_SCOPES[role]) out.add(scope);
  return AUTH_SCOPES.filter((scope) => out.has(scope));
}

/** The most privileged role in a list, or `undefined` when it is empty. */
export function highestRole(roles: Iterable<Role>): Role | undefined {
  let best = -1;
  for (const role of roles) best = Math.max(best, ROLES.indexOf(role));
  return best >= 0 ? ROLES[best] : undefined;
}

/**
 * Whether `scopes` permit the request. `annotations:write` also lets an actor
 * edit, resolve and delete what they authored themselves.
 */
export function scopesAllow(scopes: Iterable<AuthScope>, request: AuthorizationRequest): boolean {
  const set = new Set(scopes);
  for (const scope of set) {
    if (SCOPE_ACTIONS[scope].includes(request.action)) return true;
  }
  if (set.has("annotations:write") && OWN_ACTIONS.includes(request.action)) {
    return ownsTarget(request);
  }
  return false;
}

function ownsTarget({ actor, action, thread, comment }: AuthorizationRequest): boolean {
  if (!actor) return false;
  if (action.startsWith("comment:")) return comment ? sameActor(comment.author, actor) : false;
  return thread ? sameActor(thread.createdBy, actor) : false;
}

function sameActor(a: Actor, b: Actor): boolean {
  return a.kind === b.kind && a.id === b.id;
}
