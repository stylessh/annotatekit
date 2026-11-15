# @annotatekit/core

The shared language of AnnotateKit: data models, element anchors and the adapter
interfaces every renderer, inspector and MCP server builds on. Plain TypeScript,
ESM only, no runtime dependencies.

## Models

- **`Thread`**: the unit of feedback. Lives on a page, has a status
  (`open`, `in_progress`, `pending_review`, `resolved`, `dismissed`), an optional
  `groupId`, tags, intent, priority and a `Resolution` once closed.
- **`Annotation`**: the visual mark a thread is attached to. Its `kind` is `pin`
  (a point at `position`, 0..1 inside the element), `region` (a rectangle at
  `region`) or `element` (the whole element). Holds the `ElementAnchor` and the
  `CaptureContext`.
- **`Comment`**: a message in a thread, markdown or plain text.
- **`Group`**: a named bucket of threads.
- **`Actor`**: a `HumanActor` or an `AgentActor` (`{ kind: "agent", name, model?, onBehalfOf? }`).

## Element anchor

`ElementAnchor` records how to find an element again and describe it:
a primary CSS `selector` plus `fallbackSelectors`, `xpath`, a `TextQuote`
(exact text, prefix, suffix and a whitespace-insensitive fingerprint),
document-space `rect`, `scroll` offsets, a trimmed `htmlSnippet`, a whitelist of
`computedStyles` and an optional `source` hint (component, file, line).

`CaptureContext` records the environment: `viewport` (with device pixel ratio),
`breakpoint`, detected `cssSystem` (Tailwind, CSS modules, …, with the element's
utility classes and CSS variables), color scheme and user agent.

Helpers: `createTextQuote`, `fingerprintText`, `resolveBreakpoint` with
`tailwindBreakpoints` and `bootstrapBreakpoints` presets.

## Adapters

| Interface           | Job                                                                            | Built in                                           |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| `StorageAdapter`    | Persist threads, annotations, comments and groups; filter, paginate, subscribe | `createMemoryStorage`, `createLocalStorageAdapter` |
| `AuthAdapter`       | Who is annotating, and what they may do                                        | `createStaticAuth`                                 |
| `WhitelistAdapter`  | Whether AnnotateKit may run for this URL, environment and actor                | `createStaticWhitelist`                            |
| `ResolutionAdapter` | What "resolve" means                                                           | `createManualResolution`, `createReviewResolution` |

`createReviewResolution` sends agent fixes to `pending_review`; a human resolving
the thread approves it and is recorded as `reviewedBy`.

```ts
import {
  createLocalStorageAdapter,
  createReviewResolution,
  createStaticWhitelist,
} from "@annotatekit/core";

const storage = createLocalStorageAdapter({ key: "annotatekit:my-site" });
const whitelist = createStaticWhitelist({
  origins: ["https://*.vercel.app", "http://localhost:*"],
});
const resolution = createReviewResolution();

const { items, nextCursor } = await storage.threads.list({
  pathname: "/pricing",
  status: ["open", "in_progress"],
  limit: 20,
});
storage.subscribe((change) => console.log(change.type, change.collection, change.id));
```

### Writing a storage adapter

Each collection has `get`, `list`, `put` (upsert) and `delete`. Adapters must
return copies, order lists by `createdAt` then `id`, delete a thread's annotation
and comments with it, and clear `groupId` from threads when a group is deleted.
`test/storage-contract.ts` is the behaviour suite the built-in adapters pass.
