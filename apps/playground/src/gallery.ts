// The UI playground: every overlay component in every state, rendered with the
// same builders the inspector uses, plus a live overlay on mock data.
// Run it with `pnpm ui` from the repo root.
import {
  type Actor,
  type ApiKeyManager,
  type ApiKeySummary,
  type CommentAttachment,
  createAnnotateKitService,
  createMemoryStorage,
  pageContextFromUrl,
  type ThreadStatus,
} from "@annotatekit/core";
import {
  bindService,
  createInspector,
  createKeysPanel,
  loadOverlayFont,
  OVERLAY_CSS,
  ui,
} from "@annotatekit/inspector";
import {
  comment,
  conversation,
  event,
  files,
  images,
  listItems,
  NOW,
  people,
  thread,
  annotation as threadAnnotation,
} from "./gallery-data.js";

type Theme = "light" | "dark" | "vivid";
let theme: Theme = "light";
/** Empty means the neutral, grayscale default. */
let accent = "";
const hosts: HTMLElement[] = [];
const h = ui.elementFactory(document);
loadOverlayFont(document);

// ---- Scaffolding -------------------------------------------------------------

/** A static overlay host: a shadow root with the overlay's CSS, in gallery mode. */
function overlay(...content: Node[]): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-static", "");
  host.setAttribute("data-theme", theme);
  if (accent) host.style.setProperty("--ak-accent", accent);
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  root.append(style, ...content);
  hosts.push(host);
  return host;
}

function specimen(caption: string, note: string, nodes: Node[], center = false): HTMLElement {
  const fig = h("figure", { class: "g-specimen" });
  const stage = h("div", { class: center ? "g-stage center" : "g-stage" });
  stage.append(...nodes);
  const cap = h("figcaption");
  cap.append(h("b", {}, caption), note ? ` · ${note}` : "");
  fig.append(stage, cap);
  return fig;
}

const main = document.getElementById("gallery") as HTMLElement;
const nav = document.getElementById("nav") as HTMLElement;

function section(id: string, title: string, intro: string, items: HTMLElement[], min?: string) {
  const el = h("section", { class: "g-section", id });
  const grid = h("div", { class: "g-grid" });
  if (min) grid.style.setProperty("--min", min);
  grid.append(...items);
  el.append(h("h2", {}, title), h("p", {}, intro), grid);
  main.append(el);
  nav.append(h("a", { href: `#${id}` }, title));
}

// ---- Toolbar -----------------------------------------------------------------

function toolbar(state: Partial<ui.ToolbarState>, keys = false) {
  const parts = ui.toolbarParts(h, { keys });
  ui.renderToolbarState(parts, {
    active: false,
    mode: "element",
    breakpoint: "xl · 1280px",
    threads: true,
    unresolved: 3,
    ...state,
  });
  return overlay(parts.el);
}

section(
  "toolbar",
  "Toolbar",
  "One pill that morphs as controls appear. Hover the device icon for the breakpoint. Icons: Phosphor.",
  [
    specimen("Idle", "inspector off, 3 open threads", [toolbar({})], true),
    specimen("Element mode", "inspecting", [toolbar({ active: true })], true),
    specimen("Text mode", "with agent keys", [toolbar({ active: true, mode: "text" }, true)], true),
    specimen(
      "Threads open",
      "nothing unresolved",
      [toolbar({ threadsOpen: true, unresolved: 0 })],
      true,
    ),
  ],
  "460px",
);

// ---- Pins ----------------------------------------------------------------------

function pins(states: (ui.PinState & { note?: string })[]) {
  const row = h("div");
  row.style.cssText = "display:flex;gap:22px;align-items:center;padding:8px 4px 0";
  for (const s of states) row.append(ui.pinButton(h, s));
  return overlay(row);
}
const label = h("div", { class: "label" });
label.append("button.btn.btn--primary ", h("span", { class: "dim" }, "148×44"));
const hl = h("div");
hl.style.cssText =
  "width:180px;height:56px;border-radius:6px;outline:1.5px solid var(--ak-accent);outline-offset:-1px;background:color-mix(in srgb,var(--ak-accent) 10%,transparent);margin-top:8px";

