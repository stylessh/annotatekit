import { type Actor, type Thread, tailwindBreakpoints } from "@annotatekit/core";
import {
  bindService,
  createInspector,
  detectBreakpointsFromStylesheets,
} from "@annotatekit/inspector";
import { pickBackend } from "./backend.js";

const projectId = "playground";
const actor: Actor = { kind: "human", id: "usr_playground", name: "Playground user" };

// This page hand-rolls a few Tailwind utilities; name breakpoints the Tailwind way,
// but log what its own stylesheets use too.
console.info("[playground] stylesheet breakpoints", detectBreakpointsFromStylesheets());

const out = document.getElementById("out") as HTMLElement;
const list = document.getElementById("threads") as HTMLOListElement;
const backendLabel = document.getElementById("backend") as HTMLElement;

const backend = await pickBackend();
const { service } = backend;
backendLabel.textContent = backend.label;
backendLabel.dataset.kind = backend.kind;

const inspector = createInspector({
  breakpoints: tailwindBreakpoints,
  ignore: ".log", // the playground's own debug panel
  onCreate(draft) {
    out.textContent = JSON.stringify(draft, null, 2);
  },
  onSelect(id) {
    for (const li of list.children) {
      li.toggleAttribute("data-focused", li.getAttribute("data-id") === id);
    }
  },
});
const binding = bindService(inspector, { service, projectId, actor });

function action(label: string, run: () => Promise<unknown>): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.onclick = () => void run().catch((e) => console.error(e));
  return btn;
}

function actionsFor(t: Thread): HTMLButtonElement[] {
  switch (t.status) {
    case "pending_review":
      // An agent proposed a fix; a human resolving it approves it.
      return [
        action("Approve", () => service.resolveThread(actor, t.id, { note: "Looks good" })),
        action("Reopen", () => service.reopenThread(actor, t.id, { reason: "Not fixed yet" })),
      ];
    case "resolved":
    case "dismissed":
      return [action("Reopen", () => service.reopenThread(actor, t.id))];
    default:
      return [action("Resolve", () => service.resolveThread(actor, t.id, { note: "Fixed" }))];
  }
}

async function renderThreads() {
  const { items } = await service.listThreads(actor, { projectId, pathname: location.pathname });
  list.replaceChildren(
    ...items.map((t) => {
      const li = document.createElement("li");
      li.dataset.id = t.id;
      li.dataset.status = t.status;
      li.textContent = `${t.title ?? "(untitled)"} [${t.status.replace("_", " ")}]`;
      li.append(...actionsFor(t));
      return li;
    }),
  );
}
service.subscribe?.(() => void renderThreads());
void renderThreads();

(document.getElementById("clear") as HTMLButtonElement).onclick = async () => {
  const { items } = await service.listThreads(actor, { projectId });
  await Promise.all(items.map((t) => service.deleteThread(actor, t.id)));
  if (!service.subscribe) void binding.reload();
};

Object.assign(window, { inspector, service, binding, backend: backend.kind });
