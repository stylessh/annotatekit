# @annotatekit/client

Talks to `@annotatekit/server` over HTTP. The client implements core's
`AnnotateKitService` interface, so renderers and the MCP server can use a
remote backend exactly like a local one.

```ts
import { createAnnotateKitClient } from "@annotatekit/client";

const client = createAnnotateKitClient({ baseUrl: "http://localhost:4747/v1" });

const me = { kind: "human", id: "usr_alan", name: "Alan" } as const;
const { items } = await client.listThreads(me, { pathname: "/checkout", status: "open" });

const stop = client.subscribe((change) => console.log(change.type, change.collection), {
  projectId: "shop",
});
```

Options: `token` (string or async function, sent as a bearer token),
`sendActor` (default `true`: sends the per-call actor for servers running dev
auth), `headers`, `fetch` and `reconnectMs` for the event stream. Errors are
thrown as `AnnotateKitError` with the server's error code.

`client.apiKeys` lists, mints and revokes agent API keys for the signed-in
person, against `createApiKeyHandler` from `@annotatekit/auth` mounted at
`<baseUrl>/keys`. Pass it to the inspector's `apiKeys` option to get the
toolbar's key panel.
