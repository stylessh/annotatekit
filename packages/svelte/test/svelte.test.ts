// @vitest-environment happy-dom
import { createMemoryStorage } from "@annotatekit/core";
import type { Action } from "svelte/action";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AnnotateKitOptions, activeStore, annotatekit, type Inspector } from "../src/index.js";

// Type-level: usable wherever Svelte expects an action.
const _asAction: Action<HTMLElement, AnnotateKitOptions | undefined> = annotatekit;
void _asAction;

const overlay = () => document.querySelector("[data-annotatekit-overlay]");
const inspecting = () => document.documentElement.hasAttribute("data-annotatekit-inspecting");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("use:annotatekit", () => {
  it("mounts, follows updates and cleans up", () => {
    let inspector: Inspector | null = null;
    const action = annotatekit(document.body, { onReady: (i) => (inspector = i) });
    expect(overlay()).not.toBeNull();
    expect(inspector).not.toBeNull();

    const seen: boolean[] = [];
    const off = activeStore(inspector as unknown as Inspector).subscribe((a) => seen.push(a));
    action.update({ active: true });
    expect(inspecting()).toBe(true);
    action.update({ active: false });
    expect(seen).toEqual([false, true, false]);
    off();

    action.destroy();
    expect(overlay()).toBeNull();
    expect(inspecting()).toBe(false);
  });

  it("reads callbacks from the latest options", () => {
    const first = vi.fn();
    const second = vi.fn();
    let inspector: Inspector | null = null;
    const action = annotatekit(document.body, {
      onActiveChange: first,
      onReady: (i) => (inspector = i),
    });
    action.update({ onActiveChange: second });
    (inspector as unknown as Inspector).activate();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(true);
    action.destroy();
  });

  it("binds to storage", async () => {
    const storage = createMemoryStorage();
    const action = annotatekit(document.body, {
      storage: { storage, projectId: "p1", actor: { kind: "human", id: "u1", name: "A" } },
    });
    expect(overlay()).not.toBeNull();
    action.destroy();
  });
});
