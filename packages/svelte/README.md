# @annotatekit/svelte

Svelte bindings for [`@annotatekit/inspector`](../inspector). They work with
Svelte 4 and 5, and need no compiler plugin: the package is a plain action.

```svelte
<script lang="ts">
  import { createLocalStorageAdapter } from "@annotatekit/core";
  import { annotatekit } from "@annotatekit/svelte";

  const storage = createLocalStorageAdapter({ key: "annotatekit:my-app" });
</script>

<svelte:body
  use:annotatekit={{ storage: { storage, projectId: "my-app", actor: currentUser } }}
/>
```

Without `storage` (or `service`, for a server via `@annotatekit/client`), pass
`annotations` and handle `onCreate` yourself. `active`, `mode`, `annotations`,
`focusedId` and the callbacks follow updates to the action's parameter.
Structural options (shortcut, theme, toolbar, breakpoints, storage, service)
are read once on mount.

To drive a custom toolbar, keep the inspector with `onReady`:

```svelte
<script lang="ts">
  import { annotatekit, type Inspector } from "@annotatekit/svelte";

  let inspector: Inspector | undefined;
  let active = false;
  const ready = (i: Inspector) => {
    inspector = i;
    i.on("activechange", (a) => (active = a));
  };
</script>

<svelte:body use:annotatekit={{ onReady: ready, toolbar: false }} />
<button on:click={() => inspector?.toggle()}>{active ? "Done" : "Annotate"}</button>
```

`activeStore(inspector)` wraps the same state as a Svelte store, for `$active`.
