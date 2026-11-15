import type { Point } from "@annotatekit/core";
import {
  clientRect,
  composedChildren,
  composedContains,
  composedParent,
  deepElementFromPoint,
  frameDocuments,
  frameOffset,
} from "../capture/scope.js";
import { resolveAnchor } from "../capture/selector.js";
import { type CaptureOptions, Capturer } from "../capture/snapshot.js";
import { quoteFromRange, rangeFromQuote } from "../capture/text-range.js";
import type { AnnotationDraft, ElementSnapshot, RenderableAnnotation } from "../types.js";
import { OVERLAY_CSS } from "./styles.js";

/** `element`: click to pin, drag to box. `area`: drag only. `text`: select text to quote it. */
export type InspectMode = "element" | "area" | "text";

export interface InspectorOptions extends CaptureOptions {
  /** Where the overlay host is appended. Defaults to `document.body`. */
  container?: HTMLElement;
  /** Start in inspect mode. Default false. */
  active?: boolean;
  /** `element` (default): click to pin, drag to box. `area`: only dragging does anything. `text`: select text. */
  mode?: InspectMode;
  /** Elements matching this selector, and their children, can't be picked. */
  ignore?: string;
  /** Show the floating toolbar. Default true. */
  toolbar?: boolean;
  /** Toggle shortcut as `Mod+…+KeyboardEvent.code`. Default `"Alt+KeyA"`. `false` disables it. */
  shortcut?: string | false;
  theme?: "light" | "dark" | "auto";
  accentColor?: string;
  annotations?: RenderableAnnotation[];
  /** Keep a provisional pin for each saved draft until the next `setAnnotations()`. Default true. */
  showDraftPins?: boolean;
  onCreate?: (draft: AnnotationDraft) => void;
  onSelect?: (id: string) => void;
  onActiveChange?: (active: boolean) => void;
  doc?: Document;
}

export type InspectorEvents = {
  create: AnnotationDraft;
  select: string;
  activechange: boolean;
  hover: ElementSnapshot | null;
};
type Listener<T> = (payload: T) => void;

export interface Inspector {
  readonly active: boolean;
  readonly mode: InspectMode;
  activate(): void;
  deactivate(): void;
  toggle(): void;
  setMode(mode: InspectMode): void;
  setAnnotations(list: RenderableAnnotation[]): void;
  /** Outline an annotation's targets, e.g. while its thread is open in your UI. */
  focusAnnotation(id: string | null): void;
  /** Capture an element without any UI, e.g. for agents or tests. */
  capture(el: Element): ElementSnapshot;
  on<K extends keyof InspectorEvents>(event: K, fn: Listener<InspectorEvents[K]>): () => void;
  /** Re-read stylesheets; call after CSS loads dynamically. */
  refreshStyles(): void;
  destroy(): void;
}

const DRAG_THRESHOLD = 6;
const MAX_AREA_TARGETS = 24;
const PIN_SIZE = 24;
const HOST_ATTR = "data-annotatekit-overlay";
const ACTIVE_ATTR = "data-annotatekit-inspecting";
const PAGE_CSS = `[${ACTIVE_ATTR}], [${ACTIVE_ATTR}] * { cursor: crosshair !important; }
[${ACTIVE_ATTR}="text"], [${ACTIVE_ATTR}="text"] * { cursor: text !important; }`;
const SWALLOWED = ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"] as const;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A draft being composed: everything but the comment and the capture context. */
interface Pending {
  draft: Omit<AnnotationDraft, "comment" | "context" | "page">;
  anchorSnap: ElementSnapshot;
}

const elementFactory =
  (doc: Document) =>
  <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };

function place(el: HTMLElement, r: Box) {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}

