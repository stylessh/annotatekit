# @annotatekit/auth-saml

SAML 2.0 sign-in for AnnotateKit's standalone mode, for IdPs that don't speak OIDC (ADFS, Shibboleth, or Okta and Entra SAML apps). It plugs into `createStandaloneAuth` from `@annotatekit/auth` next to `oidc()` providers. It's a separate package so the XML signature stack (`@node-saml/node-saml`) is only installed by people who need it.

```ts
import { createStandaloneAuth, mapGroups } from "@annotatekit/auth";
import { saml } from "@annotatekit/auth-saml";

const baseUrl = "https://annotatekit.acme.com/auth";

const adfs = saml({
  id: "adfs",
  entryPoint: "https://sts.acme.com/adfs/ls/",
  idpCert: process.env.ADFS_SIGNING_CERT!,
  idpIssuer: "http://sts.acme.com/adfs/services/trust",
  spEntityId: "https://annotatekit.acme.com",
  baseUrl,
  attributes: { groups: "http://schemas.xmlsoap.org/claims/Group" },
});

const auth = createStandaloneAuth({
  providers: [adfs],
  sessionSecret: process.env.ANNOTATEKIT_SECRET!,
  baseUrl,
  allowedOrigins: ["https://*.acme.com"],
});

const roles = mapGroups({ admin: ["AnnotateKit Admins"], commenter: ["*@acme.com"] });
```

Register `adfs.callbackUrl` (`<baseUrl>/<id>/callback`, HTTP-POST binding) with the IdP, or upload `adfs.metadata()`.

## What it checks

- The assertion is signed by `idpCert`. Pass several certificates while the IdP rotates keys. Set `wantResponseSigned` to also require a signed response.
- The audience is `spEntityId`, the issuer is `idpIssuer` when set, and the timestamps are current (60 seconds of skew by default).
- The response answers a request this provider sent, and each assertion is accepted once. Both are tracked in memory. When running several instances, pass a shared `cacheProvider`.
- `RelayState` matches the signed login state cookie, which the standalone handler sets with `SameSite=None` so it survives the IdP's cross-site POST. That needs HTTPS.

## Who signs in

Actors have id `<id>|<NameID>` and provider `saml:<id>`. The email comes from `email`, `mail`, the `mail` OID or an email-format NameID, and counts as verified because the IdP signed it. Groups come from the `groups` attribute. Rename any of these with `attributes`.
