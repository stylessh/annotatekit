# @annotatekit/solid

SolidJS bindings for [`@annotatekit/inspector`](../inspector).

```tsx
import { createLocalStorageAdapter } from "@annotatekit/core";
import { AnnotateKitInspector } from "@annotatekit/solid";

const storage = createLocalStorageAdapter({ key: "annotatekit:my-app" });

export function App() {
  return (
    <>
      <YourApp />
      <AnnotateKitInspector storage={{ storage, projectId: "my-app", actor: currentUser }} />
    </>
  );
}
```

Without `storage` (or `service`, for a server via `@annotatekit/client`), pass
`annotations` and handle `onCreate` yourself. `active`, `mode`, `annotations`
and `focusedId` are tracked like any Solid prop. Callbacks are read when they
fire. Structural options (shortcut, theme, toolbar, breakpoints, storage,
service) are read once on mount.

For a custom toolbar, `useInspector(props)` returns an accessor for the
`Inspector`, and `createInspectorActive(inspector)` tracks whether it is on:

```tsx
const inspector = useInspector({ toolbar: false });
const active = createInspectorActive(inspector);

<button onClick={() => inspector()?.toggle()}>{active() ? "Done" : "Annotate"}</button>;
```
