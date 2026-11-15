# @annotatekit/auth

Authentication, whitelisting and permissions for AnnotateKit. Everything here runs on a server (or any runtime with Web Crypto) and has no dependencies beyond `@annotatekit/core`.

Three questions, answered separately on every request:

| Question                               | Piece                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Who is this?                           | a `Verifier`: `hostJwtVerifier`, `hostSessionVerifier`, `sharedPasswordAuth().verifier`, `apiKeyVerifier` |
| May they use AnnotateKit on this page? | a `WhitelistAdapter` built with `rules()`                                                                 |
| What may they do?                      | roles from `mapGroups()`, expanded to core `AuthScope`s                                                   |

`createRequestGuard()` runs all of them in order (origin, credential, whitelist, permission). The browser widget can run the same whitelist and `createRoleAuthorizer()` for UX, but only the guard's answer counts.

## Host mode: reuse your app's login

```ts
// Your backend: GET /api/annotatekit-token
import { mintHostToken } from "@annotatekit/auth";

const token = await mintHostToken(
  { id: user.id, name: user.name, email: user.email, emailVerified: true, groups: user.roles },
  { secret: process.env.ANNOTATEKIT_SECRET, issuer: "shop" }, // 5 minute token
);
```

If storage runs inside your own server, skip the token and reuse your session lookup with `hostSessionVerifier({ verify: (req) => ... })`.

## Shared password for a staging site

```ts
const hash = await hashSharedPassword("let-me-in"); // store this, not the password
const guests = sharedPasswordAuth({
  passwordHash: hash,
  sessionSecret: process.env.SESSION_SECRET,
});
const token = await guests.signIn(password, "Dana"); // null when the password is wrong
```

Guests get `provider: "shared-password"` and are capped at the `commenter` role.

## Agent API keys

```ts
const { key } = await mintApiKey({
  store, // ApiKeyStore; createMemoryApiKeyStore() for tests
  minter: alan,
  minterScopes: ["annotations:read", "annotations:write", "annotations:resolve"],
  scopes: ["annotations:read", "annotations:write"],
  name: "Claude Code",
});
// Show `key` once. Only its SHA-256 hash is stored.
```

### Managing keys from the toolbar

`createApiKeyHandler` serves `GET /keys`, `POST /keys` and `DELETE /keys/:id` for the signed-in person. Mount it next to the REST API and hand `client.apiKeys` to the inspector:

```ts
const keys = createApiKeyHandler({ store, verifier: humans, roles, audit });
createAnnotateKitServer({ storage, auth, audit, mount: { "/v1/keys": keys } });

// Browser
createInspector({ apiKeys: createAnnotateKitClient({ baseUrl, token }).apiKeys });
```

The toolbar's Keys panel lists your keys, mints one (name, permissions, 7 days to 1 year) and shows it once with a copy button, and revokes keys with a confirm click. Minting needs `project:admin` by default. Pass `mintScope: "annotations:write"` to let every commenter connect their own agent. Keys never carry more than the minter holds. Admins can switch to everyone's keys and revoke any of them. Agents and shared-password guests can't manage keys. Mints and revokes go to the audit log as `apikey:mint` and `apikey:revoke`.

## Putting it together

```ts
import {
  allow, anonymous, anyVerifier, apiKeyVerifier, createRequestGuard, deny, emailDomains,
  environments, hostJwtVerifier, mapGroups, not, origins, readOnly, rules,
} from "@annotatekit/auth";

const guard = createRequestGuard({
  verifier: anyVerifier(
    hostJwtVerifier({ secret: process.env.ANNOTATEKIT_SECRET, issuer: "shop" }),
    apiKeyVerifier({ store }),
  ),
  whitelist: rules(
    deny(not(origins(["https://*.acme.com", "http://localhost:*"]))),
    readOnly(environments(["production"])),
    allow(emailDomains(["acme.com"])),
    readOnly(anonymous()),
  ),
  roles: mapGroups({ admin: ["annotatekit-admins"], resolver: ["Eng"], default: "commenter" }),
});

const result = await guard.check(request, { action: "comment:create", pageUrl });
if (!result.ok) return new Response(result.reason, { status: result.status });
// result.actor is the verified author: never trust an author sent in the body.
```

