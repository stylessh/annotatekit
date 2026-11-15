// @vitest-environment happy-dom
import type { ApiKeyManager, ApiKeySummary, CreateApiKeyInput } from "@annotatekit/core";
import { afterEach, describe, expect, it } from "vitest";
import { createInspector, type Inspector } from "../src/index.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeManager(admin = false) {
  const keys: ApiKeySummary[] = [];
  const created: CreateApiKeyInput[] = [];
  let n = 0;
  const manager: ApiKeyManager = {
    async list() {
      return {
        keys: [...keys].reverse(),
        grantable: ["annotations:read", "annotations:write", "annotations:resolve"],
        admin,
      };
    },
    async create(input) {
      created.push(input);
      n++;
      const record: ApiKeySummary = {
        id: `key_${n}`,
        prefix: `ak_live_${n}abc`,
        name: input.name ?? "Agent",
        onBehalfOf: "usr_alan",
        scopes: input.scopes,
        createdAt: Date.now(),
        expiresAt: Date.now() + (input.expiresInDays ?? 30) * 86_400_000,
      };
      keys.push(record);
      return { key: `ak_live_secret${n}`, record };
    },
    async revoke(id) {
      const key = keys.find((k) => k.id === id);
      if (key) key.revokedAt = Date.now();
    },
  };
  return { manager, keys, created };
}

let inspector: Inspector | null = null;
afterEach(() => {
  inspector?.destroy();
  inspector = null;
});

function mount(manager?: ApiKeyManager) {
  inspector = createInspector(manager ? { apiKeys: manager } : {});
  const root = document.querySelector("[data-annotatekit-overlay]")?.shadowRoot as ShadowRoot;
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  return { root, $ };
}

describe("agent keys panel", () => {
  it("only appears when a key manager is given", () => {
    expect(mount().$('[data-action="keys"]')).toBeNull();
  });

  it("mints a key, shows it once, and revokes with a confirm click", async () => {
    const { manager, created } = fakeManager();
    const { $, root } = mount(manager);
    const button = $<HTMLButtonElement>('[data-action="keys"]');
    button.click();
    await flush();
    const panel = $(".panel.keys");
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect($(".empty").hidden).toBe(false);
    expect($(".all").hidden).toBe(true);

    // Read, comment and resolve are ticked by default.
    const boxes = [...root.querySelectorAll<HTMLInputElement>('.scopes input[type="checkbox"]')];
    expect(boxes.map((b) => [b.value, b.checked])).toEqual([
      ["annotations:read", true],
      ["annotations:write", true],
      ["annotations:resolve", true],
    ]);
    (boxes[2] as HTMLInputElement).checked = false;
    $<HTMLInputElement>('input[name="name"]').value = "Claude Code";
    $<HTMLSelectElement>('select[name="expires"]').value = "7";
    $<HTMLFormElement>("form.new-key").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    await flush();

    expect(created).toEqual([
      { name: "Claude Code", scopes: ["annotations:read", "annotations:write"], expiresInDays: 7 },
    ]);
    expect($(".reveal").hidden).toBe(false);
    expect($(".reveal .key").textContent).toBe("ak_live_secret1");
    const item = $("li[data-id='key_1']");
    expect(item.textContent).toContain("Claude Code");
    expect(item.textContent).toContain("Read, Comment");
    expect(item.textContent).toContain("expires in 7 days");

    const revoke = () => $<HTMLButtonElement>("li[data-id='key_1'] [data-action='keys-revoke']");
    revoke().click();
    await flush();
    expect(revoke().textContent).toBe("Confirm");
    revoke().click();
    await flush();
    await flush();
    expect($("li[data-id='key_1']").hasAttribute("data-inactive")).toBe(true);
    expect($("li[data-id='key_1']").textContent).toContain("Revoked");
    expect(revoke()).toBeNull();

    // Closing hides the secret for good.
    $<HTMLButtonElement>('[data-action="keys-close"]').click();
    expect(panel.hidden).toBe(true);
    expect($(".reveal .key").textContent).toBe("");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("asks for at least one permission, shows errors, and offers admins everyone's keys", async () => {
    const { manager } = fakeManager(true);
    manager.create = async () => {
      throw new Error("Creating agent keys needs project:admin");
    };
    const { $, root } = mount(manager);
    $<HTMLButtonElement>('[data-action="keys"]').click();
    await flush();
    expect($(".all").hidden).toBe(false);

    const form = $<HTMLFormElement>("form.new-key");
    for (const box of root.querySelectorAll<HTMLInputElement>(".scopes input")) box.checked = false;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect($(".error").textContent).toBe("Pick at least one permission");

    (root.querySelector(".scopes input") as HTMLInputElement).checked = true;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    await flush();
    expect($(".error").textContent).toContain("project:admin");
    expect($(".reveal").hidden).toBe(true);
  });
});
