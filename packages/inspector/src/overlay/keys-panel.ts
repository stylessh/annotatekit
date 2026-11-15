import type { ApiKeyList, ApiKeyManager, ApiKeySummary, AuthScope } from "@annotatekit/core";

type H = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  text?: string,
) => HTMLElementTagNameMap[K];

export interface KeysPanel {
  readonly el: HTMLElement;
  readonly open: boolean;
  show(): Promise<void>;
  hide(): void;
  toggle(): Promise<void>;
  /** Reloads the list. */
  refresh(): Promise<void>;
}

const SCOPE_LABELS: Record<AuthScope, string> = {
  "annotations:read": "Read",
  "annotations:write": "Comment",
  "annotations:resolve": "Resolve",
  "annotations:moderate": "Moderate",
  "project:admin": "Admin",
};
/** Offered by default when someone can grant them: enough for an agent to work on feedback. */
const DEFAULT_SCOPES: AuthScope[] = [
  "annotations:read",
  "annotations:write",
  "annotations:resolve",
];
const EXPIRY_DAYS = [7, 30, 90, 365];
const DAY = 86_400_000;

/**
 * The toolbar's "Agent keys" panel: lists your keys, mints new ones (shown
 * once, with a copy button) and revokes them. Admins can switch to everyone's.
 */
