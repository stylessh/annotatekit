import {
  type Actor,
  type Comment,
  type CommentAttachment,
  isSafeAttachmentUrl,
  type Thread,
  type ThreadDetail,
  type ThreadStatus,
} from "@annotatekit/core";

/**
 * Pure DOM builders for the overlay's UI. Each takes plain data and returns
 * elements styled by `OVERLAY_CSS`; nothing here listens to events. Buttons
 * carry `data-action` attributes, and the inspector handles clicks on them by
 * delegation. The UI playground renders these same builders with mock data.
 */

export type H = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  text?: string,
) => HTMLElementTagNameMap[K];

export const elementFactory =
  (doc: Document): H =>
  (tag, attrs = {}, text) => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };

// ---- Icons ---------------------------------------------------------------

const ICONS = {
  close: "M6 6l12 12M18 6L6 18",
  attach:
    "M20.5 11.5l-8.1 8.1a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8",
  back: "M15 5l-7 7 7 7",
  send: "M5 12h13M12 5l7 7-7 7",
  chat: "M4 5h16v11H9l-5 4z",
  alert: "M12 8v5M12 16.5v.5M12 3l10 18H2z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
} as const;
export type IconName = keyof typeof ICONS;

export function icon(doc: Document, name: IconName): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(ns, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

export function iconButton(
  h: H,
  name: IconName,
  label: string,
  action: string,
  extra = "",
): HTMLButtonElement {
  const b = h("button", {
    type: "button",
    class: `btn icon ${extra}`.trim(),
    "data-action": action,
    "aria-label": label,
    title: label,
  });
  b.append(icon(b.ownerDocument, name));
  return b;
}

// ---- Formatting ----------------------------------------------------------

export const STATUS_LABELS: Record<ThreadStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  pending_review: "Needs review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

/** "now", "5m", "3h", "2d", or a short date. */
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]?.[0]}${parts.at(-1)?.[0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

function extension(name: string | undefined, mimeType: string | undefined): string {
  const ext = name?.includes(".") ? name.split(".").pop() : mimeType?.split("/").pop();
  return (ext ?? "file").slice(0, 4);
}

// ---- Small components ----------------------------------------------------

export function statusChip(h: H, status: ThreadStatus): HTMLSpanElement {
  return h("span", { class: "chip status", "data-status": status }, STATUS_LABELS[status]);
}

export function chip(h: H, text: string, opts: { mono?: boolean; title?: string } = {}) {
  const attrs: Record<string, string> = { class: opts.mono ? "chip mono" : "chip" };
  if (opts.title) attrs.title = opts.title;
  return h("span", attrs, text);
}

export function avatar(h: H, actor: Pick<Actor, "kind" | "name"> & { avatarUrl?: string }) {
  const el = h("span", { class: "avatar", "data-kind": actor.kind, "aria-hidden": "true" });
  if (actor.avatarUrl && isSafeAttachmentUrl(actor.avatarUrl)) {
    el.append(h("img", { src: actor.avatarUrl, alt: "" }));
  } else {
    el.textContent = initials(actor.name || "?");
  }
  return el;
}

/** A file waiting in a composer, before it is sent. */
export interface PendingAttachment {
  name: string;
  type: string;
  size: number;
  /** An object URL for image previews. */
  previewUrl?: string;
  uploading?: boolean;
}

type AnyAttachment =
  | (CommentAttachment & { pending?: false })
  | (PendingAttachment & { pending: true; index: number });

function attachmentEl(h: H, a: AnyAttachment): HTMLElement {
  const isImage = a.pending ? !!a.previewUrl : a.kind === "image";
  const name = a.name ?? (a.pending ? "" : a.url.split("/").pop()) ?? "";
  const src = a.pending ? a.previewUrl : a.url;
  const safe = !!src && isSafeAttachmentUrl(src);
  let el: HTMLElement;
  if (a.pending) {
    el = h("div", { class: `attachment ${isImage ? "image" : "file"}`, title: name });
    if (a.uploading) el.setAttribute("data-uploading", "");
  } else {
    el = h("a", {
      class: `attachment ${isImage && safe ? "image" : "file"}`,
      title: name,
      target: "_blank",
      rel: "noopener noreferrer",
    });
    if (safe) el.setAttribute("href", a.url);
    if (safe && a.url.startsWith("data:")) el.setAttribute("download", name || "attachment");
  }
  if (isImage && safe && src) {
    el.append(h("img", { src, alt: name, loading: "lazy" }));
  } else {
    const mime = a.pending ? a.type : a.mimeType;
    const text = h("span", { class: "file-text" });
    text.append(h("span", { class: "file-name" }, name || "Attachment"));
    const size = formatBytes(a.size);
    if (size) text.append(h("span", { class: "file-size" }, size));
    el.append(h("span", { class: "file-icon" }, extension(name, mime)), text);
  }
  if (a.pending) {
    el.append(
      h(
        "button",
        {
          type: "button",
          class: "remove",
          "data-action": "remove-file",
          "data-index": String(a.index),
          "aria-label": `Remove ${name}`,
        },
        "×",
      ),
    );
  }
  return el;
}

/** Attachments on a sent comment: images as thumbnails, other files as cards. */
export function attachmentList(h: H, list: CommentAttachment[]): HTMLElement {
  const el = h("div", { class: list.length === 1 ? "attachments single" : "attachments" });
  el.append(...list.map((a) => attachmentEl(h, a)));
  return el;
}

/** Files picked in a composer, each with a remove button. */
export function attachmentTray(h: H, files: PendingAttachment[]): HTMLElement {
  const el = h("div", { class: "attachments tray" });
  el.hidden = files.length === 0;
  el.append(...files.map((f, index) => attachmentEl(h, { ...f, pending: true, index })));
  return el;
}

// ---- Messages ------------------------------------------------------------

export interface MessageOptions {
  now: number;
  reply?: boolean;
  /** The viewer's id, to label their own messages "You". */
  meId?: string;
}

const isSystem = (c: Comment) => c.metadata?.system === true;

export function messageItem(h: H, comment: Comment, opts: MessageOptions): HTMLLIElement {
  if (isSystem(comment)) {
    const li = h("li", { class: "event", "data-id": comment.id });
    li.append(
      h(
        "span",
        {},
        comment.body.replace(/\b(in_progress|pending_review)\b/g, (m) =>
          STATUS_LABELS[m as ThreadStatus].toLowerCase(),
        ),
      ),
      h("time", { datetime: comment.createdAt }, relativeTime(comment.createdAt, opts.now)),
    );
    return li;
  }
  const li = h("li", { class: opts.reply ? "msg reply" : "msg", "data-id": comment.id });
  const head = h("div", { class: "msg-head" });
  const name = opts.meId && comment.author.id === opts.meId ? "You" : comment.author.name;
  head.append(h("span", { class: "name" }, name));
  if (comment.author.kind === "agent") head.append(h("span", { class: "chip agent" }, "Agent"));
  const time = h(
    "time",
    { datetime: comment.createdAt },
    relativeTime(comment.createdAt, opts.now),
  );
  if (comment.editedAt) time.textContent += " · edited";
  head.append(time);
  li.append(avatar(h, comment.author), head, h("div", { class: "msg-body" }, comment.body));
  if (comment.attachments?.length) li.append(attachmentList(h, comment.attachments));
  return li;
}

/** The first message, then its replies, with status changes inline as events. */
export function messageList(h: H, comments: Comment[], opts: Omit<MessageOptions, "reply">) {
  const ol = h("ol", { class: "messages" });
  const [first, ...rest] = comments;
  if (!first) return ol;
  ol.append(messageItem(h, first, opts));
  const replies = rest.filter((c) => !isSystem(c)).length;
  if (replies) {
    ol.append(h("li", { class: "replies-label" }, `${replies} repl${replies === 1 ? "y" : "ies"}`));
  }
  for (const c of rest) ol.append(messageItem(h, c, { ...opts, reply: true }));
  return ol;
}

// ---- States --------------------------------------------------------------

export function emptyState(
  h: H,
  opts: {
    title: string;
    body?: string;
    icon?: IconName;
    action?: { label: string; action: string };
  },
) {
  const el = h("div", { class: "state" });
  const glyph = h("span", { class: "glyph" });
  glyph.append(icon(el.ownerDocument, opts.icon ?? "chat"));
  el.append(glyph, h("strong", {}, opts.title));
  if (opts.body) el.append(h("p", {}, opts.body));
  if (opts.action) {
    el.append(
      h(
        "button",
        { type: "button", class: "btn", "data-action": opts.action.action },
        opts.action.label,
      ),
    );
  }
  return el;
}

export function loadingState(h: H, label = "Loading"): HTMLElement {
  const el = h("div", { class: "skeleton", role: "status", "aria-label": label });
  el.append(
    h("div", { class: "bone line" }),
    h("div", { class: "bone" }),
    h("div", { class: "bone short" }),
    h("div", { class: "bone short" }),
  );
  return el;
}

// ---- Composers -----------------------------------------------------------

export interface ComposerParts {
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  fileInput: HTMLInputElement;
  tray: HTMLElement;
  error: HTMLElement;
  submit: HTMLButtonElement;
}

/**
 * A text field with an attachment tray, an attach button and a send button.
 * Used for new annotations (`variant: "new"`) and replies (`"reply"`).
 */
export function composerParts(
  h: H,
  variant: "new" | "reply",
  opts: { attachments?: boolean } = {},
): ComposerParts {
  const form = h("form", { class: variant === "reply" ? "reply" : "new" });
  const field = h("div", { class: "field" });
  const textarea = h("textarea", {
    placeholder: variant === "reply" ? "Reply…" : "Leave a note…",
    "aria-label": variant === "reply" ? "Reply" : "Annotation",
    rows: variant === "reply" ? "1" : "3",
  });
  const tray = attachmentTray(h, []);
  field.append(textarea, tray);
  const fileInput = h("input", {
    type: "file",
    class: "file-input",
    multiple: "",
    tabindex: "-1",
    "aria-hidden": "true",
  });
  const row = h("div", { class: "row" });
  if (opts.attachments !== false) {
    row.append(iconButton(h, "attach", "Attach files", "attach", "ghost"));
  }
  row.append(h("span", { class: "hint" }, variant === "reply" ? "" : "↵ save · ⇧↵ newline"));
  if (variant === "new") {
    row.append(
      h("button", { type: "button", class: "btn ghost", "data-action": "cancel" }, "Cancel"),
    );
  }
  const submit = h(
    "button",
    { type: "submit", class: "btn primary" },
    variant === "reply" ? "Send" : "Save",
  );
  // Thread status buttons go here, next to Send.
  if (variant === "reply") row.append(h("span", { class: "slot" }));
  row.append(submit);
  const error = h("p", { class: "form-error", role: "alert" });
  form.append(field, error, row, fileInput);
  return { form, textarea, fileInput, tray, error, submit };
}

// ---- Panels --------------------------------------------------------------

export interface ThreadListItem {
  thread: Thread;
  /** The number on its pin. */
  label: string;
}

export type ThreadListView =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; items: ThreadListItem[]; now: number };

/** The "Threads on this page" panel body. */
export function threadListPanel(h: H, view: ThreadListView): HTMLElement[] {
  const head = h("div", { class: "panel-head" });
  head.append(
    h("strong", {}, "Threads on this page"),
    iconButton(h, "close", "Close", "panel-close", "ghost"),
  );
  if (view.state === "loading") return [head, loadingState(h, "Loading threads")];
  if (view.state === "error") {
    return [
      head,
      emptyState(h, {
        title: "Couldn't load threads",
        body: view.message,
        icon: "alert",
        action: { label: "Try again", action: "retry" },
      }),
    ];
  }
  if (!view.items.length) {
    return [
      head,
      emptyState(h, {
        title: "No threads yet",
        body: "Turn on Annotate, then click anything on the page to start a thread.",
      }),
    ];
  }
  const ul = h("ul", { class: "thread-list" });
  for (const { thread, label } of view.items) {
    const li = h("li");
    const item = h("button", {
      type: "button",
      class: "item",
      "data-action": "open-thread",
      "data-id": thread.id,
    });
    if (thread.status === "resolved" || thread.status === "dismissed")
      item.setAttribute("data-closed", "");
    const sub = [
      thread.createdBy.name,
      `${thread.commentCount} message${thread.commentCount === 1 ? "" : "s"}`,
      relativeTime(thread.lastCommentAt ?? thread.updatedAt, view.now),
    ].join(" · ");
    item.append(
      h("span", { class: "num" }, label),
      h("span", { class: "item-title" }, thread.title || "Untitled"),
      statusChip(h, thread.status),
      h("span", { class: "item-sub" }, sub),
    );
    li.append(item);
    ul.append(li);
  }
  return [head, ul];
}

export type ThreadView =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; detail: ThreadDetail; now: number; meId?: string; busy?: boolean };

