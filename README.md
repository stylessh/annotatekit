# AnnotateKit

Leave threads, comments and feedback directly on a live website, for humans and agents alike.

This is a pnpm workspace. Packages live in `packages/`.

| Package                              | What it is                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [`@annotatekit/core`](packages/core) | Framework-agnostic models, element anchors, adapter interfaces and built-in storage. No DOM framework.        |
| [`@annotatekit/auth`](packages/auth) | Whitelist rules, role mapping, host tokens, shared passwords, agent API keys and a server-side request guard. |

## Develop

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit across packages
pnpm lint        # biome
pnpm build       # emit ESM + .d.ts to packages/*/dist
```

Requires Node 20+ and pnpm 10.