export function createKeysPanel(
  h: H,
  manager: ApiKeyManager,
  now: () => number = Date.now,
): KeysPanel {
  const el = h("div", {
    class: "panel keys",
    role: "dialog",
    "aria-label": "Agent keys",
    hidden: "",
  });
  const header = h("div", { class: "panel-head" });
  const title = h("strong", {}, "Agent keys");
  const allLabel = h("label", { class: "all", hidden: "" });
  const allBox = h("input", { type: "checkbox", "data-action": "keys-all" });
  allLabel.append(allBox, " Everyone's");
  const close = h(
    "button",
    { type: "button", class: "btn icon", "data-action": "keys-close", "aria-label": "Close" },
    "×",
  );
  header.append(title, allLabel, close);

  const reveal = h("div", { class: "reveal", hidden: "", role: "status" });
  const revealText = h("p", {}, "Copy this key now. It won't be shown again.");
  const revealKey = h("code", { class: "key" });
  const copyBtn = h("button", { type: "button", class: "btn", "data-action": "keys-copy" }, "Copy");
  reveal.append(revealText, revealKey, copyBtn);

  const list = h("ul", { class: "key-list" });
  const empty = h("p", { class: "empty", hidden: "" }, "No agent keys yet.");
  const errorEl = h("p", { class: "error", role: "alert", hidden: "" });

  const form = h("form", { class: "new-key", hidden: "" });
  const nameInput = h("input", {
    type: "text",
    name: "name",
    placeholder: "Agent name, e.g. Claude Code",
    "aria-label": "Agent name",
    maxlength: "80",
  });
  const scopeRow = h("div", { class: "scopes", role: "group", "aria-label": "Permissions" });
  const expiry = h("select", { name: "expires", "aria-label": "Expires after" });
  for (const days of EXPIRY_DAYS) {
    const option = h("option", { value: String(days) }, days === 365 ? "1 year" : `${days} days`);
    if (days === 30) option.selected = true;
    expiry.append(option);
  }
  const createBtn = h("button", { type: "submit", class: "btn primary" }, "Create key");
  const formRow = h("div", { class: "row" });
  formRow.append(expiry, createBtn);
  form.append(nameInput, scopeRow, formRow);

  el.append(header, reveal, errorEl, list, empty, form);

  let isOpen = false;
  let state: ApiKeyList | null = null;
  let busy = false;
  /** Key id waiting for a second click to confirm revoking. */
  let confirming: string | null = null;

  function setError(message: string | null) {
    errorEl.hidden = message === null;
    errorEl.textContent = message ?? "";
  }

  function describeKey(key: ApiKeySummary): string {
    const t = now();
    if (key.revokedAt !== undefined) return "Revoked";
    if (key.expiresAt !== undefined && key.expiresAt <= t) return "Expired";
    const parts: string[] = [];
    if (key.expiresAt !== undefined) {
      const days = Math.max(1, Math.ceil((key.expiresAt - t) / DAY));
      parts.push(`expires in ${days} day${days === 1 ? "" : "s"}`);
    }
    parts.push(key.lastUsedAt === undefined ? "never used" : `used ${ago(t - key.lastUsedAt)}`);
    return parts.join(" · ");
  }

  function render() {
    list.replaceChildren();
    const keys = state?.keys ?? [];
    empty.hidden = keys.length > 0 || state === null;
    allLabel.hidden = !state?.admin;
    for (const key of keys) {
      const inactive =
        key.revokedAt !== undefined || (key.expiresAt !== undefined && key.expiresAt <= now());
      const item = h("li", { "data-id": key.id });
      if (inactive) item.setAttribute("data-inactive", "");
      const info = h("div", { class: "info" });
      const line = h("div", { class: "name" }, key.name);
      line.append(" ", h("code", {}, `${key.prefix}…`));
      info.append(line);
      if (allBox.checked) info.append(h("div", { class: "dim" }, `for ${key.onBehalfOf}`));
      info.append(
        h("div", { class: "dim" }, key.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(", ")),
        h("div", { class: "dim" }, describeKey(key)),
      );
      item.append(info);
      if (!inactive) {
        const confirm = confirming === key.id;
        item.append(
          h(
            "button",
            {
              type: "button",
              class: confirm ? "btn danger" : "btn",
              "data-action": "keys-revoke",
              "data-id": key.id,
              "aria-label": confirm ? `Confirm revoking ${key.name}` : `Revoke ${key.name}`,
            },
            confirm ? "Confirm" : "Revoke",
          ),
        );
      }
      list.append(item);
    }

    const grantable = state?.grantable ?? [];
    form.hidden = grantable.length === 0;
    if (scopeRow.childElementCount === 0 || scopeRow.dataset.for !== grantable.join(",")) {
      scopeRow.replaceChildren();
      scopeRow.dataset.for = grantable.join(",");
      for (const scope of grantable) {
        const label = h("label", { title: scope });
        const box = h("input", { type: "checkbox", name: "scope", value: scope });
        box.checked = DEFAULT_SCOPES.includes(scope);
        label.append(box, ` ${SCOPE_LABELS[scope] ?? scope}`);
        scopeRow.append(label);
      }
    }
    createBtn.disabled = busy;
  }

  async function refresh() {
    try {
      state = await manager.list({ all: allBox.checked });
      setError(null);
    } catch (error) {
      setError(messageOf(error, "Couldn't load agent keys"));
    }
    render();
  }

  async function create() {
    const scopes = [...scopeRow.querySelectorAll<HTMLInputElement>("input:checked")].map(
      (box) => box.value as AuthScope,
    );
    if (scopes.length === 0) {
      setError("Pick at least one permission");
      return;
    }
    busy = true;
    render();
    try {
      const input: Parameters<ApiKeyManager["create"]>[0] = {
        scopes,
        expiresInDays: Number(expiry.value),
      };
      const name = nameInput.value.trim();
      if (name) input.name = name;
      const { key } = await manager.create(input);
      revealKey.textContent = key;
      reveal.hidden = false;
      copyBtn.textContent = "Copy";
      nameInput.value = "";
      setError(null);
      await refresh();
    } catch (error) {
      setError(messageOf(error, "Couldn't create the key"));
    } finally {
      busy = false;
      render();
    }
  }

  async function revoke(id: string) {
    if (confirming !== id) {
      confirming = id;
      render();
      return;
    }
    confirming = null;
    try {
      await manager.revoke(id);
      await refresh();
    } catch (error) {
      setError(messageOf(error, "Couldn't revoke the key"));
      render();
    }
  }

  el.addEventListener("click", (e) => {
    const target = (e.target as Element).closest("[data-action]");
    const action = target?.getAttribute("data-action");
    if (action === "keys-close") panel.hide();
    else if (action === "keys-revoke") void revoke(target?.getAttribute("data-id") ?? "");
    else if (action === "keys-copy") {
      const text = revealKey.textContent ?? "";
      const clipboard = el.ownerDocument.defaultView?.navigator.clipboard;
      void clipboard?.writeText(text).then(
        () => {
          copyBtn.textContent = "Copied";
        },
        () => {
          copyBtn.textContent = "Select and copy";
        },
      );
    } else if (confirming && action !== "keys-revoke") {
      confirming = null;
      render();
    }
  });
  allBox.addEventListener("change", () => void refresh());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void create();
  });

  const panel: KeysPanel = {
    el,
    get open() {
      return isOpen;
    },
    async show() {
      isOpen = true;
      el.hidden = false;
      await refresh();
    },
    hide() {
      isOpen = false;
      el.hidden = true;
      confirming = null;
      // Don't leave a secret on screen once the panel closes.
      reveal.hidden = true;
      revealKey.textContent = "";
      setError(null);
    },
    toggle() {
      if (isOpen) {
        panel.hide();
        return Promise.resolve();
      }
      return panel.show();
    },
    refresh,
  };
  return panel;
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
