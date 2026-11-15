# AnnotateKit

Leave threads, comments and feedback directly on a live website, for humans and agents alike.

This is a pnpm workspace. Packages live in `packages/`, demo apps in `apps/`.

| Package                                        | What it is                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`@annotatekit/core`](packages/core)           | Framework-agnostic models, element anchors, adapter interfaces and built-in storage. No DOM framework.        |
| [`@annotatekit/auth`](packages/auth)           | Whitelist rules, role mapping, host tokens, shared passwords, agent API keys and a server-side request guard. |
| [`@annotatekit/auth-saml`](packages/auth-saml) | SAML 2.0 sign-in for standalone mode, on `@node-saml/node-saml`.                                              |
| [`@annotatekit/inspector`](packages/inspector) | Shadow DOM overlay: pick, pin, box and group elements; captures breakpoint and CSS system context.            |
| [`@annotatekit/react`](packages/react)         | `<AnnotateKitInspector>` and `useInspector` for React 18+.                                                    |
| [`@annotatekit/vue`](packages/vue)             | `<AnnotateKitInspector>` and `useInspector` for Vue 3.                                                        |
| [`@annotatekit/sqlite`](packages/sqlite)       | SQLite storage adapter on `node:sqlite` or `better-sqlite3`.                                                  |
| [`@annotatekit/server`](packages/server)       | REST API, live events and the `annotatekit-server` CLI.                                                       |
| [`@annotatekit/client`](packages/client)       | HTTP client for the server, implementing the core service interface.                                          |
| [`@annotatekit/mcp`](packages/mcp)             | MCP server for coding agents: read feedback, get element context, reply, resolve.                             |

## Try the whole loop locally

```sh
pnpm install
pnpm dev
```

`pnpm dev` builds the packages, then runs the REST server on
`http://localhost:4747/v1` (SQLite in `.annotatekit/dev.db`) and the playground
on `http://localhost:5173`. The playground panel says where it is saving: the
server when it's reachable, localStorage otherwise.

1. **Annotate.** Open the playground, press <kbd>Alt</kbd>+<kbd>A</kbd> and click
   the "Get started" button, or drag a box over the pricing cards. Type a note
   and press Enter. The thread is saved on the server with the element's
   selectors, text, styles, breakpoint, Tailwind classes and CSS variables.
2. **Connect an agent.** Register the MCP server with your coding agent, for
   example Claude Code:

   ```sh
   claude mcp add annotatekit -- node "$PWD/packages/mcp/dist/cli.js" \
     --server http://localhost:4747/v1 --user "Your name"
   ```

   Then ask it to "work on the open AnnotateKit feedback". It calls
   `list_threads`, reads the element with `get_annotation_context`, makes the
   change, and calls `resolve_thread` with a summary.
3. **Review.** The pin on the page turns to pending review straight away, with
   no reload, because the page follows the server's event stream. Click
   **Approve** in the panel to resolve the thread, or **Reopen** to send it
   back. Agent resolves always wait for a human unless you start the server
   with `--direct-resolve playground`.

`pnpm --filter @annotatekit/playground test:e2e` runs this loop in headless
Chromium against the real server and the real `annotatekit-mcp` CLI.

## Develop

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit across packages
pnpm lint        # biome
pnpm build       # emit ESM + .d.ts to packages/*/dist
pnpm dev         # server + playground, see above
```

Requires Node 20+ and pnpm 10.
