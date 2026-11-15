# @annotatekit/react

React 18+ bindings for [`@annotatekit/inspector`](../inspector).

```tsx
import { createLocalStorageAdapter } from "@annotatekit/core";
import { AnnotateKitInspector } from "@annotatekit/react";

const storage = createLocalStorageAdapter({ key: "annotatekit:my-app" });

export function App() {
  return (
    <>
      <YourApp />
      <AnnotateKitInspector
        storage={{ storage, projectId: "my-app", actor: currentUser }}
        onSelect={(threadId) => openThread(threadId)}
      />
    </>
  );
}
```

Without `storage`, pass `annotations` and handle `onCreate` yourself.
`active`, `mode`, `annotations` and `focusedId` are reactive; the other options
are read once on mount. Callbacks can be inline functions.

`useInspector(props)` does the same and returns a ref to the `Inspector`;
`useInspectorActive(ref)` tracks whether it is active, for a custom toolbar.
