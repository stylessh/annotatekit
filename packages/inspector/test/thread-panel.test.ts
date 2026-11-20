// @vitest-environment happy-dom
import { type Actor, createAnnotateKitService, createMemoryStorage } from "@annotatekit/core";
import { afterEach, describe, expect, it } from "vitest";
import { bindService, createInspector, type Inspector, ui } from "../src/index.js";

const alan: Actor = { kind: "human", id: "usr_alan", name: "Alan" };
const claude: Actor = { kind: "agent", id: "agt_claude", name: "Claude" };
const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

let inspector: Inspector | null = null;
afterEach(() => {
  inspector?.destroy();
  inspector = null;
  document.body.innerHTML = "";
});

async function setup() {
  document.body.innerHTML = `<button id="buy">Buy</button>`;
  const service = createAnnotateKitService({ storage: createMemoryStorage() });
  inspector = createInspector({ font: false });
  const anchor = inspector.capture(document.querySelector("#buy") as Element).anchor;
  const { thread } = await service.createThread(alan, {
    projectId: "p",
    page: { url: location.href, origin: location.origin, pathname: location.pathname },
    title: "Bigger button",
    annotation: {
      kind: "pin",
      anchor,
      position: { x: 0.5, y: 0.5 },
      context: { viewport: { width: 1024, height: 768, devicePixelRatio: 1 } },
    },
    comment: { body: "Make it bigger" },
  });
  await service.addComment(claude, thread.id, { body: "Done, 48px now" });
  const binding = bindService(inspector, { service, projectId: "p", actor: alan });
  await binding.reload();
  const root = document.querySelector("[data-annotatekit-overlay]")?.shadowRoot as ShadowRoot;
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  return { service, thread, root, $, inspector };
}

describe("thread panel", () => {
  it("opens a thread with its messages and replies with an attachment", async () => {
    const { $, root, service, thread, inspector } = await setup();
    inspector.openThread(thread.id);
    await flush();
    expect($(".panel.thread").hidden).toBe(false);
    expect($(".panel-head .title").textContent).toBe("Bigger button");
    const names = [...root.querySelectorAll(".msg .name")].map((n) => n.textContent);
    expect(names).toEqual(["You", "Claude"]);
    expect($(".msg.reply .agent-tag").getAttribute("aria-label")).toBe("Agent");

    $<HTMLTextAreaElement>(".reply textarea").value = "Thanks!";
    const input = $<HTMLInputElement>(".reply input[type=file]");
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(root.querySelectorAll(".tray .attachment")).toHaveLength(1);
    $<HTMLFormElement>("form.reply").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush(8);

    const { items } = await service.listComments(alan, { threadId: thread.id });
    const last = items.at(-1);
    expect(last?.body).toBe("Thanks!");
    expect(last?.attachments?.[0]).toMatchObject({ kind: "image", name: "shot.png" });
    expect(last?.attachments?.[0]?.url).toMatch(/^data:image\/png;base64,/);
    expect(root.querySelectorAll(".msg")).toHaveLength(3);
    expect($<HTMLTextAreaElement>(".reply textarea").value).toBe("");
  });

  it("resolves from the panel and lists threads from the toolbar", async () => {
    const { $, root, service, thread, inspector } = await setup();
    inspector.openThread(thread.id);
    await flush();
    $<HTMLButtonElement>('[data-action="resolve"]').click();
    await flush(8);
    expect((await service.getThread(alan, thread.id)).thread.status).toBe("resolved");
    expect($(".panel-head .status-icon").getAttribute("data-status")).toBe("resolved");

    $<HTMLButtonElement>('.toolbar [data-action="threads"]').click();
    await flush();
    const items = [...root.querySelectorAll(".thread-list .item-title")].map((n) => n.textContent);
    expect(items).toEqual(["Bigger button"]);
    $<HTMLButtonElement>('[data-action="panel-close"]').click();
    expect($(".panel.threads").hidden).toBe(true);
  });

  it("renders empty, loading and error states", () => {
    const h = ui.elementFactory(document);
    const text = (els: HTMLElement[]) => els.map((e) => e.textContent).join(" ");
    expect(text(ui.threadListPanel(h, { state: "ready", items: [], now: 0 }))).toContain(
      "No threads yet",
    );
    expect(ui.threadListPanel(h, { state: "loading" })[1]?.getAttribute("role")).toBe("status");
    expect(text(ui.threadPanel(h, { state: "error", message: "boom" }))).toContain("boom");
  });

  it("never renders unsafe attachment URLs as links or images", () => {
    const h = ui.elementFactory(document);
    const el = ui.attachmentList(h, [{ kind: "image", url: "javascript:alert(1)", name: "x" }]);
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("a")?.hasAttribute("href")).toBe(false);
  });
});
