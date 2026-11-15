# AnnotateKit

Leave threads, comments and feedback directly on a live website, for humans and agents alike.

This is a pnpm workspace. Packages live in `packages/`, demo apps in `apps/`.

| Package                                        | What it is                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`@annotatekit/core`](packages/core)           | Framework-agnostic models, element anchors, adapter interfaces and built-in storage. No DOM framework. |
| [`@annotatekit/inspector`](packages/inspector) | Shadow DOM overlay: pick, pin, box and group elements; captures breakpoint and CSS system context.     |
| [`@annotatekit/react`](packages/react)         | `<AnnotateKitInspector>` and `useInspector` for React 18+.                                             |
| [`@annotatekit/vue`](packages/vue)             | `<AnnotateKitInspector>` and `useInspector` for Vue 3.                                                 |
| [`@annotatekit/sqlite`](packages/sqlite)       | SQLite storage adapter on `node:sqlite` or `better-sqlite3`.                                           |
| [`@annotatekit/server`](packages/server)       | REST API, live events and the `annotatekit-server` CLI.                                                |
| [`@annotatekit/client`](packages/client)       | HTTP client for the server, implementing the core service interface.                                   |
| [`@annotatekit/mcp`](packages/mcp)             | MCP server for coding agents: read feedback, get element context, reply, resolve.                      |

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

# Try the inspector on a demo page, backed by core's localStorage adapter
pnpm build && pnpm --filter @annotatekit/playground dev

# Drive the playground in headless Chromium (needs Playwright)
pnpm --filter @annotatekit/playground test:e2e
```

Requires Node 20+ and pnpm 10.
