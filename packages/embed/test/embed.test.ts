// @vitest-environment happy-dom

import { Capturer, draftToThreadInput } from "@annotatekit/inspector";
import { afterEach, describe, expect, it, vi } from "vitest";
import { init, optionsFromScript } from "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("optionsFromScript", () => {
  it("reads data attributes", () => {
    const s = document.createElement("script");
    s.setAttribute("data-project", "shop");
    s.setAttribute("data-server", "https://feedback.example.com/v1");
    s.setAttribute("data-user-name", "Alan");
    s.setAttribute("data-shortcut", "false");
    s.setAttribute("data-theme", "dark");
    s.setAttribute("data-accent", "#e11d48");
    s.setAttribute("data-active", "");
    s.setAttribute("data-toolbar", "false");
    expect(optionsFromScript(s)).toEqual({
      project: "shop",
      server: "https://feedback.example.com/v1",
      user: { name: "Alan" },
      shortcut: false,
      theme: "dark",
      accentColor: "#e11d48",
      active: true,
      toolbar: false,
    });
  });

  it("ignores unknown themes and missing values", () => {
    const s = document.createElement("script");
    s.setAttribute("data-theme", "neon");
    expect(optionsFromScript(s)).toEqual({});
  });
});

describe("init", () => {
  it("saves to localStorage under the project when no server is given", async () => {
    document.body.innerHTML = `<button data-testid="cta">Go</button>`;
    const kit = init({ project: "shop" });
    expect(kit.backend).toBe("local");
    expect(document.querySelector("[data-annotatekit-overlay]")).not.toBeNull();

    const c = new Capturer(document);
    const snap = c.element(document.querySelector("button") as Element);
    const input = draftToThreadInput(
      {
        kind: "element",
        comment: "Louder",
        anchor: snap.anchor,
        targets: [snap],
        fixed: false,
        context: c.context(snap, [snap]),
        page: c.page(),
      },
      { projectId: "shop" },
    );
    const { thread } = await kit.service.createThread(
      { kind: "human", id: "u1", name: "Alan" },
      input,
    );
    expect(thread.projectId).toBe("shop");
    expect(localStorage.getItem("annotatekit:shop")).toContain(thread.id);
    kit.destroy();
    expect(document.querySelector("[data-annotatekit-overlay]")).toBeNull();
  });

  it("gives anonymous visitors a stable id", () => {
    const a = init({ project: "p" });
    a.destroy();
    const id = localStorage.getItem("annotatekit:visitor");
    expect(id).toMatch(/^vis_/);
    init({ project: "p" }).destroy();
    expect(localStorage.getItem("annotatekit:visitor")).toBe(id);
  });

  it("talks to a server when one is given", async () => {
    const fetch = vi.fn((_url: unknown) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const kit = init({ project: "p", server: "https://feedback.example.com/v1" });
    expect(kit.backend).toBe("server");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0]?.[0])).toContain("https://feedback.example.com/v1/");
    kit.destroy();
    vi.unstubAllGlobals();
  });
});