/** Which status buttons a thread offers, by its status. */
export function threadActions(
  status: ThreadStatus,
): { label: string; action: string; primary?: boolean }[] {
  switch (status) {
    case "pending_review":
      return [
        { label: "Reopen", action: "reopen" },
        { label: "Approve", action: "approve", primary: true },
      ];
    case "resolved":
    case "dismissed":
      return [{ label: "Reopen", action: "reopen" }];
    default:
      return [{ label: "Resolve", action: "resolve" }];
  }
}

/**
 * A thread: header with status, capture context, messages and replies, a reply
 * composer and status actions. Pass the composer from {@link composerParts}
 * so typed text survives re-renders.
 */
export function threadPanel(h: H, view: ThreadView, composer?: HTMLFormElement): HTMLElement[] {
  const head = h("div", { class: "panel-head" });
  head.append(iconButton(h, "back", "All threads", "back", "ghost"));
  if (view.state !== "ready") {
    head.append(h("span", { class: "title" }, view.state === "loading" ? "" : "Thread"));
    head.append(iconButton(h, "close", "Close", "panel-close", "ghost"));
    const body = h("div", { class: "thread-body" });
    body.append(
      view.state === "loading"
        ? loadingState(h, "Loading thread")
        : emptyState(h, {
            title: "Couldn't load this thread",
            body: view.message,
            icon: "alert",
            action: { label: "Try again", action: "retry" },
          }),
    );
    return [head, body];
  }
  const { thread, annotation, comments } = view.detail;
  head.append(
    h("span", { class: "title", title: thread.title ?? "" }, thread.title || "Untitled"),
    statusChip(h, thread.status),
    iconButton(h, "close", "Close", "panel-close", "ghost"),
  );
  const meta = h("div", { class: "thread-meta" });
  const ctx = annotation?.context;
  if (annotation)
    meta.append(
      chip(h, annotation.anchor.selector, { mono: true, title: annotation.anchor.selector }),
    );
  if (ctx?.breakpoint) meta.append(chip(h, `${ctx.breakpoint.name} · ${ctx.viewport.width}px`));
  else if (ctx) meta.append(chip(h, `${ctx.viewport.width}px`));

  const body = h("div", { class: "thread-body" });
  body.append(
    comments.length
      ? messageList(h, comments, { now: view.now, ...(view.meId ? { meId: view.meId } : {}) })
      : emptyState(h, { title: "No messages yet", body: "Start the conversation below." }),
  );

  const foot = h("div", { class: "thread-foot" });
  const slot = composer?.querySelector(".slot");
  const actions = slot ?? h("div", { class: "thread-actions" });
  actions.replaceChildren();
  for (const a of threadActions(thread.status)) {
    const b = h(
      "button",
      {
        type: "button",
        class: slot || !a.primary ? "btn" : "btn primary",
        "data-action": a.action,
      },
      a.label,
    );
    if (view.busy) b.disabled = true;
    actions.append(b);
  }
  if (composer) foot.append(composer);
  if (!slot) foot.append(actions);
  return meta.childElementCount ? [head, meta, body, foot] : [head, body, foot];
}

