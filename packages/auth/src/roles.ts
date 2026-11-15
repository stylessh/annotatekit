import {
  type Actor,
  type AuthAdapter,
  type AuthScope,
  ROLES,
  type Role,
  scopesAllow,
  scopesForRoles,
} from "@annotatekit/core";

/** Works out which roles an actor holds. */
export type RoleMapper = (actor: Actor) => Role[] | Promise<Role[]>;

export interface MapGroupsOptions {
  /** Group names, user ids, or email patterns like `*@acme.com`, per role. */
  admin?: string[];
  resolver?: string[];
  commenter?: string[];
  viewer?: string[];
  /** Role for anyone who matches nothing. Leave out to grant no role. */
  default?: Role;
  /**
   * The highest role each identity provider may reach. Defaults to
   * `{ "shared-password": "commenter" }`, because everyone with the
   * password is effectively the same person.
   */
  maxRoleByProvider?: Record<string, Role>;
}

const DEFAULT_CAPS: Record<string, Role> = { "shared-password": "commenter" };

/**
 * Maps identity-provider groups, host roles, ids or emails to roles. Agents
 * are not mapped: their scopes come from their API key.
 */
export function mapGroups(options: MapGroupsOptions): RoleMapper {
  const caps = options.maxRoleByProvider ?? DEFAULT_CAPS;
  const entries = ROLES.map((role) => [role, (options[role] ?? []).map(compile)] as const);
  return (actor) => {
    if (actor.kind !== "human") return [];
    const matched = entries
      .filter(([, matchers]) => matchers.some((m) => m(actor)))
      .map(([role]) => role);
    if (matched.length === 0 && options.default) matched.push(options.default);
    const cap = actor.provider ? caps[actor.provider] : undefined;
    if (!cap) return matched;
    const max = ROLES.indexOf(cap);
    const capped = matched.filter((role) => ROLES.indexOf(role) <= max);
    return capped.length === matched.length ? capped : [...new Set([...capped, cap])];
  };
}

function compile(pattern: string): (actor: Actor & { kind: "human" }) => boolean {
  if (pattern.includes("@")) {
    const re = new RegExp(
      `^${pattern
        .toLowerCase()
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")}$`,
    );
    return (actor) =>
      actor.emailVerified === true &&
      actor.email !== undefined &&
      re.test(actor.email.toLowerCase());
  }
  return (actor) => actor.id === pattern || (actor.groups ?? []).includes(pattern);
}

/** The scopes an actor holds through its roles. */
export async function scopesFor(roles: RoleMapper, actor: Actor): Promise<AuthScope[]> {
  return scopesForRoles(await roles(actor));
}

/**
 * Builds `AuthAdapter.authorize` from a role mapping, so the widget can hide
 * buttons the server would refuse. Agents are checked against `agentScopes`
 * when given.
 */
export function createRoleAuthorizer(
  roles: RoleMapper,
  agentScopes?: (actor: Actor) => AuthScope[] | undefined,
): NonNullable<AuthAdapter["authorize"]> {
  return async (request) => {
    if (!request.actor) return false;
    const scopes =
      request.actor.kind === "agent"
        ? (agentScopes?.(request.actor) ?? [])
        : await scopesFor(roles, request.actor);
    return scopesAllow(scopes, request);
  };
}
