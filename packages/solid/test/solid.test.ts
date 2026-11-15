// @vitest-environment happy-dom
import { createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotateKitInspector, createInspectorActive, useInspector } from "../src/index.js";

const overlay = () => document.querySelector("[data-annotatekit-overlay]");
const inspecting = () => document.documentElement.hasAttribute("data-annotatekit-inspecting");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<AnnotateKitInspector>", () => {
  it("mounts, follows the active prop and cleans up", () => {
    const [active, setActive] = createSignal(false);
    const onActiveChange = vi.fn();
    const dispose = createRoot((dispose) => {
      AnnotateKitInspector({
        get active() {
          return active();
        },
        onActiveChange,
      });
      return dispose;
    });
    expect(overlay()).not.toBeNull();
    setActive(true);
    expect(inspecting()).toBe(true);
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    setActive(false);
    expect(inspecting()).toBe(false);
    dispose();
    expect(overlay()).toBeNull();
  });
});

describe("useInspector", () => {
  it("exposes the inspector and its active state", () => {
    const { inspector, active, dispose } = createRoot((dispose) => {
      const inspector = useInspector();
      return { inspector, active: createInspectorActive(inspector), dispose };
    });
    const i = inspector();
    expect(i).not.toBeNull();
    expect(active()).toBe(false);
    i?.activate();
    expect(active()).toBe(true);
    dispose();
    expect(inspector()).toBeNull();
    expect(overlay()).toBeNull();
  });
});