section("pins", "Pins and marks", "Pins sit on the page where feedback was left.", [
  specimen(
    "Statuses",
    "open · in progress · needs review · resolved · dismissed",
    [
      pins([
        { label: "1" },
        { label: "2", status: "in_progress" },
        { label: "3", status: "pending_review" },
        { label: "4", status: "resolved" },
        { label: "5", status: "dismissed" },
      ]),
    ],
    true,
  ),
  specimen(
    "Kinds",
    "region · group of 3 · group color · draft · focused",
    [
      pins([
        { label: "6", kind: "region" },
        { label: "7", kind: "region", count: 3 },
        { label: "8", color: "#e11d48" },
        { label: "9", draft: true },
        { label: "10", focused: true },
      ]),
    ],
    true,
  ),
  specimen("Hover", "element highlight with its label", [overlay(label, hl)]),
]);

// ---- Chips and buttons -------------------------------------------------------------

const statuses: ThreadStatus[] = ["open", "in_progress", "pending_review", "resolved", "dismissed"];
const chipRow = h("div");
chipRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
chipRow.append(
  ...statuses.map((s) => ui.statusChip(h, s)),
  ui.chip(h, "md · 768px"),
  ui.chip(h, 'section.hero [data-testid="cta"]', { mono: true }),
);
const buttonRow = h("div");
buttonRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center";
const disabled = h("button", { type: "button", class: "btn" }, "Disabled");
disabled.disabled = true;
buttonRow.append(
  h("button", { type: "button", class: "btn primary" }, "Primary"),
  h("button", { type: "button", class: "btn" }, "Default"),
  h("button", { type: "button", class: "btn ghost" }, "Ghost"),
  h("button", { type: "button", class: "btn danger" }, "Revoke"),
  disabled,
  ui.iconButton(h, "attach", "Attach", "attach"),
  ui.iconButton(h, "close", "Close", "close", "ghost"),
);
const avatarRow = h("div");
avatarRow.style.cssText = "display:flex;gap:8px";
avatarRow.append(...Object.values(people).map((p) => ui.avatar(h, p)));

function surface(...nodes: Node[]) {
  const el = h("div", { class: "panel" });
  el.style.setProperty("--ak-panel-width", "100%");
  el.append(...nodes);
  return overlay(el);
}

section("primitives", "Chips, buttons, avatars", "Low-opacity fills of the foreground color.", [
  specimen("Status chips", "and context chips", [surface(chipRow)]),
  specimen("Buttons", "pill shaped, flat", [surface(buttonRow)]),
  specimen("Avatars", "people are round, agents are squircles", [surface(avatarRow)]),
]);

// ---- Composers ---------------------------------------------------------------------

function newComposer(opts: {
  text?: string;
  meta: string;
  mono?: boolean;
  files?: ui.PendingAttachment[];
}) {
  const parts = ui.composerParts(h, "new");
  parts.form.classList.add("composer");
  const meta = h("div", { class: "meta" });
  meta.append(ui.chip(h, opts.meta, { mono: opts.mono ?? true }));
  parts.form.prepend(meta);
  parts.textarea.value = opts.text ?? "";
  if (opts.files) parts.tray.replaceWith(ui.attachmentTray(h, opts.files));
  return overlay(parts.form);
}
function replyComposer(opts: { text?: string; error?: string; files?: ui.PendingAttachment[] }) {
  const panel = h("section", { class: "panel" });
  panel.style.setProperty("--ak-panel-width", "360px");
  const parts = ui.composerParts(h, "reply");
  parts.textarea.value = opts.text ?? "";
  if (opts.error) parts.error.textContent = opts.error;
  if (opts.files) parts.tray.replaceWith(ui.attachmentTray(h, opts.files));
  panel.append(parts.form);
  return overlay(panel);
}
const pendingImage = (i: number, uploading = false): ui.PendingAttachment => {
  const img = images[i] as CommentAttachment;
  const p: ui.PendingAttachment = {
    name: img.name ?? "",
    type: "image/png",
    size: img.size ?? 0,
    previewUrl: img.url,
  };
  if (uploading) p.uploading = true;
  return p;
};
const pendingFile: ui.PendingAttachment = {
  name: "hero-spacing.pdf",
  type: "application/pdf",
  size: 1_240_000,
};

