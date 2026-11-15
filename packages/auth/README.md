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

Standalone sign-in (OIDC for Okta, Entra ID, Google Workspace and Auth0; magic links) comes in a later release. See the design doc for the roadmap.
