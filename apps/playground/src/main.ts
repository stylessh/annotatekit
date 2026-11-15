import {
  type Actor,
  createAnnotateKitService,
  createLocalStorageAdapter,
  tailwindBreakpoints,
} from "@annotatekit/core";
import {
  bindService,
  createInspector,
  detectBreakpointsFromStylesheets,
} from "@annotatekit/inspector";

const projectId = "playground";
const actor: Actor = { kind: "human", id: "dev", name: "Playground user" };
const storage = createLocalStorageAdapter({ key: "annotatekit:playground" });
const service = createAnnotateKitService({ storage });

// This page hand-rolls a few Tailwind utilities; name breakpoints the Tailwind way,
// but log what its own stylesheets use too.
console.info("[playground] stylesheet breakpoints", detectBreakpointsFromStylesheets());

const out = document.getElementById("out") as HTMLElement;
const list = document.getElementById("threads") as HTMLOListElement;

const inspector = createInspector({
  breakpoints: tailwindBreakpoints,
  ignore: ".log", // the playground's own debug panel
  onCreate(draft) {
    out.textContent = JSON.stringify(draft, null, 2);
  },
  onSelect(id) {
    for (const li of list.children)
      li.toggleAttribute("data-focused", li.getAttribute("data-id") === id);
  },
});
const binding = bindService(inspector, { service, projectId, actor });

async function renderThreads() {
  const { items } = await service.listThreads(actor, { projectId, pathname: location.pathname });
  list.replaceChildren(
    ...items.map((t) => {
      const li = document.createElement("li");
      li.dataset.id = t.id;
      li.dataset.status = t.status;
      li.textContent = `${t.title ?? "(untitled)"} [${t.status}]`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = t.status === "resolved" ? "Reopen" : "Resolve";
      btn.onclick = () =>
        t.status === "resolved"
          ? service.reopenThread(actor, t.id)
          : service.resolveThread(actor, t.id, { note: "Fixed in the playground" });
      li.append(btn);
      return li;
    }),
  );
}
service.subscribe?.(() => void renderThreads());
void renderThreads();

(document.getElementById("clear") as HTMLButtonElement).onclick = async () => {
  const { items } = await service.listThreads(actor, { projectId });
  await Promise.all(items.map((t) => service.deleteThread(actor, t.id)));
};

Object.assign(window, { inspector, service, binding });
