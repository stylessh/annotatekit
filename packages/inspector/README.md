# @annotatekit/inspector

A framework-agnostic overlay for pointing at things on a live page. It renders
inside a Shadow DOM, so the host page's CSS can't break it and it can't leak
styles into the page.

- **Highlight and pick**: hover shows the element's box, tag, classes and size.
- **Pins**: click an element to drop a pin at that exact spot (`kind: "pin"`).
- **Whole elements**: Shift-click one element, release Shift (`kind: "element"`).
- **Groups**: Shift-click several elements, release Shift. One annotation covers
  all of them (`kind: "region"`, anchored to their closest common ancestor, with
  every element in `targets`).
- **Boxes**: drag to draw a region; the elements fully inside become `targets`.
- **Context**: each draft carries core's `CaptureContext`: viewport, the named
  breakpoint, color scheme, and the detected CSS system with the element's
  utility classes and the CSS variables its rules use.

Pins re-anchor through the element's selector, fallback selectors and a text
fingerprint, follow scrolling and layout changes, and regions scale with their
anchor element, so a box drawn on desktop still frames the same content on a
phone.

## Use it with core

```ts
import { createLocalStorageAdapter } from "@annotatekit/core";
import { bindStorage, createInspector } from "@annotatekit/inspector";

const storage = createLocalStorageAdapter({ key: "annotatekit:my-site" });
const inspector = createInspector();
bindStorage(inspector, {
  storage,
  projectId: "my-site",
  actor: { kind: "human", id: "u_1", name: "Alan" },
});
```

`bindStorage` shows the current page's threads as pins, creates a thread (with
its annotation and first comment) for each new draft, and follows changes made
elsewhere (another tab, an agent resolving a thread). It runs core's
`createAnnotateKitService` over the adapter, so ids, permissions and comment
counts follow core's rules. To talk to any other `AnnotateKitService`, such as a
remote one, use `bindService(inspector, { service, projectId, actor })`.

## Use it on its own

```ts
import { createInspector, draftToThreadInput, toRenderable } from "@annotatekit/inspector";

const inspector = createInspector({
  onCreate(draft) {
    // draft: { kind, comment, anchor, position?, region?, targets, fixed, context, page }
    service.createThread(actor, draftToThreadInput(draft, { projectId }));
  },
  onSelect(id) {
    openThread(id);
  },
});
inspector.setAnnotations(threads.map((t) => toRenderable(t.thread, t.annotation)));
inspector.focusAnnotation(id); // outline an annotation's region and targets
```

| Option                  | Default                                                                                |                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `active`                | `false`                                                                                | Start in inspect mode.                                                                              |
| `mode`                  | `"element"`                                                                            | `"area"` ignores clicks; only dragging creates annotations.                                         |
| `shortcut`              | `"Alt+KeyA"`                                                                           | Toggle shortcut as `Mod+…+KeyboardEvent.code`, or `false`.                                          |
| `toolbar`               | `true`                                                                                 | Show the floating toolbar with the current breakpoint.                                              |
| `ignore`                |                                                                                        | Selector for page UI that can't be picked and keeps working while inspecting.                       |
| `breakpoints`           | Tailwind                                                                               | A core `BreakpointPreset`, such as `bootstrapBreakpoints`, or `detectBreakpointsFromStylesheets()`. |
| `identifyingAttributes` | `data-testid`, `data-test`, `data-qa`, `data-cy`, `data-component`, `data-annotate-id` | Preferred in selectors.                                                                             |
| `theme`, `accentColor`  | auto                                                                                   | Overlay appearance.                                                                                 |

Keyboard: the shortcut toggles inspect mode, Enter saves, Shift+Enter adds a
line, Escape closes the composer, then clears the selection, then exits.

## Capture without the UI

`Capturer` exposes the same capture for agents and tests:

```ts
const capturer = new Capturer(document);
const snap = capturer.element(document.querySelector("#checkout")!);
snap.anchor; // core ElementAnchor
snap.css.tailwind; // { byVariant: { "": [...], md: [...] }, active: [...] }
snap.css.variables; // [{ name: "--brand", value: "#4f46e5", property: "background" }]
capturer.context(snap); // core CaptureContext
```

CSS systems detected: Tailwind (utilities and `--tw-*` variables), Bootstrap,
CSS modules, styled-components and Emotion, falling back to `plain`. Stylesheets
from other origins can't be read, so variables they define are missed.