function unionRect(rects: DOMRect[]): Box {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

function commonAncestor(els: Element[], root: Document): Element | null {
  const [first, ...rest] = els;
  let node: Element | null = first ?? null;
  while (node && !rest.every((e) => node && composedContains(node, e, root))) {
    node = composedParent(node, root);
  }
  return node;
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = Array.from(el.classList)
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join("");
  return `${tag}${id}${cls}`;
}

function matchesShortcut(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("+");
  const code = parts.pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return (
    e.code === code &&
    e.altKey === mods.has("alt") &&
    e.shiftKey === mods.has("shift") &&
    e.ctrlKey === mods.has("ctrl") &&
    e.metaKey === mods.has("meta")
  );
}

export function createInspector(options: InspectorOptions = {}): Inspector {
  const doc = options.doc ?? document;
  const win = doc.defaultView ?? window;
  const capturer = new Capturer(doc, options);
  const h = elementFactory(doc);
  const listeners: { [K in keyof InspectorEvents]?: Set<Listener<InspectorEvents[K]>> } = {};
  const emit = <K extends keyof InspectorEvents>(event: K, payload: InspectorEvents[K]) => {
    for (const fn of listeners[event] ?? []) fn(payload);
  };

  // ---- DOM ---------------------------------------------------------------
  const host = doc.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  if (options.theme && options.theme !== "auto") host.setAttribute("data-theme", options.theme);
  if (options.accentColor) host.style.setProperty("--ak-accent", options.accentColor);
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = OVERLAY_CSS;

  const outlineLayer = h("div");
  const markLayer = h("div");
  const selLayer = h("div");
  const hl = h("div", { class: "hl", hidden: "" });
  const label = h("div", { class: "label", hidden: "" });
  const drag = h("div", { class: "drag", hidden: "" });
  const pinLayer = h("div");
  const composer = h("form", {
    class: "composer",
    hidden: "",
    role: "dialog",
    "aria-label": "Add annotation",
  });
  const composerMeta = h("div", { class: "meta" });
  const textarea = h("textarea", { placeholder: "Leave a note…", "aria-label": "Annotation" });
  const row = h("div", { class: "row" });
  row.append(
    h("span", { class: "hint" }, "↵ save · ⇧↵ newline"),
    h("button", { type: "button", class: "btn", "data-action": "cancel" }, "Cancel"),
    h("button", { type: "submit", class: "btn primary" }, "Save"),
  );
  composer.append(composerMeta, textarea, row);

  const toolbar = h("div", { class: "toolbar", role: "toolbar", "aria-label": "AnnotateKit" });
  const toggleBtn = h(
    "button",
    { type: "button", class: "btn", "data-action": "toggle", "aria-pressed": "false" },
    "Annotate",
  );
  const elementBtn = h(
    "button",
    { type: "button", class: "btn", "data-action": "mode-element", title: "Click to pin" },
    "Element",
  );
  const areaBtn = h(
    "button",
    { type: "button", class: "btn", "data-action": "mode-area", title: "Drag to box an area" },
    "Area",
  );
  const textBtn = h(
    "button",
    { type: "button", class: "btn", "data-action": "mode-text", title: "Select text to quote it" },
    "Text",
  );
  const bpLabel = h("span", { class: "bp", "aria-live": "polite" });
  toolbar.append(toggleBtn, elementBtn, areaBtn, textBtn, bpLabel);
  if (options.toolbar === false) toolbar.hidden = true;

  shadow.append(
    style,
    markLayer,
    outlineLayer,
    selLayer,
    hl,
    drag,
    pinLayer,
    label,
    composer,
    toolbar,
  );
  (options.container ?? doc.body).append(host);
  const pageStyle = doc.createElement("style");
  pageStyle.setAttribute("data-annotatekit-style", "");
  pageStyle.textContent = PAGE_CSS;
  doc.head.append(pageStyle);

  // ---- State -------------------------------------------------------------
  let active = false;
  let mode: InspectMode = options.mode ?? "element";
  let hovered: Element | null = null;
  let selection: Element[] = [];
  let pressed: { x: number; y: number; dragging: boolean } | null = null;
  let pending: Pending | null = null;
  let annotations: RenderableAnnotation[] = options.annotations ?? [];
  let drafts: RenderableAnnotation[] = [];
  let focusedId: string | null = null;
  let raf = 0;
  let destroyed = false;
  let draftCounter = 0;
  /** Resolved anchor elements, so pins don't re-query the DOM every frame. */
  const resolved = new Map<string, Element | null>();

  const isOwn = (el: EventTarget | null) =>
    el === host || (el instanceof Node && host.contains(el));
  const isIgnored = (el: Element) =>
    el === doc.documentElement ||
    el === doc.body ||
    (!!options.ignore && !!el.closest(options.ignore));
  /** Events on our own UI and on ignored page UI (e.g. a feedback sidebar) pass through. */
  const passesThrough = (t: EventTarget | null) =>
    isOwn(t) || (!!options.ignore && t instanceof Element && !!t.closest(options.ignore));
  /** Page element boxes in this document's viewport, including elements inside iframes. */
  const rectOf = (el: Element) => clientRect(el, doc);
  /** A pointer event's position in this document's viewport, wherever it happened. */
  const pointOf = (e: MouseEvent): Point => {
    const d = e.view?.document;
    const off = d && d !== doc ? frameOffset(d, doc) : { x: 0, y: 0 };
    return { x: e.clientX + off.x, y: e.clientY + off.y };
  };
  const scrollOffset = (fixed: boolean): Point =>
    fixed ? { x: 0, y: 0 } : { x: win.scrollX, y: win.scrollY };

  function pickAt(x: number, y: number): Element | null {
    // The host is pointer-events:none except for its controls, so this returns
    // page content unless the pointer is over our toolbar, pins or composer.
    // Descends into open shadow roots, so web components' insides are pickable.
    const el = deepElementFromPoint(doc, x, y, isOwn);
    if (!el || isOwn(el) || isIgnored(el)) return null;
    return el;
  }

  function resolveFor(a: RenderableAnnotation): Element | null {
    const cached = resolved.get(a.id);
    if (cached?.isConnected) return cached;
    const el = resolveAnchor(doc, a.anchor);
    resolved.set(a.id, el);
    return el;
  }

  // ---- Rendering ---------------------------------------------------------
  function renderHighlight() {
    if (!active || !hovered || pressed?.dragging || pending) {
      hl.hidden = true;
      label.hidden = true;
      return;
    }
    const r = rectOf(hovered);
    hl.hidden = false;
    place(hl, r);
    label.hidden = false;
    label.replaceChildren(
      doc.createTextNode(`${describe(hovered)} `),
      h("span", { class: "dim" }, `${Math.round(r.width)}×${Math.round(r.height)}`),
    );
    const lh = 22;
    const top = r.top - lh - 4 >= 0 ? r.top - lh - 4 : Math.min(r.bottom + 4, win.innerHeight - lh);
    label.style.left = `${Math.max(4, Math.min(r.left, win.innerWidth - label.offsetWidth - 4))}px`;
    label.style.top = `${top}px`;
  }

  function renderSelection() {
    selLayer.replaceChildren(
      ...selection.map((el) => {
        const b = h("div", { class: "sel" });
        place(b, rectOf(el));
        return b;
      }),
    );
  }

  /**
   * Current viewport box of a region. Regions are stored relative to the page,
   * but drawn relative to their anchor element: they move and scale with it,
   * so a box drawn at one breakpoint still frames the same content at another.
   */
  function regionBox(a: RenderableAnnotation, el: Element | null): Box | null {
    if (!a.region) return null;
    const anchor = a.anchor.rect; // document space at capture time
    // Fixed regions are stored in viewport space; bring them into document space.
    const scroll = a.fixed ? (a.anchor.scroll ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const region = { x: a.region.x + scroll.x, y: a.region.y + scroll.y };
    const r = el ? rectOf(el) : undefined;
    if (r && anchor.width > 0 && anchor.height > 0 && r.width > 0) {
      const sx = r.width / anchor.width;
      const sy = r.height / anchor.height;
      return {
        left: r.left + (region.x - anchor.x) * sx,
        top: r.top + (region.y - anchor.y) * sy,
        width: a.region.width * sx,
        height: a.region.height * sy,
      };
    }
    const off = scrollOffset(!!a.fixed);
    return {
      left: a.region.x - off.x,
      top: a.region.y - off.y,
      width: a.region.width,
      height: a.region.height,
    };
  }

  /** Live client rects of a quoted text range, if it can still be found. */
  const quoteRanges = new Map<string, Range | null>();
  function quoteRects(a: RenderableAnnotation, el: Element | null): DOMRect[] {
    if (!a.quote || !el) return [];
    let range = quoteRanges.get(a.id);
    if (range === undefined || (range && !range.startContainer.isConnected)) {
      range = rangeFromQuote(el, a.quote);
      quoteRanges.set(a.id, range);
    }
    if (!range) return [];
    const off = frameOffset(range.startContainer.ownerDocument ?? doc, doc);
    return Array.from(range.getClientRects())
      .filter((r) => r.width > 0)
      .map((r) => (off.x || off.y ? new DOMRect(r.x + off.x, r.y + off.y, r.width, r.height) : r));
  }

  function pinPosition(a: RenderableAnnotation): Point | null {
    const el = resolveFor(a);
    const marks = quoteRects(a, el);
    const last = marks[marks.length - 1];
    if (last) return { x: last.right, y: last.top };
    if (a.kind === "region") {
      const box = regionBox(a, el);
      return box ? { x: box.left + box.width, y: box.top } : null;
    }
    if (!el) return null;
    const r = rectOf(el);
    if (r.width === 0 && r.height === 0) return null; // display: none
    if (a.kind === "pin" && a.position) {
      return { x: r.left + a.position.x * r.width, y: r.top + a.position.y * r.height };
    }
    return { x: r.right, y: r.top };
  }

  const pinEls = new Map<string, HTMLButtonElement>();

  function renderPins() {
    const all = [...annotations, ...drafts];
    const keep = new Set<string>();
    all.forEach((a, i) => {
      keep.add(a.id);
      let pin = pinEls.get(a.id);
      if (!pin) {
        pin = h("button", { type: "button", class: "pin", "data-id": a.id });
        pinLayer.append(pin);
        pinEls.set(a.id, pin);
      }
      const text = a.label ?? String(i + 1);
      pin.textContent = text;
      const count = a.targets?.length ?? 0;
      if (count > 1) pin.append(h("span", { class: "count" }, String(count)));
      pin.dataset.status = a.status ?? "open";
      pin.dataset.kind = a.kind;
      pin.toggleAttribute("data-draft", a.id.startsWith("draft_"));
      if (a.color) pin.style.setProperty("--ak-pin", a.color);
      else pin.style.removeProperty("--ak-pin");
      pin.setAttribute("aria-pressed", String(focusedId === a.id));
      const status = a.status ? ` (${a.status.replace("_", " ")})` : "";
      pin.setAttribute(
        "aria-label",
        `Annotation ${text}${count > 1 ? `, ${count} elements` : ""}${status}`,
      );
      const pos = pinPosition(a);
      pin.hidden = !pos;
      if (pos) {
        // The pin's tail sits on the point; keep the bubble inside the viewport
        // so marks on full-width elements stay clickable.
        pin.style.left = `${Math.min(pos.x, win.innerWidth - PIN_SIZE)}px`;
        pin.style.top = `${Math.max(pos.y, PIN_SIZE)}px`;
      }
    });
    for (const [id, el] of pinEls) {
      if (keep.has(id)) continue;
      el.remove();
      pinEls.delete(id);
      resolved.delete(id);
    }

    // Outline the focused annotation: its region or element, plus extra targets.
    const outlines: HTMLElement[] = [];
    const focused = all.find((a) => a.id === focusedId);
    if (focused) {
      const el = resolveFor(focused);
      const box = focused.quote ? null : regionBox(focused, el);
      if (box) {
        const b = h("div", { class: "region" });
        place(b, box);
        outlines.push(b);
      } else if (el) {
        const b = h("div", { class: "sel" });
        place(b, rectOf(el));
        outlines.push(b);
      }
      for (const s of focused.targets ?? []) {
        const t = resolveAnchor(doc, { selector: s });
        if (!t) continue;
        const b = h("div", { class: "sel" });
        place(b, rectOf(t));
        outlines.push(b);
      }
    }
    outlineLayer.replaceChildren(...outlines);

    // Underline quoted text, like comments in a document editor.
    const marks: HTMLElement[] = [];
    for (const a of all) {
      if (!a.quote) continue;
      for (const r of quoteRects(a, resolveFor(a))) {
        const m = h("div", { class: "mark", "data-id": a.id });
        if (focusedId === a.id) m.setAttribute("data-focused", "");
        if (a.status === "resolved" || a.status === "dismissed") m.setAttribute("data-closed", "");
        place(m, r);
        marks.push(m);
      }
    }
    markLayer.replaceChildren(...marks);
  }

  function renderToolbar() {
    toggleBtn.setAttribute("aria-pressed", String(active));
    toggleBtn.textContent = active ? "Done" : "Annotate";
    elementBtn.hidden = !active;
    areaBtn.hidden = !active;
    textBtn.hidden = !active;
    elementBtn.setAttribute("aria-pressed", String(mode === "element"));
    areaBtn.setAttribute("aria-pressed", String(mode === "area"));
    textBtn.setAttribute("aria-pressed", String(mode === "text"));
    if (active) setInspecting(mode === "text" ? "text" : "");
    const { breakpoint, viewport } = capturer.breakpoint();
    bpLabel.textContent = `${breakpoint.name} · ${viewport.width}px`;
  }

  function frame() {
    raf = 0;
    if (destroyed) return;
    renderHighlight();
    renderSelection();
    renderPins();
    if (pending) positionComposer();
  }
  const schedule = () => {
    if (!raf && !destroyed) raf = win.requestAnimationFrame(frame);
  };

  // ---- Composer ----------------------------------------------------------
  function composerAnchor(): Point {
    if (!pending) return { x: 0, y: 0 };
    const { draft } = pending;
    if (draft.region) {
      const off = scrollOffset(draft.fixed);
      return { x: draft.region.x - off.x, y: draft.region.y + draft.region.height - off.y };
    }
    const r = draft.anchor.rect; // document space
    const p = draft.position ?? { x: 0, y: 1 };
    return { x: r.x + p.x * r.width - win.scrollX, y: r.y + p.y * r.height - win.scrollY };
  }

  function positionComposer() {
    const p = composerAnchor();
    const w = composer.offsetWidth || 300;
    const ch = composer.offsetHeight || 140;
    const below = p.y + 12 + ch <= win.innerHeight;
    composer.style.left = `${Math.max(8, Math.min(p.x, win.innerWidth - w - 8))}px`;
    composer.style.top = `${below ? p.y + 12 : Math.max(8, p.y - ch - 12)}px`;
  }

  function composerTitle(draft: Pending["draft"]): string {
    const n = draft.targets.length;
    if (draft.quote)
      return `“${draft.quote.exact.slice(0, 60)}${draft.quote.exact.length > 60 ? "…" : ""}”`;
    if (draft.kind === "region") {
      const size = `${Math.round(draft.region?.width ?? 0)}×${Math.round(draft.region?.height ?? 0)}`;
      return `Region ${size} · ${n} element${n === 1 ? "" : "s"}`;
    }
    if (draft.kind === "element") return `Whole element · ${draft.anchor.selector}`;
    return draft.anchor.selector;
  }

  function openComposer(next: Pending) {
    pending = next;
    composerMeta.textContent = composerTitle(next.draft);
    textarea.value = "";
    composer.hidden = false;
    positionComposer();
    schedule();
    textarea.focus({ preventScroll: true });
  }

  function closeComposer() {
    if (pending?.draft.quote) doc.getSelection()?.removeAllRanges();
    pending = null;
    composer.hidden = true;
    schedule();
  }

  function submitComposer() {
    if (!pending) return;
    const comment = textarea.value.trim();
    if (!comment) {
      textarea.focus();
      return;
    }
    const { draft: d, anchorSnap } = pending;
    const draft: AnnotationDraft = {
      ...d,
      comment,
      context: capturer.context(anchorSnap, d.targets),
      page: capturer.page(),
    };
    if (options.showDraftPins !== false)
      drafts.push(draftToRenderable(`draft_${++draftCounter}`, draft));
    selection = [];
    closeComposer();
    emit("create", draft);
  }

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    submitComposer();
  });
  composer.addEventListener("click", (e) => {
    if ((e.target as Element).closest("[data-action=cancel]")) closeComposer();
  });
  textarea.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitComposer();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeComposer();
    }
  });
  // Keep the page's own shortcuts from firing while typing in the overlay.
  for (const t of ["keyup", "keypress", "input"] as const) {
    textarea.addEventListener(t, (e) => e.stopPropagation());
  }

  // ---- Draft builders ----------------------------------------------------
  function pinDraft(el: Element, clientX: number, clientY: number) {
    const snap = capturer.element(el);
    const r = rectOf(el);
    openComposer({
      anchorSnap: snap,
      draft: {
        kind: "pin",
        anchor: snap.anchor,
        position: {
          x: r.width ? (clientX - r.left) / r.width : 0,
          y: r.height ? (clientY - r.top) / r.height : 0,
        },
        targets: [snap],
        fixed: snap.fixed,
      },
    });
  }

  function elementDraft(el: Element) {
    const snap = capturer.element(el);
    openComposer({
      anchorSnap: snap,
      draft: { kind: "element", anchor: snap.anchor, targets: [snap], fixed: snap.fixed },
    });
  }

  /** A region around `els`: a multi-selection, or whatever a dragged box covers. */
  function regionDraft(els: Element[], box: Box) {
    const anchorEl =
      commonAncestor(els, doc) ??
      pickAt(box.left + box.width / 2, box.top + box.height / 2) ??
      doc.body;
    const anchorSnap = capturer.element(anchorEl);
    const off = scrollOffset(anchorSnap.fixed);
    openComposer({
      anchorSnap,
      draft: {
        kind: "region",
        anchor: anchorSnap.anchor,
        region: { x: box.left + off.x, y: box.top + off.y, width: box.width, height: box.height },
        targets: els.map((el) => capturer.element(el)),
        fixed: anchorSnap.fixed,
      },
    });
  }

  /** A region around the current text selection, quoted so it can be found again. */
  function textDraft() {
    if (!active || pending || mode !== "text") return;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const anchorEl = common instanceof Element ? common : common.parentElement;
    if (!anchorEl || isOwn(anchorEl) || isIgnored(anchorEl)) return;
    const quote = quoteFromRange(anchorEl, range);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!quote || !rects.length) return;
    const box = unionRect(rects);
    const anchorSnap = capturer.element(anchorEl);
    const off = scrollOffset(anchorSnap.fixed);
    openComposer({
      anchorSnap,
      draft: {
        kind: "region",
        anchor: anchorSnap.anchor,
        region: { x: box.left + off.x, y: box.top + off.y, width: box.width, height: box.height },
        targets: [anchorSnap],
        fixed: anchorSnap.fixed,
        quote,
      },
    });
  }

  function commitSelection() {
    const els = selection;
    if (els.length === 1 && els[0]) elementDraft(els[0]);
    else if (els.length > 1) regionDraft(els, unionRect(els.map(rectOf)));
  }

  function elementsInside(box: Box): Element[] {
    const right = box.left + box.width;
    const bottom = box.top + box.height;
    const out: Element[] = [];
    // Walk by hand rather than with a TreeWalker, which can't enter shadow roots.
    const visit = (el: Element) => {
      if (out.length >= MAX_AREA_TARGETS || isOwn(el) || isIgnored(el)) return;
      const r = rectOf(el);
      const empty = r.width === 0 && r.height === 0;
      if (!empty) {
        if (r.right < box.left || r.left > right || r.bottom < box.top || r.top > bottom) {
          return; // no overlap, so (overflow aside) no child is inside
        }
        const inside =
          r.left >= box.left - 1 &&
          r.top >= box.top - 1 &&
          r.right <= right + 1 &&
          r.bottom <= bottom + 1;
        if (inside) {
          out.push(el); // outermost elements only
          return;
        }
      }
      for (const child of composedChildren(el)) visit(child);
    };
    for (const child of composedChildren(doc.body)) visit(child);
    return out;
  }

  // ---- Page events -------------------------------------------------------
  /** In text mode the browser must still place the caret and extend selections. */
  const SELECTION_EVENTS = new Set([
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "dblclick",
  ]);
  const swallow = (e: Event) => {
    if (!active || passesThrough(e.target)) return;
    if (!(mode === "text" && SELECTION_EVENTS.has(e.type))) e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  function onPointerMove(e: PointerEvent) {
    if (!active) return;
    const { x: px, y: py } = pointOf(e);
    if (pressed) {
      const dx = px - pressed.x;
      const dy = py - pressed.y;
      if (!pressed.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) pressed.dragging = true;
      if (pressed.dragging) {
        drag.hidden = false;
        place(drag, {
          left: Math.min(pressed.x, px),
          top: Math.min(pressed.y, py),
          width: Math.abs(dx),
          height: Math.abs(dy),
        });
      }
      schedule();
      return;
    }
    if (pending) return;
    const el = mode === "text" ? null : pickAt(px, py);
    if (el !== hovered) {
      hovered = el;
      if (listeners.hover?.size) emit("hover", el ? capturer.element(el) : null);
    }
    schedule();
  }

  function onPointerDown(e: PointerEvent) {
    const { x: px, y: py } = pointOf(e);
    if (!active || e.button !== 0 || passesThrough(e.target)) return;
    swallow(e);
    if (pending) {
      closeComposer();
      return;
    }
    if (mode === "text") return;
    pressed = { x: px, y: py, dragging: false };
  }

  function onPointerUp(e: PointerEvent) {
    const { x: px, y: py } = pointOf(e);
    if (active && mode === "text" && !pending && !passesThrough(e.target)) {
      swallow(e);
      // Let the browser finish updating the selection first.
      win.setTimeout(textDraft, 0);
      return;
    }
    if (!active || !pressed) return;
    swallow(e);
    const p = pressed;
    pressed = null;
    drag.hidden = true;
    if (p.dragging) {
      const box: Box = {
        left: Math.min(p.x, px),
        top: Math.min(p.y, py),
        width: Math.abs(px - p.x),
        height: Math.abs(py - p.y),
      };
      regionDraft(elementsInside(box), box);
      return;
    }
    if (mode === "area") return;
    const el = pickAt(px, py);
    if (!el) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      selection = selection.includes(el) ? selection.filter((s) => s !== el) : [...selection, el];
      schedule();
      return;
    }
    pinDraft(el, px, py);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (options.shortcut !== false && matchesShortcut(e, options.shortcut ?? "Alt+KeyA")) {
      e.preventDefault();
      api.toggle();
      return;
    }
    if (!active || e.key !== "Escape") return;
    if (pending) closeComposer();
    else if (selection.length) {
      selection = [];
      schedule();
    } else api.deactivate();
  }

  function onKeyUp(e: KeyboardEvent) {
    // Releasing the multi-select modifier commits the selection, as in agentation.
    if (!active || pending || !selection.length) return;
    if (e.key === "Shift" || e.key === "Meta" || e.key === "Control") commitSelection();
  }

  const onViewportChange = () => {
    renderToolbar();
    schedule();
  };

  toolbar.addEventListener("click", (e) => {
    const action = (e.target as Element).closest("[data-action]")?.getAttribute("data-action");
    if (action === "toggle") api.toggle();
    else if (action === "mode-element") api.setMode("element");
    else if (action === "mode-area") api.setMode("area");
    else if (action === "mode-text") api.setMode("text");
  });
  pinLayer.addEventListener("click", (e) => {
    const id = (e.target as Element).closest(".pin")?.getAttribute("data-id");
    if (!id) return;
    api.focusAnnotation(focusedId === id ? null : id);
    emit("select", id);
  });

  const capture = { capture: true } as const;
  doc.addEventListener("pointermove", onPointerMove, capture);
  doc.addEventListener("pointerdown", onPointerDown, capture);
  doc.addEventListener("pointerup", onPointerUp, capture);
  for (const t of SWALLOWED) doc.addEventListener(t, swallow, capture);
  doc.addEventListener("keydown", onKeyDown, capture);
  doc.addEventListener("keyup", onKeyUp, capture);
  win.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
  win.addEventListener("resize", onViewportChange, { passive: true });
  // Same-origin iframes get the same listeners, so pointing inside them works too.
  const frames = new Map<Document, () => void>();
  function listenTo(d: Document): () => void {
    const w = d.defaultView;
    d.addEventListener("pointermove", onPointerMove, capture);
    d.addEventListener("pointerdown", onPointerDown, capture);
    d.addEventListener("pointerup", onPointerUp, capture);
    for (const t of SWALLOWED) d.addEventListener(t, swallow, capture);
    d.addEventListener("keydown", onKeyDown, capture);
    d.addEventListener("keyup", onKeyUp, capture);
    w?.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
    const style = d.createElement("style");
    style.setAttribute("data-annotatekit-style", "");
    style.textContent = PAGE_CSS;
    (d.head ?? d.documentElement)?.append(style);
    const attr = doc.documentElement.getAttribute(ACTIVE_ATTR);
    if (attr !== null) d.documentElement?.setAttribute(ACTIVE_ATTR, attr);
    return () => {
      d.removeEventListener("pointermove", onPointerMove, capture);
      d.removeEventListener("pointerdown", onPointerDown, capture);
      d.removeEventListener("pointerup", onPointerUp, capture);
      for (const t of SWALLOWED) d.removeEventListener(t, swallow, capture);
      d.removeEventListener("keydown", onKeyDown, capture);
      d.removeEventListener("keyup", onKeyUp, capture);
      w?.removeEventListener("scroll", onViewportChange, { capture: true });
      style.remove();
      d.documentElement?.removeAttribute(ACTIVE_ATTR);
    };
  }
  function syncFrames() {
    if (destroyed) return;
    const docs = frameDocuments(doc);
    for (const [d, off] of frames) {
      if (!docs.includes(d)) {
        off();
        frames.delete(d);
      }
    }
    for (const d of docs) if (!frames.has(d)) frames.set(d, listenTo(d));
  }
  /** Marks the page (and its frames) as being inspected, for the cursor styles. */
  function setInspecting(value: string | null) {
    for (const d of [doc, ...frames.keys()]) {
      if (value === null) d.documentElement?.removeAttribute(ACTIVE_ATTR);
      else d.documentElement?.setAttribute(ACTIVE_ATTR, value);
    }
  }
  // A frame's document is replaced when it loads; `load` doesn't bubble, but capture sees it.
  const onLoad = (e: Event) => {
    if ((e.target as Element | null)?.localName?.endsWith("frame")) {
      syncFrames();
      schedule();
    }
  };
  doc.addEventListener("load", onLoad, capture);
  syncFrames();
  // Layout shifts (images loading, content changing) move anchored pins.
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => schedule()) : null;
  ro?.observe(doc.documentElement);
  // Re-renders and client-side navigation can replace anchored elements.
  const mo =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver((records) => {
          if (records.every((r) => isOwn(r.target))) return;
          syncFrames();
          resolved.clear();
          quoteRanges.clear();
          schedule();
        })
      : null;
  mo?.observe(doc.body, { childList: true, subtree: true });

  function on<K extends keyof InspectorEvents>(event: K, fn: Listener<InspectorEvents[K]>) {
    const map = listeners as Record<string, Set<unknown> | undefined>;
    const set = map[event] ?? new Set();
    map[event] = set;
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }
  if (options.onCreate) on("create", options.onCreate);
  if (options.onSelect) on("select", options.onSelect);
  if (options.onActiveChange) on("activechange", options.onActiveChange);

  const api: Inspector = {
    get active() {
      return active;
    },
    get mode() {
      return mode;
    },
    activate() {
      if (active || destroyed) return;
      active = true;
      setInspecting("");
      renderToolbar();
      schedule();
      emit("activechange", true);
    },
    deactivate() {
      if (!active) return;
      active = false;
      hovered = null;
      pressed = null;
      selection = [];
      drag.hidden = true;
      closeComposer();
      setInspecting(null);
      renderToolbar();
      schedule();
      emit("activechange", false);
    },
    toggle() {
      if (active) api.deactivate();
      else api.activate();
    },
    setMode(m) {
      mode = m;
      selection = [];
      renderToolbar();
      schedule();
    },
    setAnnotations(list) {
      annotations = list;
      drafts = [];
      resolved.clear();
      quoteRanges.clear();
      schedule();
    },
    focusAnnotation(id) {
      focusedId = id;
      schedule();
    },
    capture: (el) => capturer.element(el),
    on,
    refreshStyles() {
      capturer.invalidate();
    },
    destroy() {
      if (destroyed) return;
      api.deactivate();
      destroyed = true;
      if (raf) win.cancelAnimationFrame(raf);
      doc.removeEventListener("pointermove", onPointerMove, capture);
      doc.removeEventListener("pointerdown", onPointerDown, capture);
      doc.removeEventListener("pointerup", onPointerUp, capture);
      for (const t of SWALLOWED) doc.removeEventListener(t, swallow, capture);
      doc.removeEventListener("keydown", onKeyDown, capture);
      doc.removeEventListener("keyup", onKeyUp, capture);
      win.removeEventListener("scroll", onViewportChange, { capture: true });
      win.removeEventListener("resize", onViewportChange);
      doc.removeEventListener("load", onLoad, capture);
      for (const off of frames.values()) off();
      frames.clear();
      ro?.disconnect();
      mo?.disconnect();
      host.remove();
      pageStyle.remove();
      for (const k of Object.keys(listeners)) delete listeners[k as keyof InspectorEvents];
    },
  };

  renderToolbar();
  if (options.active) api.activate();
  else schedule();
  return api;
}

/** The pin the overlay draws for a draft before it is persisted. */
export function draftToRenderable(id: string, draft: AnnotationDraft): RenderableAnnotation {
  const r: RenderableAnnotation = {
    id,
    kind: draft.kind,
    anchor: draft.anchor,
    fixed: draft.fixed,
  };
  if (draft.position) r.position = draft.position;
  if (draft.region) r.region = draft.region;
  if (draft.targets.length > 1) r.targets = draft.targets.map((t) => t.anchor.selector);
  if (draft.quote) r.quote = draft.quote;
  return r;
}
