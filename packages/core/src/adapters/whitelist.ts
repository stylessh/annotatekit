import type { Actor } from "../models.js";

export interface WhitelistContext {
  /** The page URL AnnotateKit is about to mount on. */
  url: string;
  actor: Actor | null;
  /** Deployment environment, such as `preview` or `production`. */
  environment?: string;
}

export interface WhitelistDecision {
  allowed: boolean;
  reason?: string;
}

/** Decides whether AnnotateKit may run for this page and actor. */
export interface WhitelistAdapter {
  check(context: WhitelistContext): Promise<WhitelistDecision> | WhitelistDecision;
}

export interface StaticWhitelistOptions {
  /** Allowed origins. `*` matches any run of characters, e.g. `https://*.vercel.app`. */
  origins?: string[];
  /** Allowed pathnames, with the same `*` wildcard, e.g. `/app/*`. */
  paths?: string[];
  /** Allowed environments. */
  environments?: string[];
  /** Whether signed-out visitors may annotate. Defaults to `true`. */
  allowAnonymous?: boolean;
  /** Extra check on the actor, such as an email domain rule. */
  allowActor?: (actor: Actor) => boolean;
}

/**
 * A whitelist from static rules. Each rule that is set must pass; rules left
 * out are not checked.
 */
export function createStaticWhitelist(options: StaticWhitelistOptions = {}): WhitelistAdapter {
  const origins = options.origins?.map(globToRegExp);
  const paths = options.paths?.map(globToRegExp);
  const allowAnonymous = options.allowAnonymous ?? true;

  return {
    check({ url, actor, environment }) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { allowed: false, reason: `Invalid URL: ${url}` };
      }
      if (origins && !origins.some((re) => re.test(parsed.origin))) {
        return { allowed: false, reason: `Origin ${parsed.origin} is not whitelisted` };
      }
      if (paths && !paths.some((re) => re.test(parsed.pathname))) {
        return { allowed: false, reason: `Path ${parsed.pathname} is not whitelisted` };
      }
      if (options.environments && !(environment && options.environments.includes(environment))) {
        return {
          allowed: false,
          reason: `Environment ${environment ?? "(none)"} is not whitelisted`,
        };
      }
      if (!actor) {
        return allowAnonymous ? { allowed: true } : { allowed: false, reason: "Sign-in required" };
      }
      if (options.allowActor && !options.allowActor(actor)) {
        return { allowed: false, reason: `Actor ${actor.id} is not whitelisted` };
      }
      return { allowed: true };
    },
  };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
