import type { LoginProvider } from "@annotatekit/auth";
import type { HumanActor } from "@annotatekit/core";
import {
  type CacheProvider,
  InMemoryCacheProvider,
  type Profile,
  SAML,
  ValidateInResponseTo,
} from "@node-saml/node-saml";

export interface SamlAttributeNames {
  /** Attribute holding the email. Defaults to `email`, `mail`, then the `mail` OID, then a NameID in email format. */
  email?: string;
  /** Attribute holding the display name. Defaults to `displayName`, `name`, then the email's local part. */
  name?: string;
  /** Attribute holding group names, for `mapGroups`. Defaults to `groups`. */
  groups?: string;
}

export interface SamlProviderOptions {
  /** Short name used in URLs and actor ids, e.g. `okta` gives `/auth/okta/login`. */
  id: string;
  /** The IdP's single sign-on URL (HTTP-Redirect binding). */
  entryPoint: string;
  /** The IdP's signing certificate(s), PEM or bare base64. Several while rotating. */
  idpCert: string | string[];
  /** The IdP's entity id. When set, responses from any other issuer are refused. */
  idpIssuer?: string;
  /** This service provider's entity id, which the IdP puts in the audience. */
  spEntityId: string;
  /**
   * The `baseUrl` given to `createStandaloneAuth`. The assertion consumer
   * service is `<baseUrl>/<id>/callback`.
   */
  baseUrl: string;
  attributes?: SamlAttributeNames;
  /**
   * Holds pending request ids and seen assertion ids. Defaults to memory; pass
   * a shared store when running several instances behind a load balancer.
   */
  cacheProvider?: CacheProvider;
  /** Clock skew to tolerate, in milliseconds. Defaults to 60 seconds. */
  acceptedClockSkewMs?: number;
  /** Also require the whole response to be signed, not only the assertion. Defaults to `false`. */
  wantResponseSigned?: boolean;
}

export interface SamlProvider extends LoginProvider {
  readonly responseMode: "form_post";
  /** Service provider metadata XML to upload to the IdP. */
  metadata(): string;
  /** The assertion consumer service URL to register with the IdP. */
  readonly callbackUrl: string;
}

const MAIL_OID = "urn:oid:0.9.2342.19200300.100.1.3";
const EMAIL_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
const ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * SAML 2.0 sign-in for `createStandaloneAuth`. Assertions must be signed by
 * `idpCert`, answer a request this provider sent, and are accepted once.
 */
export function saml(options: SamlProviderOptions): SamlProvider {
  if (!ID.test(options.id)) throw new Error(`Invalid SAML provider id: ${options.id}`);
  const callbackUrl = `${options.baseUrl.replace(/\/+$/, "")}/${options.id}/callback`;
  const client = new SAML({
    callbackUrl,
    entryPoint: options.entryPoint,
    idpCert: options.idpCert,
    ...(options.idpIssuer ? { idpIssuer: options.idpIssuer } : {}),
    issuer: options.spEntityId,
    audience: options.spEntityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: options.wantResponseSigned === true,
    validateInResponseTo: ValidateInResponseTo.always,
    rejectReplayedAssertions: true,
    cacheProvider: options.cacheProvider ?? new InMemoryCacheProvider({}),
    acceptedClockSkewMs: options.acceptedClockSkewMs ?? 60_000,
    identifierFormat: null,
  });
  const provider = `saml:${options.id}`;

  return {
    id: options.id,
    responseMode: "form_post",
    callbackUrl,
    async begin({ redirectUri, state }) {
      if (redirectUri !== callbackUrl) {
        throw new Error(`SAML ${options.id}: baseUrl does not match the standalone handler`);
      }
      return client.getAuthorizeUrlAsync(state, undefined, {});
    },
    async complete({ params }) {
      const response = params.get("SAMLResponse");
      if (!response) throw new Error("No SAMLResponse");
      const { profile } = await client.validatePostResponseAsync({ SAMLResponse: response });
      if (!profile) throw new Error("SAML response carried no assertion");
      return toActor(profile, options.id, provider, options.attributes ?? {});
    },
    metadata() {
      return client.generateServiceProviderMetadata(null);
    },
  };
}

function toActor(
  profile: Profile,
  id: string,
  provider: string,
  names: SamlAttributeNames,
): HumanActor {
  if (!profile.nameID) throw new Error("SAML assertion has no NameID");
  const email = lower(
    names.email
      ? first(profile[names.email])
      : (first(profile.email) ??
          first(profile.mail) ??
          first(profile[MAIL_OID]) ??
          (profile.nameIDFormat === EMAIL_FORMAT ? profile.nameID : undefined)),
  );
  const name =
    (names.name
      ? first(profile[names.name])
      : (first(profile.displayName) ?? first(profile.name))) ??
    email?.split("@")[0] ??
    profile.nameID;
  const groups = strings(profile[names.groups ?? "groups"]);

  const actor: HumanActor = { kind: "human", id: `${id}|${profile.nameID}`, name, provider };
  // The IdP signed the assertion, so its email is as verified as its NameID.
  if (email) {
    actor.email = email;
    actor.emailVerified = true;
  }
  if (groups.length > 0) actor.groups = groups;
  return actor;
}

function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function strings(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function lower(value: string | undefined): string | undefined {
  return value?.toLowerCase();
}
