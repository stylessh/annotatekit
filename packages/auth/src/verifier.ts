import type { Actor, AuthScope } from "@annotatekit/core";

/** Who a request is from, as established on the server. */
export interface VerifiedPrincipal {
  actor: Actor;
  /**
   * Scopes fixed by the credential itself, such as an agent API key. When
   * absent, scopes come from the guard's role mapping.
   */
  scopes?: AuthScope[];
  /** Epoch milliseconds after which the credential stops working. */
  expiresAt?: number;
}

/**
 * The server-side half of authentication: the only thing storage trusts.
 * Returns `null` when the request carries no credential this verifier
 * understands, or an invalid one.
 */
export interface Verifier {
  verify(request: Request): Promise<VerifiedPrincipal | null>;
}

/** Tries each verifier in order and returns the first principal found. */
export function anyVerifier(...verifiers: Verifier[]): Verifier {
  return {
    async verify(request) {
      for (const verifier of verifiers) {
        const principal = await verifier.verify(request);
        if (principal) return principal;
      }
      return null;
    },
  };
}
