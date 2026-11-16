# AnnotateKit

Leave threads, comments and feedback directly on a live website, for humans and agents alike.

This is a pnpm workspace. Packages live in `packages/`, demo apps in `apps/`.

| Package                                        | What it is                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`@annotatekit/core`](packages/core)           | Framework-agnostic models, element anchors, adapter interfaces and built-in storage. No DOM framework.         |
| [`@annotatekit/auth`](packages/auth)           | Whitelist rules, role mapping, host tokens, shared passwords, agent API keys and a server-side request guard.  |
| [`@annotatekit/auth-saml`](packages/auth-saml) | SAML 2.0 sign-in for standalone mode, on `@node-saml/node-saml`.                                               |
| [`@annotatekit/inspector`](packages/inspector) | Shadow DOM overlay: pick, pin, box and group elements, quote text; captures breakpoint and CSS system context. |
| [`@annotatekit/embed`](packages/embed)         | One `<script>` tag that adds the inspector to any site, saving locally or to a server.                         |
| [`@annotatekit/react`](packages/react)         | `<AnnotateKitInspector>` and `useInspector` for React 18+.                                                     |
| [`@annotatekit/vue`](packages/vue)             | `<AnnotateKitInspector>` and `useInspector` for Vue 3.                                                         |
| [`@annotatekit/svelte`](packages/svelte)       | `use:annotatekit` action and `activeStore` for Svelte 4 and 5.                                                 |
| [`@annotatekit/solid`](packages/solid)         | `<AnnotateKitInspector>` and `useInspector` for SolidJS.                                                       |
| [`@annotatekit/sqlite`](packages/sqlite)       | SQLite storage adapter on `node:sqlite` or `better-sqlite3`.                                                   |
| [`@annotatekit/server`](packages/server)       | REST API, live events and the `annotatekit-server` CLI.                                                        |
| [`@annotatekit/client`](packages/client)       | HTTP client for the server, implementing the core service interface.                                           |
| [`@annotatekit/mcp`](packages/mcp)             | MCP server for coding agents: read feedback, get element context, reply, resolve.                              |

## Getting started

AnnotateKit has two halves. The **inspector** is the overlay people use to
point at things on a page. **Storage** is where the threads go: the browser's
localStorage for a quick solo review, or an AnnotateKit server, which is what
lets teammates see each other's feedback and coding agents pick it up over MCP.

Pick the snippet for your stack. Each one starts with localStorage; the last
section swaps in a server.

### Any site: one script tag

No framework or build step. Paste this before `</body>`:

```html
<script src="https://unpkg.com/@annotatekit/embed" data-project="my-site" defer></script>
```

Press <kbd>Alt</kbd>+<kbd>A</kbd> or use the toolbar. Add
`data-server="https://feedback.example.com/v1"` to share threads through a
server. [All attributes](packages/embed/README.md).

### React

```sh
npm install @annotatekit/react @annotatekit/core
```

```tsx
import { createLocalStorageAdapter } from "@annotatekit/core";
import { AnnotateKitInspector } from "@annotatekit/react";

const storage = createLocalStorageAdapter({ key: "annotatekit:my-app" });
const actor = { kind: "human", id: "u_123", name: "Ada" } as const;

export function App() {
  return (
    <>
      <YourApp />
      <AnnotateKitInspector storage={{ storage, projectId: "my-app", actor }} />
    </>
  );
}
```

In Next.js, render it from a client component (`"use client"`). [More](packages/react/README.md).

### Vue

```sh
npm install @annotatekit/vue @annotatekit/core
```

```vue
<script setup lang="ts">
import { createLocalStorageAdapter } from "@annotatekit/core";
import { AnnotateKitInspector } from "@annotatekit/vue";

const storage = createLocalStorageAdapter({ key: "annotatekit:my-app" });
const actor = { kind: "human", id: "u_123", name: "Ada" } as const;
</script>

<template>
  <YourApp />
  <AnnotateKitInspector :options="{ storage: { storage, projectId: 'my-app', actor } }" />
</template>
```

In Nuxt, wrap it in `<ClientOnly>`. [More](packages/vue/README.md).