// ---- Toolbar ---------------------------------------------------------------

export interface ToolbarParts {
  el: HTMLElement;
  toggle: HTMLButtonElement;
  modes: HTMLElement;
  element: HTMLButtonElement;
  area: HTMLButtonElement;
  text: HTMLButtonElement;
  bp: HTMLElement;
  threads: HTMLButtonElement;
  badge: HTMLElement;
  keys: HTMLButtonElement | null;
}

export interface ToolbarState {
  active: boolean;
  mode: "element" | "area" | "text";
  /** e.g. `xl · 1280px` */
  breakpoint: string;
  /** Show the threads button. */
  threads: boolean;
  threadsOpen?: boolean;
  /** Unresolved threads, shown as a badge. */
  unresolved?: number;
  keysOpen?: boolean;
}

/** The floating toolbar's elements. Update them with {@link renderToolbarState}. */
export function toolbarParts(h: H, opts: { keys?: boolean } = {}): ToolbarParts {
  const el = h("div", { class: "toolbar", role: "toolbar", "aria-label": "AnnotateKit" });
  const toggle = h(
    "button",
    { type: "button", class: "btn", "data-action": "toggle", "aria-pressed": "false" },
    "Annotate",
  );
  const mode = (name: string, title: string) =>
    h(
      "button",
      { type: "button", class: "btn", "data-action": `mode-${name.toLowerCase()}`, title },
      name,
    );
  const element = mode("Element", "Click to pin");
  const area = mode("Area", "Drag to box an area");
  const text = mode("Text", "Select text to quote it");
  const modes = h("div", { class: "modes", role: "group", "aria-label": "Mode" });
  modes.append(element, area, text);
  const bp = h("span", { class: "bp", "aria-live": "polite" });
  const threads = h("button", {
    type: "button",
    class: "btn",
    "data-action": "threads",
    "aria-pressed": "false",
    title: "Threads on this page",
  });
  const badge = h("span", { class: "badge" });
  threads.append(icon(el.ownerDocument, "list"), h("span", {}, "Threads"), badge);
  el.append(toggle, modes, bp, threads);
  let keys: HTMLButtonElement | null = null;
  if (opts.keys) {
    keys = h(
      "button",
      {
        type: "button",
        class: "btn",
        "data-action": "keys",
        "aria-pressed": "false",
        title: "Agent API keys",
      },
      "Keys",
    );
    el.append(keys);
  }
  return { el, toggle, modes, element, area, text, bp, threads, badge, keys };
}