section(
  "composer",
  "Composers",
  "New annotations and replies. Attach with the paperclip, paste an image, or drop files.",
  [
    specimen("New annotation", "empty", [newComposer({ meta: "button.btn.btn--primary" })]),
    specimen("New annotation", "text quote with attachments", [
      newComposer({
        meta: "“Ship feedback, not screenshots”",
        mono: false,
        text: "Headline feels heavy at md. Try 600 instead of 700?",
        files: [pendingImage(0), pendingFile],
      }),
    ]),
    specimen("Reply", "uploading an image", [
      replyComposer({ text: "Here's the phone version", files: [pendingImage(1, true)] }),
    ]),
    specimen("Reply", "error", [
      replyComposer({ text: "Approved!", error: "hero-video.mov is larger than 512 KB" }),
    ]),
  ],
  "360px",
);

// ---- Messages ------------------------------------------------------------------------

function messages(list: ReturnType<typeof comment>[]) {
  const panel = h("section", { class: "panel" });
  panel.style.setProperty("--ak-panel-width", "380px");
  panel.append(ui.messageList(h, list, { now: NOW, meId: people.alan.id }));
  return overlay(panel);
}
section(
  "messages",
  "Messages",
  "A feedback thread, not a chat: the note first, then replies and status changes on a rail.",
  [
    specimen("Text only", "", [
      messages([comment(people.maya, "The pricing cards don't line up at lg.", 12)]),
    ]),
    specimen("With an image", "single images show large", [
      messages([
        comment(people.maya, "See how the CTA wraps:", 30, {
          attachments: [images[0] as CommentAttachment],
        }),
      ]),
    ]),
    specimen("Several images and files", "thumbnails and file cards", [
      messages([
        comment(people.jo, "All three breakpoints, plus the spec.", 60, {
          attachments: [...images, ...files],
        }),
      ]),
    ]),
    specimen("Agent reply and events", "your own messages read “You”", [
      messages([
        comment(people.alan, "Can you fix the link color?", 200),
        event(people.claude, "Claude started working on this", 90, "status", "in_progress"),
        comment(people.claude, "Switched links to `--brand-600`. Ready for review.", 80),
        event(people.claude, "Claude proposed a fix for review", 79, "status", "pending_review"),
        comment(people.maya, "Looks right to me.", 2, {
          editedAt: new Date(NOW - 60_000).toISOString(),
        }),
      ]),
    ]),
  ],
);

// ---- Thread panel ------------------------------------------------------------------

function threadPanel(view: ui.ThreadView, composerText = "") {
  const el = h("section", { class: "panel threads thread" });
  const reply = ui.composerParts(h, "reply");
  reply.textarea.value = composerText;
  el.append(...ui.threadPanel(h, view, view.state === "ready" ? reply.form : undefined));
  return overlay(el);
}
const ready = (detail: ReturnType<typeof conversation>): ui.ThreadView => ({
  state: "ready",
  detail,
  now: NOW,
  meId: people.alan.id,
});
const single = (status: ThreadStatus, body: string) => ({
  thread: thread("thr_2", "Pricing cards misaligned", status, { count: 1, by: people.alan }),
  annotation: threadAnnotation("thr_2", "#pricing > article.card:nth-of-type(2)"),
  comments: [comment(people.alan, body, 40)],
});

