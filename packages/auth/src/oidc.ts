import type { HumanActor } from "@annotatekit/core";
import { base64UrlDecode, base64UrlEncode, fromUtf8, randomBase62, utf8 } from "./encoding.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The parts of `/.well-known/openid-configuration` this package uses. */
export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcProviderOptions {
  /** Short name used in URLs and `provider`, such as `okta`. */
  id: string;
  /** The IdP's issuer URL. Its discovery document is read from `<issuer>/.well-known/openid-configuration`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Extra scopes beyond `openid email profile`, such as `groups` for Okta. */
  scopes?: string[];
  /** ID token claim holding the user's groups. Defaults to `groups`. */
  groupsClaim?: string;
  /** Extra authorization parameters, such as `{ hd: "acme.com" }` for Google. */
  authorizationParams?: Record<string, string>;
  /** Extra check on verified claims, such as Google's `hd`. Return false to refuse. */
  acceptClaims?: (claims: IdTokenClaims) => boolean;
  /** Accept issuers other than `issuer`, for multi-tenant IdPs. */
  issuerMatches?: (iss: string) => boolean;
  fetch?: Fetch;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  [claim: string]: unknown;
}

export interface OidcProvider {
  readonly id: string;
  /** Builds the IdP authorization URL for a login with the given state, nonce and PKCE challenge. */
  authorizationUrl(params: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string>;
  /** Exchanges an authorization code and returns the verified actor. Throws on any failure. */
  exchange(params: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<HumanActor>;
}

/** A generic OpenID Connect provider. Covers Okta, Entra ID, Google Workspace, Auth0, Keycloak and others. */
export function oidc(options: OidcProviderOptions): OidcProvider {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const issuer = options.issuer.replace(/\/+$/, "");
  const groupsClaim = options.groupsClaim ?? "groups";
  let metadata: Promise<OidcMetadata> | undefined;
  let jwks: { keys: Jwk[]; fetchedAt: number } | undefined;

  function discover(): Promise<OidcMetadata> {
    metadata ??= (async () => {
      const res = await doFetch(`${issuer}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer}: ${res.status}`);
      const doc = (await res.json()) as Partial<OidcMetadata>;
      for (const key of [
        "issuer",
        "authorization_endpoint",
        "token_endpoint",
        "jwks_uri",
      ] as const) {
        if (typeof doc[key] !== "string")
          throw new Error(`OIDC discovery for ${issuer} lacks ${key}`);
      }
      return doc as OidcMetadata;
    })().catch((error) => {
      metadata = undefined;
      throw error;
    });
    return metadata;
  }

  async function keyFor(kid: string | undefined, alg: string): Promise<Jwk> {
    const meta = await discover();
    const find = () =>
      jwks?.keys.find((k) => (kid === undefined || k.kid === kid) && (!k.alg || k.alg === alg));
    // Refetch when the key is unknown (rotation), at most once a minute.
    if (!find() && (!jwks || Date.now() - jwks.fetchedAt > 60_000)) {
      const res = await doFetch(meta.jwks_uri);
      if (!res.ok) throw new Error(`Could not fetch JWKS: ${res.status}`);
      jwks = { keys: ((await res.json()) as { keys?: Jwk[] }).keys ?? [], fetchedAt: Date.now() };
    }
    const key = find();
    if (!key) throw new Error("ID token signed with an unknown key");
    return key;
  }

  function issuerOk(iss: string, meta: OidcMetadata): boolean {
    return options.issuerMatches ? options.issuerMatches(iss) : iss === meta.issuer;
  }

  return {
    id: options.id,
    async authorizationUrl({ redirectUri, state, nonce, codeChallenge }) {
      const meta = await discover();
      const url = new URL(meta.authorization_endpoint);
      const scopes = ["openid", "email", "profile", ...(options.scopes ?? [])];
      const params: Record<string, string> = {
        response_type: "code",
        client_id: options.clientId,
        redirect_uri: redirectUri,
        scope: [...new Set(scopes)].join(" "),
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        ...options.authorizationParams,
      };
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return url.toString();
    },

    async exchange({ code, redirectUri, codeVerifier, nonce }) {
      const meta = await discover();
      const res = await doFetch(meta.token_endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          client_id: options.clientId,
          client_secret: options.clientSecret,
        }).toString(),
      });
      if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
      const body = (await res.json()) as { id_token?: unknown };
      if (typeof body.id_token !== "string") throw new Error("Token response has no id_token");

      const claims = await verifyJwt(body.id_token, keyFor);
      const now = Math.floor(Date.now() / 1000);
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!issuerOk(claims.iss, meta)) throw new Error("ID token issuer mismatch");
      if (!audiences.includes(options.clientId)) throw new Error("ID token audience mismatch");
      if (audiences.length > 1 && claims.azp !== options.clientId) {
        throw new Error("ID token authorized party mismatch");
      }
      if (typeof claims.exp !== "number" || claims.exp + 60 < now)
        throw new Error("ID token expired");
      if (claims.nonce !== nonce) throw new Error("ID token nonce mismatch");
      if (typeof claims.sub !== "string" || !claims.sub) throw new Error("ID token has no subject");
      if (options.acceptClaims && !options.acceptClaims(claims)) {
        throw new Error("ID token claims refused");
      }
      return actorFromIdToken(claims, options.id, groupsClaim);
    },
  };
}

