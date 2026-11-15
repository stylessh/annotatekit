# @annotatekit/embed

Add AnnotateKit to any site with one script tag. No framework or build step.

```html
<script src="https://unpkg.com/@annotatekit/embed" data-project="my-site" defer></script>
```

Visitors press <kbd>Alt</kbd>+<kbd>A</kbd> (or use the toolbar) to pin, box,
group or quote anything on the page. Without a server, threads are kept in the
visitor's own localStorage, which is handy for a quick local review. To share
them with your team and with coding agents over MCP, point the tag at an
`@annotatekit/server`:

```html
<script
  src="https://unpkg.com/@annotatekit/embed"
  data-project="my-site"
  data-server="https://feedback.example.com/v1"
  defer
></script>
```

The bundle (`dist/annotatekit.js`) is about 21 KB gzipped and includes the
inspector, core and the HTTP client.

## Attributes

| Attribute         | Default             | What it does                                                             |
| ----------------- | ------------------- | ------------------------------------------------------------------------ |
| `data-project`    | the page's hostname | Project the threads belong to.                                           |
| `data-server`     | none (localStorage) | API root of an AnnotateKit server.                                       |
| `data-token`      | none                | Bearer token for the server, e.g. a host token from `@annotatekit/auth`. |
| `data-user-id`    | a stored visitor id | Who is annotating. Anonymous visitors get a stable `vis_…` id.           |
| `data-user-name`  | `Visitor`           | Display name on threads.                                                 |
| `data-user-email` | none                | Email on threads.                                                        |
| `data-shortcut`   | `Alt+KeyA`          | Toggle shortcut, or `false` to turn it off.                              |
| `data-theme`      | `auto`              | `light`, `dark` or `auto`.                                               |
| `data-accent`     | blue                | Accent color for pins and highlights.                                    |
| `data-active`     | off                 | Start with the inspector on.                                             |
| `data-ignore`     | none                | CSS selector for page UI to leave alone.                                 |
| `data-toolbar`    | on                  | `false` hides the floating toolbar.                                      |
| `data-manual`     | off                 | Don't start automatically; call `AnnotateKit.init()` yourself.           |

## From JavaScript

The tag defines `window.AnnotateKit`:

```js
// With data-manual, start it once you know who the user is.
const kit = AnnotateKit.init({
  project: "my-site",
  server: "https://feedback.example.com/v1",
  user: { id: user.id, name: user.name },
});
kit.inspector.activate();
kit.destroy(); // remove it again
```

In a bundled app, `import { init } from "@annotatekit/embed"` does the same
thing, though the framework packages (`@annotatekit/react`,
`@annotatekit/vue`) fit better there.

## Try it locally

Run `pnpm dev` and open `http://localhost:5173/embed/`: a plain page whose only
AnnotateKit code is the script tag. Query parameters become data attributes,
for example `/embed/?server=http://localhost:4747/v1`.
