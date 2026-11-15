# AnnotateKit

Leave threads, comments and feedback directly on a live website, for humans and agents alike.

This is a pnpm workspace. Packages live in `packages/`.

| Package                                  | What it is                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`@annotatekit/core`](packages/core)     | Framework-agnostic models, element anchors, adapter interfaces and built-in storage. No DOM framework.        |
| [`@annotatekit/auth`](packages/auth)     | Whitelist rules, role mapping, host tokens, shared passwords, agent API keys and a server-side request guard. |
| [`@annotatekit/sqlite`](packages/sqlite) | SQLite storage adapter on `node:sqlite` or `better-sqlite3`.                                                  |
| [`@annotatekit/server`](packages/server) | REST API, live events and the `annotatekit-server` CLI.                                                       |
| [`@annotatekit/client`](packages/client) | HTTP client for the server, implementing the core service interface.                                          |
| [`@annotatekit/mcp`](packages/mcp)       | MCP server for coding agents: read feedback, get element context, reply, resolve.                             |

## Try the agent loop locally

```sh
pnpm install && pnpm build
node packages/server/dist/cli.js --db ./annotatekit.db          # REST API on :4747
node packages/mcp/dist/cli.js --server http://localhost:4747/v1  # MCP over stdio
```

Agents resolve into `pending_review` by default; a human approves on the page.

## Develop

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit across packages
pnpm lint        # biome
pnpm build       # emit ESM + .d.ts to packages/*/dist
```

Requires Node 20+ and pnpm 10.