function actorFromIdToken(claims: IdTokenClaims, id: string, groupsClaim: string): HumanActor {
  const email = typeof claims.email === "string" ? claims.email : undefined;
  const name =
    (typeof claims.name === "string" && claims.name) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    email ||
    claims.sub;
  const actor: HumanActor = {
    kind: "human",
    id: `${id}|${claims.sub}`,
    name,
    provider: `oidc:${id}`,
  };
  if (email) {
    actor.email = email;
    actor.emailVerified = claims.email_verified === true || claims.email_verified === "true";
  }
  if (typeof claims.picture === "string") actor.avatarUrl = claims.picture;
  const groups = claims[groupsClaim];
  if (Array.isArray(groups))
    actor.groups = groups.filter((g): g is string => typeof g === "string");
  return actor;
}

// Presets: they only fill in the issuer and the vendor's groups claim.

type PresetBase = Omit<OidcProviderOptions, "id" | "issuer"> & { id?: string };

/** Okta. Add a `groups` claim to the app's ID token in the Okta admin console. */
export function okta(options: PresetBase & { domain: string; authorizationServer?: string }) {
  const { domain, authorizationServer, ...rest } = options;
  const base = `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return oidc({
    id: "okta",
    scopes: ["groups"],
    ...rest,
    issuer: authorizationServer ? `${base}/oauth2/${authorizationServer}` : base,
  });
}

/** Microsoft Entra ID. Enable group claims on the app registration; Entra sends group object ids. */
export function entra(options: PresetBase & { tenantId: string }) {
  const { tenantId, ...rest } = options;
  return oidc({
    id: "entra",
    ...rest,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
  });
}

/** Google Workspace. `hostedDomain` limits sign-in to one Workspace domain and is checked on the token. */
export function google(options: PresetBase & { hostedDomain?: string }) {
  const { hostedDomain, ...rest } = options;
  const preset: OidcProviderOptions = {
    id: "google",
    ...rest,
    issuer: "https://accounts.google.com",
    issuerMatches: (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com",
  };
  if (hostedDomain) {
    preset.authorizationParams = { hd: hostedDomain, ...rest.authorizationParams };
    preset.acceptClaims = (claims) =>
      claims.hd === hostedDomain && (rest.acceptClaims?.(claims) ?? true);
  }
  return oidc(preset);
}

// PKCE and ID token signatures

export function randomState(): string {
  return randomBase62(32);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(verifier))));
}

interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

const ALGORITHMS: Record<
  string,
  {
    import: RsaHashedImportParams | EcKeyImportParams;
    verify: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
  }
> = {
  RS256: {
    import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    verify: { name: "RSASSA-PKCS1-v1_5" },
  },
  ES256: {
    import: { name: "ECDSA", namedCurve: "P-256" },
    verify: { name: "ECDSA", hash: "SHA-256" },
  },
};

async function verifyJwt(
  token: string,
  keyFor: (kid: string | undefined, alg: string) => Promise<Jwk>,
): Promise<IdTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");
  const [h, b, s] = parts as [string, string, string];
  const header = JSON.parse(fromUtf8(base64UrlDecode(h))) as { alg?: string; kid?: string };
  const alg = header.alg ?? "";
  const algorithm = ALGORITHMS[alg];
  if (!algorithm) throw new Error(`Unsupported ID token algorithm: ${alg}`);
  const jwk = await keyFor(header.kid, alg);
  const { kid: _kid, alg: _alg, ...keyData } = jwk;
  const key = await crypto.subtle.importKey("jwk", keyData, algorithm.import, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    algorithm.verify,
    key,
    base64UrlDecode(s),
    utf8(`${h}.${b}`),
  );
  if (!valid) throw new Error("ID token signature is invalid");
  return JSON.parse(fromUtf8(base64UrlDecode(b))) as IdTokenClaims;
}
