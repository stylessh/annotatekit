# @annotatekit/server

A small HTTP server for AnnotateKit. It exposes the core service as a REST API
with live change events, as a web-standard `fetch` handler you can mount in
Hono, Next.js route handlers, Bun or Deno, plus a Node adapter and a CLI.

## Quick start

```sh
npx annotatekit-server --db ./annotatekit.db --port 4747
```

The CLI serves `http://127.0.0.1:4747/v1` over SQLite, allows CORS from
`localhost`, and runs **dev auth**: the client names its actor in the
`x-annotatekit-actor` header. Use `--no-dev-auth` and `--token <token=name>`
outside local development. `--direct-resolve shop,docs` lets agents resolve
without review in those projects; everywhere else agent resolves land in
`pending_review`.

## In code

```ts
import { createReviewResolution } from "@annotatekit/core";
import { createSqliteStorage } from "@annotatekit/sqlite";
import { createAnnotateKitServer, createTokenAuth, serve } from "@annotatekit/server";

const app = createAnnotateKitServer({
  storage: createSqliteStorage({ database: "./annotatekit.db" }),
  resolution: createReviewResolution(),
  auth: createTokenAuth({
    tokens: { [process.env.AGENT_TOKEN!]: { kind: "agent", id: "agt_ci", name: "CI" } },
  }),
  cors: { origins: ["https://*.vercel.app"] },
});

await serve(app.fetch, { port: 4747 });
// or: export default { fetch: app.fetch }   (Bun, Deno, Workers-style hosts)
```

Auth is pluggable through `ServerAuth`: `authenticate(request)` returns the
actor and optional `authorize` checks each action. Built in:
`createStaticServerAuth`, `createTokenAuth`, `createDevAuth` and
`composeServerAuth`. A `WhitelistAdapter` passed as `whitelist` is checked
against the `Origin`/`Referer` of browser requests.

`mount: { "/mcp": handler }` serves extra handlers, such as the MCP server's
Streamable HTTP handler, from the same process.

## API

All routes live under `basePath` (default `/v1`). Errors are
`{ error: { code, message } }` with the core error codes.

| Method | Path                    | Body / query                                                                                                                |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`               |                                                                                                                             |
| GET    | `/me`                   | the authenticated actor                                                                                                     |
| GET    | `/threads`              | `projectId`, `status` (comma list), `pathname`, `pageUrl`, `groupId`, `authorId`, `tags`, `updatedSince`, `cursor`, `limit` |
| POST   | `/threads`              | `CreateThreadInput` (page, annotation, optional first comment)                                                              |
| GET    | `/threads/:id`          | returns `ThreadDetail`                                                                                                      |
| PATCH  | `/threads/:id`          | `UpdateThreadInput`                                                                                                         |
| DELETE | `/threads/:id`          |                                                                                                                             |
| POST   | `/threads/:id/status`   | `{ status: "open" \| "in_progress" \| "dismissed", note? }`                                                                 |
| POST   | `/threads/:id/resolve`  | `{ note?, reference? }`, outcome decided by the resolution adapter                                                          |
| POST   | `/threads/:id/reopen`   | `{ reason? }`                                                                                                               |
| GET    | `/threads/:id/comments` | `cursor`, `limit`                                                                                                           |
| POST   | `/threads/:id/comments` | `{ body, format?, mentions?, attachments? }`                                                                                |
| PATCH  | `/comments/:id`         | `{ body }`                                                                                                                  |
| DELETE | `/comments/:id`         |                                                                                                                             |
| GET    | `/groups`               | `projectId`                                                                                                                 |
| POST   | `/groups`               | `{ projectId, name, color?, description? }`                                                                                 |
| PATCH  | `/groups/:id`           | `{ name?, color?, description? }`                                                                                           |
| DELETE | `/groups/:id`           |                                                                                                                             |
| GET    | `/events`               | Server-sent events (`event: change`, a `StorageChange`), optional `projectId`                                               |
| GET    | `/audit`                | Admins only, when `audit` is set: `actorId`, `action`, `decision`, `since`, `before`, `limit`                               |

Use `@annotatekit/client` to call it from a browser or another service.

## Audit log

Pass `audit` (for example `createSqliteAuditLog` from `@annotatekit/sqlite`) to record every write and every refused request: who (id, name, provider, and `onBehalfOf` for agents, never email or groups), the action, `allow` / `deny` / `error`, the reason, the target and the page origin. Successful reads aren't recorded. Admins (`audit:read`, granted by `project:admin`) read it at `GET /audit`, newest first. Without `auth.authorize` the route refuses everyone, because nothing could tell who is an admin.