### Svelte

```sh
npm install @annotatekit/svelte @annotatekit/core
```

```svelte
<script lang="ts">
  import { createLocalStorageAdapter } from "@annotatekit/core";
  import { annotatekit } from "@annotatekit/svelte";

  const storage = createLocalStorageAdapter({ key: "annotatekit:my-app" });
  const actor = { kind: "human", id: "u_123", name: "Ada" } as const;
</script>

<svelte:body use:annotatekit={{ storage: { storage, projectId: "my-app", actor } }} />
```

Actions only run in the browser, so this is safe in SvelteKit layouts. [More](packages/svelte/README.md).

### Solid

```sh
npm install @annotatekit/solid @annotatekit/core
```

```tsx
import { createLocalStorageAdapter } from "@annotatekit/core";
import { AnnotateKitInspector } from "@annotatekit/solid";

const storage = createLocalStorageAdapter({ key: "annotatekit:my-app" });
const actor = { kind: "human", id: "u_123", name: "Ada" } as const;

export function App() {
  return (
    <>
      <YourApp />
      <AnnotateKitInspector storage={{ storage, projectId: "my-app", actor }} />
    </>
  );
}
```

[More](packages/solid/README.md).

### Plain JavaScript

```ts
import { createAnnotateKitService, createLocalStorageAdapter } from "@annotatekit/core";
import { bindService, createInspector } from "@annotatekit/inspector";

const service = createAnnotateKitService({
  storage: createLocalStorageAdapter({ key: "annotatekit:my-app" }),
});
const inspector = createInspector();
bindService(inspector, {
  service,
  projectId: "my-app",
  actor: { kind: "human", id: "u_123", name: "Ada" },
});
```

[More](packages/inspector/README.md).

### Share with your team and agents

Run a server (SQLite on disk, REST API and live events):

```sh
npx annotatekit-server --db ./annotatekit.db --cors "https://staging.example.com"
```

Then point the inspector at it with `@annotatekit/client`, in place of
`storage`. Every framework package takes the same `service` option:

```tsx
import { createAnnotateKitClient } from "@annotatekit/client";

const service = createAnnotateKitClient({ baseUrl: "https://feedback.example.com/v1" });

<AnnotateKitInspector service={{ service, projectId: "my-app", actor }} />;
```

Finally, give your coding agent the MCP server, for example in Claude Code:

```sh
claude mcp add annotatekit -- npx annotatekit-mcp --server https://feedback.example.com/v1 --user "Ada"
```

The server trusts the actor each browser sends, which is fine on your own
machine. Before you put it on a network, start it with `--no-dev-auth`, give
agents tokens with `--token`, and see [`@annotatekit/auth`](packages/auth) for
signing people in.

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
Chromium against the real server and the real `annotatekit-mcp` CLI. CI runs it on
every pull request and keeps its screenshots as a build artifact.

## Develop

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit across packages
pnpm lint        # biome
pnpm build       # emit ESM + .d.ts to packages/*/dist
pnpm dev         # server + playground, see above
pnpm ui          # UI playground: every overlay component and state, no build needed
pnpm changeset   # describe your change for the next release
pnpm check:packages  # after build: publint + Are The Types Wrong on packed tarballs
```

### UI playground

`pnpm ui` opens `apps/playground/ui.html`: the toolbar, pins, composers,
messages, attachments, thread panel, thread list and agent keys panel in every
state, rendered with mock data in light, dark and vivid themes, neutral or any accent.
At the bottom, the real overlay runs on an in-memory backend.

The overlay is themed with CSS variables (`--ak-accent`, `--ak-surface`,
`--ak-fg`, `--ak-radius-*`, `--ak-font`, …; see
`packages/inspector/src/overlay/styles.ts`). Set them on
`[data-annotatekit-overlay]` to restyle it. It uses a bundled Instrument Sans
(SIL OFL 1.1) and Phosphor icons (MIT) as plain SVG, registered under its own family name so the host page is never
affected; pass `font: false` to use the system font.

Requires Node 20+ and pnpm 10. Releases are manual; see [RELEASING.md](RELEASING.md).