section(
  "thread",
  "Thread panel",
  "Opens when a pin is clicked: the note, where it was left, replies and status changes on one timeline. Status actions are icons in the header.",
  [
    specimen("Needs review", "an agent proposed a fix", [threadPanel(ready(conversation()))]),
    specimen("Open", "just one message", [
      threadPanel(ready(single("open", "Cards 2 and 3 are 4px lower than card 1 at lg.")), "On it"),
    ]),
    specimen("Resolved", "", [threadPanel(ready(single("resolved", "Typo: “Scael” → “Scale”.")))]),
    specimen("No messages", "a pin dropped before typing", [
      threadPanel(ready({ ...single("open", ""), comments: [] })),
    ]),
    specimen("Loading", "", [threadPanel({ state: "loading" })]),
    specimen("Error", "", [
      threadPanel({ state: "error", message: "The server didn't answer (502)." }),
    ]),
  ],
  "380px",
);

// ---- Thread list ---------------------------------------------------------------------

function listPanel(view: ui.ThreadListView) {
  const el = h("section", { class: "panel threads" });
  el.append(...ui.threadListPanel(h, view));
  return overlay(el);
}
section(
  "list",
  "Threads on this page",
  "The toolbar's Threads button opens this list.",
  [
    specimen("Threads", "numbered like their pins", [
      listPanel({ state: "ready", items: listItems(), now: NOW }),
    ]),
    specimen("Empty", "", [listPanel({ state: "ready", items: [], now: NOW })]),
    specimen("Loading", "", [listPanel({ state: "loading" })]),
    specimen("Error", "", [listPanel({ state: "error", message: "You're offline." })]),
  ],
  "380px",
);

// ---- Agent keys --------------------------------------------------------------------------

const DAY = 86_400_000;
const keys: ApiKeySummary[] = [
  {
    id: "key_1",
    prefix: "ak_live_7Hc2",
    name: "Claude Code",
    onBehalfOf: people.alan.id,
    scopes: ["annotations:read", "annotations:write", "annotations:resolve"],
    createdAt: NOW - 3 * DAY,
    expiresAt: NOW + 27 * DAY,
    lastUsedAt: NOW - 3_600_000,
  },
  {
    id: "key_2",
    prefix: "ak_live_q9Lm",
    name: "CI triage bot",
    onBehalfOf: people.alan.id,
    scopes: ["annotations:read"],
    createdAt: NOW - 40 * DAY,
    revokedAt: NOW - 2 * DAY,
  },
];
const manager: ApiKeyManager = {
  list: async () => ({
    keys,
    grantable: ["annotations:read", "annotations:write", "annotations:resolve"],
    admin: false,
  }),
  create: async () => {
    throw new Error("Read-only in the gallery");
  },
  revoke: async () => {},
};
const keysPanel = createKeysPanel(h, manager, () => NOW);
keysPanel.el.style.setProperty("--ak-panel-width", "380px");
void keysPanel.show();
section(
  "keys",
  "Agent keys",
  "Mint and revoke API keys for coding agents.",
  [specimen("Keys", "one active, one revoked", [overlay(keysPanel.el)])],
  "380px",
);

// ---- Live overlay ------------------------------------------------------------------------

const live = h("section", { class: "g-section", id: "live" });
const demo = h("div", { class: "g-live" });
const cards = [
  ["Starter", "For side projects.", "Choose Starter"],
  ["Team", "Feedback for the whole team.", "Choose Team"],
  ["Scale", "SSO, audit logs, agents.", "Talk to us"],
] as const;
for (const [name, text, cta] of cards) {
  const card = h("article", { "data-plan": name.toLowerCase() });
  card.append(h("h3", {}, name), h("p", {}, text), h("button", { type: "button" }, cta));
  demo.append(card);
}
live.append(
  h("h2", {}, "Live overlay"),
  h(
    "p",
    {},
    "The real inspector on an in-memory backend. Click a pin to open its thread, reply with attachments, or press Annotate to add your own.",
  ),
  demo,
);
main.append(live);
nav.append(h("a", { href: "#live" }, "Live overlay"));

