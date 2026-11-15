// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { AnnotateKitInspector } from "../src/index.js";

const overlay = () => document.querySelector("[data-annotatekit-overlay]");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<AnnotateKitInspector>", () => {
  it("mounts, supports v-model:active and cleans up", async () => {
    document.body.innerHTML = `<div id="app"></div>`;
    const active = ref(false);
    const onUpdate = vi.fn((a: boolean) => {
      active.value = a;
    });
    const app = createApp({
      render: () => h(AnnotateKitInspector, { active: active.value, "onUpdate:active": onUpdate }),
    });
    app.mount("#app");
    await nextTick();
    expect(overlay()).not.toBeNull();

    active.value = true;
    await nextTick();
    expect(onUpdate).toHaveBeenLastCalledWith(true);
    expect(document.documentElement.hasAttribute("data-annotatekit-inspecting")).toBe(true);

    app.unmount();
    expect(overlay()).toBeNull();
    expect(document.documentElement.hasAttribute("data-annotatekit-inspecting")).toBe(false);
  });
});