### With `@annotatekit/server`

```ts
const server = createAnnotateKitServer({
  storage: createSqliteStorage({ path: "./annotatekit.db" }),
  auth: createServerAuth({
    verifier: anyVerifier(hostJwtVerifier({ secret, issuer: "shop" }), apiKeyVerifier({ store })),
    roles: mapGroups({ admin: ["annotatekit-admins"], default: "commenter" }),
    anonymousRead: true,
  }),
  whitelist: rules(allow(emailDomains(["acme.com"])), readOnly(anonymous())),
});
```

The server refuses writes when the whitelist says `readOnly`, and answers 401 when it says `signIn`.

Rules are checked in order and the first match decides; no match means deny. Matchers: `origins`, `paths` (`*` one segment, `**` any depth), `environments`, `emailDomains` (verified emails only), `groups`, `users`, `providers`, `anonymous`, `signedIn`, `agents`, `always`, `custom`, combined with `all`, `any` and `not`.

## Standalone sign-in: Okta, Entra ID, Google Workspace, any OIDC IdP

For sites whose auth you don't own, the AnnotateKit backend runs its own login. One generic `oidc()` adapter covers every OIDC IdP; `okta()`, `entra()` and `google()` only fill in the issuer.

```ts
const login = createStandaloneAuth({
  providers: [
    okta({ domain: "acme.okta.com", clientId, clientSecret }),
    google({ hostedDomain: "acme.com", clientId: gId, clientSecret: gSecret }),
  ],
  sessionSecret: process.env.SESSION_SECRET,
  baseUrl: "https://annotatekit.acme.com/auth", // register <baseUrl>/<id>/callback at the IdP
  allowedOrigins: ["https://*.acme.com"], // sites that may receive a session
});

createAnnotateKitServer({
  storage,
  auth: createServerAuth({
    verifier: login.verifier,
    roles: mapGroups({ resolver: ["Eng"], default: "commenter" }),
  }),
  mount: { "/auth": login.handler },
});
```

The widget opens `<baseUrl>/<id>/login?origin=<page origin>` in a popup. The backend runs Authorization Code with PKCE, verifies the ID token (signature via JWKS, issuer, audience, nonce, expiry), and posts `{ type: "annotatekit:session", token, expiresAt }` back to the opener, only at an allowed origin. The IdP's tokens never reach the browser. Sessions last 8 hours; on expiry the widget opens the popup again, which most IdPs complete without a prompt.

## Magic links

```ts
const links = magicLinkAuth({
  mailer: {
    send: ({ to, url }) =>
      resend.emails.send({
        to,
        subject: "Sign in to AnnotateKit",
        html: `<a href="${url}">Sign in</a>`,
      }),
  },
  sessionSecret: process.env.SESSION_SECRET,
  baseUrl: "https://annotatekit.acme.com/auth",
  allowedOrigins: ["https://*.acme.com"],
  allowedDomains: ["acme.com", "agency.io"],
  usedTokens: createSqliteUsedTokenStore(db), // one-time links across restarts
});
```

`POST <baseUrl>/magic-link` with `{ email, returnTo }` emails a 15-minute, single-use link (always 202, so addresses aren't revealed). Opening it redirects to `returnTo#annotatekit_session=<token>`. Use `consoleMailer()` locally.

## Storing agent keys in SQLite

`createSqliteApiKeyStore(db)` keeps API keys (hashes only) in an `annotatekit_api_keys` table. Pass the same database you use for storage.

## Audit log

`createStandaloneAuth` and `magicLinkAuth` take the same `audit` log as the server and record each session issued or refused (`session:issue`) and each link sent (`magic-link:send`), with the reason a sign-in failed.

## Guests

Shared-password guests are `comment-only` by default: they read, open threads and comment, but can't edit, resolve or delete. Pass `guestPolicy: "own-threads"` to `createServerAuth`, `createRequestGuard` or `createRoleAuthorizer` to let them manage their own threads.

For SAML 2.0 IdPs (ADFS, Okta or Entra SAML apps, Shibboleth), add `saml()` from [`@annotatekit/auth-saml`](../auth-saml) to `providers`.