const me: Actor = people.alan;
const service = createAnnotateKitService({ storage: createMemoryStorage() });
const inspector = createInspector({ theme, ignore: ".g-top, .g-nav" });

async function seed() {
  const page = pageContextFromUrl(location.href, document.title);
  const viewport = { width: innerWidth, height: innerHeight, devicePixelRatio: devicePixelRatio };
  const at = async (
    sel: string,
    who: Actor,
    body: string,
    extra: Partial<CommentAttachment>[] = [],
  ) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    const { anchor } = inspector.capture(el);
    return service.createThread(who, {
      projectId: "gallery",
      page,
      title: body.split(".")[0] ?? body,
      annotation: { kind: "pin", anchor, position: { x: 0.92, y: 0.15 }, context: { viewport } },
      comment: { body, format: "plain", attachments: extra as CommentAttachment[] },
    });
  };
  const a = await at(
    '[data-plan="team"] button',
    people.maya,
    "Make this the primary CTA. It's our most popular plan.",
    [images[0] as CommentAttachment],
  );
  await service.addComment(people.alan, a.thread.id, {
    body: "Agreed, will swap the styles.",
    format: "plain",
  });
  await service.addComment(people.claude, a.thread.id, {
    body: "Swapped the button variants and moved the badge. Proposed for review.",
    format: "plain",
    attachments: [files[1] as CommentAttachment],
  });
  await service.setThreadStatus(people.claude, a.thread.id, { status: "in_progress" });
  await at('[data-plan="scale"] h3', people.jo, "Can we say “Enterprise” here?");
}
await seed();
bindService(inspector, { service, projectId: "gallery", actor: me });

// ---- Theme and accent controls ---------------------------------------------------------------

const ACCENTS = ["", "#2d2dd8", "#7c3aed", "#e11d48", "#0f766e", "#ea580c"];
const accentsEl = document.getElementById("accents") as HTMLElement;
const overlayHost = () => document.querySelector<HTMLElement>("[data-annotatekit-overlay]");

function apply() {
  document.body.dataset.theme = theme;
  if (accent) document.body.style.setProperty("--g-accent", accent);
  else document.body.style.removeProperty("--g-accent");
  const live = overlayHost();
  for (const host of [...hosts, ...(live ? [live] : [])]) {
    host.setAttribute("data-theme", theme);
    if (accent) host.style.setProperty("--ak-accent", accent);
    else host.style.removeProperty("--ak-accent");
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("#themes button")) {
    b.setAttribute("aria-pressed", String(b.dataset.theme === theme));
  }
  for (const b of accentsEl.querySelectorAll<HTMLButtonElement>("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.color === accent));
  }
  const params = new URLSearchParams(location.search);
  params.set("theme", theme);
  if (accent) params.set("accent", accent.slice(1));
  else params.delete("accent");
  history.replaceState(null, "", `?${params}${location.hash}`);
}
for (const color of ACCENTS) {
  const b = h("button", {
    type: "button",
    "data-color": color,
    "aria-label": color ? `Accent ${color}` : "Neutral",
  });
  b.style.setProperty("--c", color || "linear-gradient(135deg, #18181b 50%, #d4d4d8 50%)");
  b.onclick = () => {
    accent = color;
    apply();
  };
  accentsEl.append(b);
}
for (const b of document.querySelectorAll<HTMLButtonElement>("#themes button")) {
  b.onclick = () => {
    theme = b.dataset.theme as Theme;
    apply();
  };
}
const params = new URLSearchParams(location.search);
const t = params.get("theme");
if (t === "light" || t === "dark" || t === "vivid") theme = t;
const c = params.get("accent");
if (c && /^[0-9a-f]{6}$/i.test(c)) accent = `#${c}`;
apply();

Object.assign(window, { inspector, service });
