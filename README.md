# AnnotateKit

Leave threads, comments and feedback directly on a live website, for humans and agents alike.

This is a pnpm workspace. Packages live in `packages/`, demo apps in `apps/`.

| Package                                        | What it is                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`@annotatekit/core`](packages/core)           | Framework-agnostic models, element anchors, adapter interfaces and built-in storage. No DOM framework. |
| [`@annotatekit/inspector`](packages/inspector) | Shadow DOM overlay: pick, pin, box and group elements; captures breakpoint and CSS system context.     |
| [`@annotatekit/react`](packages/react)         | `<AnnotateKitInspector>` and `useInspector` for React 18+.                                             |
| [`@annotatekit/vue`](packages/vue)             | `<AnnotateKitInspector>` and `useInspector` for Vue 3.                                                 |

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
