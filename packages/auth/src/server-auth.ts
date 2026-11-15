import {
  type Actor,
  type AuthorizationRequest,
  type AuthScope,
  scopesAllow,
  scopesForRoles,
} from "@annotatekit/core";
import type { RoleMapper } from "./roles.js";
import type { Verifier } from "./verifier.js";

export interface ServerAuthOptions {
  /** How to establish who sent the request. Combine several with `anyVerifier`. */
  verifier: Verifier;
  /** Roles for human actors. Agents use the scopes on their credential. */
  roles: RoleMapper;
  /**
   * Let signed-out visitors read threads. Pair it with a whitelist rule such as
   * `readOnly(anonymous())` so only allowed pages are readable. Defaults to `false`.
   */
  anonymousRead?: boolean;
}

/** Shape of `@annotatekit/server`'s `ServerAuth`, without depending on it. */
export interface VerifiedServerAuth {
  authenticate(request: Request): Promise<Actor | null>;
  authorize(request: AuthorizationRequest): Promise<boolean>;
}

/**
 * Plugs verifiers and roles into `createAnnotateKitServer({ auth })`.
 * `authenticate` runs the verifiers; `authorize` checks the scopes of the
 * credential that produced the actor (an agent's API key), or the actor's
 * roles for humans.
 */
export function createServerAuth(options: ServerAuthOptions): VerifiedServerAuth {
  const credentialScopes = new WeakMap<Actor, AuthScope[]>();
  return {
    async authenticate(request) {
      const principal = await options.verifier.verify(request);
      if (!principal) return null;
      if (principal.scopes) credentialScopes.set(principal.actor, principal.scopes);
      return principal.actor;
    },
    async authorize(request) {
      const { actor } = request;
      if (!actor) return options.anonymousRead === true && request.action === "thread:read";
      const scopes =
        credentialScopes.get(actor) ??
        (actor.kind === "human" ? scopesForRoles(await options.roles(actor)) : []);
      return scopesAllow(scopes, request);
    },
  };
}
