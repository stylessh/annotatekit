import type {
  Actor,
  WhitelistAdapter,
  WhitelistContext,
  WhitelistDecision,
} from "@annotatekit/core";

/** What a matcher sees: the whitelist context with the URL already parsed. */
export interface RuleContext extends WhitelistContext {
  parsedUrl: URL;
}

/** A predicate over the page, environment and actor. */
export type Matcher = (context: RuleContext) => boolean | Promise<boolean>;

export type RuleEffect = "allow" | "readOnly" | "deny";

export interface Rule {
  effect: RuleEffect;
  when: Matcher;
  reason?: string;
}

/** Let matching requests annotate. */
export function allow(when: Matcher, reason?: string): Rule {
  return withReason({ effect: "allow", when }, reason);
}

/** Let matching requests see threads but not write. */
export function readOnly(when: Matcher, reason?: string): Rule {
  return withReason({ effect: "readOnly", when }, reason);
}

/** Refuse matching requests. */
export function deny(when: Matcher, reason?: string): Rule {
  return withReason({ effect: "deny", when }, reason);
}

function withReason(rule: Rule, reason: string | undefined): Rule {
  if (reason !== undefined) rule.reason = reason;
  return rule;
}

/**
 * A whitelist from an ordered list of rules. The first rule that matches
 * decides; when none match, the request is denied. A denial for a signed-out
 * visitor carries `signIn: true` unless a `deny` rule matched explicitly.
 */
export function rules(...list: Rule[]): WhitelistAdapter {
  return {
    async check(context) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(context.url);
      } catch {
        return { allowed: false, reason: `Invalid URL: ${context.url}` };
      }
      const ctx: RuleContext = { ...context, parsedUrl };
      for (const rule of list) {
        if (!(await rule.when(ctx))) continue;
        return decide(rule, context.actor);
      }
      const denied: WhitelistDecision = { allowed: false, reason: "No whitelist rule matched" };
      if (!context.actor) {
        denied.signIn = true;
        denied.reason = "Sign-in required";
      }
      return denied;
    },
  };
}

function decide(rule: Rule, actor: Actor | null): WhitelistDecision {
  if (rule.effect === "deny") {
    return { allowed: false, reason: rule.reason ?? "Denied by whitelist rule" };
  }
  const decision: WhitelistDecision = { allowed: true };
  if (rule.effect === "readOnly") decision.readOnly = true;
  if (rule.reason !== undefined) decision.reason = rule.reason;
  // An anonymous visitor who may only read can still be offered a sign-in.
  if (rule.effect === "readOnly" && !actor) decision.signIn = true;
  return decision;
}

// Matchers

/** Page origin, exact or with `*` wildcards, e.g. `https://*.vercel.app`, `http://localhost:*`. */
export function origins(patterns: string[]): Matcher {
  const res = patterns.map(globToRegExp);
  return ({ parsedUrl }) => res.some((re) => re.test(parsedUrl.origin));
}

/** Page pathname with `*` (one segment) and `**` (any depth), e.g. `/checkout/**`. */
export function paths(patterns: string[]): Matcher {
  const res = patterns.map(pathGlobToRegExp);
  return ({ parsedUrl }) => res.some((re) => re.test(parsedUrl.pathname));
}

export function environments(names: string[]): Matcher {
  return ({ environment }) => environment !== undefined && names.includes(environment);
}

/**
 * The actor's email domain, only when the identity provider verified the
 * email. Subdomains are not included: list them explicitly.
 */
export function emailDomains(domains: string[]): Matcher {
  const wanted = domains.map((d) => d.toLowerCase().replace(/^@/, ""));
  return ({ actor }) => {
    if (actor?.kind !== "human" || !actor.email || actor.emailVerified !== true) return false;
    const domain = actor.email.toLowerCase().split("@").pop();
    return domain !== undefined && wanted.includes(domain);
  };
}

/** Any of the actor's identity-provider groups or host roles. */
export function groups(names: string[]): Matcher {
  return ({ actor }) =>
    actor?.kind === "human" && (actor.groups ?? []).some((g) => names.includes(g));
}

/** Specific actors, by id or by verified email. */
export function users(idsOrEmails: string[]): Matcher {
  const wanted = new Set(idsOrEmails.map((v) => v.toLowerCase()));
  return ({ actor }) => {
    if (!actor) return false;
    if (wanted.has(actor.id.toLowerCase())) return true;
    return (
      actor.kind === "human" &&
      actor.emailVerified === true &&
      actor.email !== undefined &&
      wanted.has(actor.email.toLowerCase())
    );
  };
}

/** Identities from a given provider, such as `shared-password` or `oidc:okta`. */
export function providers(names: string[]): Matcher {
  return ({ actor }) => actor?.kind === "human" && names.includes(actor.provider ?? "");
}

export const anonymous =
  (): Matcher =>
  ({ actor }) =>
    actor === null;
export const signedIn =
  (): Matcher =>
  ({ actor }) =>
    actor !== null;
export const agents =
  (): Matcher =>
  ({ actor }) =>
    actor?.kind === "agent";
export const always = (): Matcher => () => true;

/** Escape hatch for anything else. */
export function custom(fn: Matcher): Matcher {
  return fn;
}

export function all(...matchers: Matcher[]): Matcher {
  return async (ctx) => {
    for (const m of matchers) if (!(await m(ctx))) return false;
    return true;
  };
}

export function any(...matchers: Matcher[]): Matcher {
  return async (ctx) => {
    for (const m of matchers) if (await m(ctx)) return true;
    return false;
  };
}

export function not(matcher: Matcher): Matcher {
  return async (ctx) => !(await matcher(ctx));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${escapeRegExp(glob).replace(/\*/g, ".*")}$`);
}

function pathGlobToRegExp(glob: string): RegExp {
  const source = glob
    .split("**")
    .map((part) => escapeRegExp(part).replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`);
}