export function renderToolbarState(parts: ToolbarParts, state: ToolbarState): void {
  parts.toggle.setAttribute("aria-pressed", String(state.active));
  parts.toggle.textContent = state.active ? "Done" : "Annotate";
  parts.modes.hidden = !state.active;
  parts.element.setAttribute("aria-pressed", String(state.mode === "element"));
  parts.area.setAttribute("aria-pressed", String(state.mode === "area"));
  parts.text.setAttribute("aria-pressed", String(state.mode === "text"));
  parts.bp.textContent = state.breakpoint;
  parts.threads.hidden = !state.threads;
  parts.threads.setAttribute("aria-pressed", String(!!state.threadsOpen));
  parts.badge.hidden = !state.unresolved;
  parts.badge.textContent = String(state.unresolved ?? 0);
  parts.keys?.setAttribute("aria-pressed", String(!!state.keysOpen));
}

// ---- Pins ------------------------------------------------------------------

export interface PinState {
  label: string;
  status?: ThreadStatus;
  kind?: "pin" | "region" | "element";
  /** Elements in a group; a badge shows when more than one. */
  count?: number;
  /** Group color. */
  color?: string;
  draft?: boolean;
  focused?: boolean;
}

/** Sets a pin button's content, state attributes and accessible name. */
export function applyPin(h: H, pin: HTMLButtonElement, state: PinState): void {
  pin.textContent = state.label;
  const count = state.count ?? 0;
  if (count > 1) pin.append(h("span", { class: "count" }, String(count)));
  pin.dataset.status = state.status ?? "open";
  pin.dataset.kind = state.kind ?? "pin";
  pin.toggleAttribute("data-draft", !!state.draft);
  if (state.color) pin.style.setProperty("--ak-pin", state.color);
  else pin.style.removeProperty("--ak-pin");
  pin.setAttribute("aria-pressed", String(!!state.focused));
  const status = state.status ? ` (${STATUS_LABELS[state.status].toLowerCase()})` : "";
  pin.setAttribute(
    "aria-label",
    `Annotation ${state.label}${count > 1 ? `, ${count} elements` : ""}${status}`,
  );
}

export function pinButton(h: H, state: PinState): HTMLButtonElement {
  const pin = h("button", { type: "button", class: "pin" });
  applyPin(h, pin, state);
  return pin;
}
