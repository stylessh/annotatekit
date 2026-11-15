// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotateKitInspector, type RenderableAnnotation } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const overlay = () => document.querySelector("[data-annotatekit-overlay]");
const pin = (id: string): RenderableAnnotation => ({
  id,
  kind: "element",
  anchor: { selector: "#target", rect: { x: 0, y: 0, width: 10, height: 10 } },
});

const onActiveChange = vi.fn();
let setActive: (a: boolean) => void = () => {};

function App() {
  const [active, set] = useState(false);
  setActive = set;
  return createElement(AnnotateKitInspector, {
    active,
    annotations: [pin("t1")],
    onActiveChange,
    // A new function every render must not remount the overlay.
    onCreate: () => {},
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<AnnotateKitInspector>", () => {
  it("mounts once, follows controlled props and cleans up", async () => {
    document.body.innerHTML = `<div id="target">x</div><div id="root"></div>`;
    const root = createRoot(document.getElementById("root") as HTMLElement);
    await act(async () => root.render(createElement(App)));
    const host = overlay();
    expect(host).not.toBeNull();

    await act(async () => setActive(true));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    expect(overlay()).toBe(host);
    expect(document.documentElement.hasAttribute("data-annotatekit-inspecting")).toBe(true);

    await act(async () => root.unmount());
    expect(overlay()).toBeNull();
  });
});
