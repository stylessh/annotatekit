import { MAX_ATTACHMENTS, type Thread, type ThreadDetail } from "@annotatekit/core";
import {
  attachmentTray,
  type ComposerParts,
  composerParts,
  type H,
  type PendingAttachment,
  type ThreadListView,
  type ThreadView,
  threadListPanel,
  threadPanel,
} from "./ui.js";

export type ThreadAction = "resolve" | "reopen" | "approve";

/**
 * Where the overlay's thread panel reads threads from and sends replies to.
 * `bindService` provides one for any AnnotateKit service.
 */
export interface ThreadSource {
  /** Threads on the current page. */
  list(): Promise<Thread[]>;
  get(threadId: string): Promise<ThreadDetail>;
  reply(threadId: string, input: { body: string; files: File[] }): Promise<void>;
  act(threadId: string, action: ThreadAction): Promise<void>;
  /** The viewer's actor id, so their own messages read "You". */
  me?(): string | undefined;
}

// ---- Attachments in a composer ---------------------------------------------

export interface FileField {
  files(): File[];
  clear(): void;
  /** Re-render the tray, e.g. to show upload progress. */
  setUploading(uploading: boolean): void;
}

/**
 * Wires a composer's attach button, file input, paste and drop to a list of
 * files shown in its tray. Image previews use object URLs, revoked on clear.
 */
export function bindFileField(h: H, parts: ComposerParts, onChange?: () => void): FileField {
  let files: File[] = [];
  let previews: (string | undefined)[] = [];
  let uploading = false;
  const url = globalThis.URL;

  function render() {
    const pending: PendingAttachment[] = files.map((f, i) => {
      const p: PendingAttachment = { name: f.name, type: f.type, size: f.size, uploading };
      const preview = previews[i];
      if (preview) p.previewUrl = preview;
      return p;
    });
    const tray = attachmentTray(h, pending);
    parts.tray.replaceWith(tray);
    parts.tray = tray;
    onChange?.();
  }

  function add(list: Iterable<File>) {
    for (const f of list) {
      if (files.length >= MAX_ATTACHMENTS) {
        parts.error.textContent = `At most ${MAX_ATTACHMENTS} files per message`;
        break;
      }
      files.push(f);
      previews.push(
        f.type.startsWith("image/") && url?.createObjectURL ? url.createObjectURL(f) : undefined,
      );
    }
    render();
  }

  function clear() {
    for (const p of previews) if (p) url?.revokeObjectURL?.(p);
    files = [];
    previews = [];
    uploading = false;
    parts.fileInput.value = "";
    render();
  }

  parts.form.addEventListener("click", (e) => {
    const target = (e.target as Element).closest("[data-action]");
    const action = target?.getAttribute("data-action");
    if (action === "attach") parts.fileInput.click();
    else if (action === "remove-file") {
      const i = Number(target?.getAttribute("data-index"));
      const p = previews[i];
      if (p) url?.revokeObjectURL?.(p);
      files.splice(i, 1);
      previews.splice(i, 1);
      render();
    }
  });
  parts.fileInput.addEventListener("change", () => {
    if (parts.fileInput.files) add(Array.from(parts.fileInput.files));
    parts.fileInput.value = "";
  });
  parts.textarea.addEventListener("paste", (e) => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (pasted.length) {
      e.preventDefault();
      add(pasted);
    }
  });
  parts.form.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  parts.form.addEventListener("drop", (e) => {
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (!dropped.length) return;
    e.preventDefault();
    add(dropped);
  });

  return {
    files: () => [...files],
    clear,
    setUploading(value) {
      uploading = value;
      render();
    },
  };
}

/** Keep the page's own shortcuts from firing while typing in the overlay. */
export function isolateTyping(el: HTMLElement) {
  for (const t of ["keydown", "keyup", "keypress", "input"] as const) {
    el.addEventListener(t, (e) => e.stopPropagation());
  }
}

/** Grow a textarea with its content, up to its CSS max-height. */
export function autosize(textarea: HTMLTextAreaElement) {
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener("input", fit);
  return fit;
}

// ---- The panel ---------------------------------------------------------------

export interface ThreadsPanel {
  readonly el: HTMLElement;
  readonly open: boolean;
  /** The thread being shown, or null for the list (or when closed). */
  readonly threadId: string | null;
  setSource(source: ThreadSource | null): void;
  showList(): void;
  showThread(id: string): void;
  hide(): void;
  /** Reload whatever is showing, without flashing the loading state. */
  refresh(): void;
}

export interface ThreadsPanelOptions {
  /** The number shown on a thread's pin. */
  labelFor(id: string): string;
  /** Called when the panel switches thread (or closes, with null). */
  onThreadChange?(id: string | null): void;
  now?: () => number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const EASE_FLUID = "cubic-bezier(0.32, 0.72, 0, 1)";

function reducedMotion(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  return !!view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function canAnimate(el: Element): boolean {
  return typeof (el as HTMLElement).animate === "function" && !reducedMotion(el);
}

/**
 * Replace a panel's content and morph its height from the old size to the new
 * one, so views and new replies grow or shrink the panel smoothly. `slide`
 * also brings the new content in from that side (1 = from the right).
 */
export function morphPanel(el: HTMLElement, update: () => void, slide = 0) {
  const before = el.hidden ? 0 : el.getBoundingClientRect().height;
  update();
  if (!before || el.hidden || !canAnimate(el)) return;
  const after = el.getBoundingClientRect().height;
  if (Math.abs(after - before) > 1) {
    const overflow = el.style.overflow;
    el.style.overflow = "hidden";
    const anim = el.animate([{ height: `${before}px` }, { height: `${after}px` }], {
      duration: 460,
      easing: EASE_FLUID,
    });
    const done = () => {
      el.style.overflow = overflow;
    };
    anim.addEventListener("finish", done);
    anim.addEventListener("cancel", done);
  }
  if (slide) {
    for (const child of Array.from(el.children)) {
      (child as HTMLElement).animate(
        [
          { opacity: 0, transform: `translateX(${slide * 14}px)`, filter: "blur(3px)" },
          { opacity: 1, transform: "none", filter: "blur(0)" },
        ],
        { duration: 380, easing: EASE_FLUID },
      );
    }
  }
}

export function createThreadsPanel(h: H, opts: ThreadsPanelOptions): ThreadsPanel {
  const now = opts.now ?? Date.now;
  const el = h("section", {
    class: "panel threads",
    role: "dialog",
    "aria-label": "Threads",
    hidden: "",
  });
  const reply = composerParts(h, "reply");
  const files = bindFileField(h, reply);
  const fit = autosize(reply.textarea);
  isolateTyping(reply.form);

  let source: ThreadSource | null = null;
  let view: "list" | "thread" | null = null;
  let threadId: string | null = null;
  let listView: ThreadListView = { state: "loading" };
  let threadView: ThreadView = { state: "loading" };
  /** Drops responses that arrive after the user moved on. */
  let generation = 0;
  /** Which view is drawn, so a change of view slides instead of morphing in place. */
  let drawn: string | null = null;
  /** Messages already shown in this thread; anything else animates in. */
  let seen = new Set<string>();
  let exit: Animation | null = null;

  function render() {
    const key = view === "thread" ? `thread:${threadId}` : view;
    const slide = drawn && key && drawn !== key ? (view === "thread" ? 1 : -1) : 0;
    drawn = key;
    if (view === null) {
      el.hidden = true;
      return;
    }
    exit?.cancel();
    exit = null;
    morphPanel(
      el,
      () => {
        el.hidden = false;
        el.classList.toggle("thread", view === "thread");
        if (view === "list") el.replaceChildren(...threadListPanel(h, listView));
        else {
          // Same thread re-rendered: keep the reader's scroll position.
          const kept = slide ? 0 : (el.querySelector(".thread-body")?.scrollTop ?? 0);
          el.replaceChildren(
            ...threadPanel(h, threadView, threadView.state === "ready" ? reply.form : undefined),
          );
          const body = el.querySelector(".thread-body");
          if (body && kept) body.scrollTop = kept;
          markNew();
        }
      },
      slide,
    );
  }

  /** Mark which edges of the thread body have more to scroll, for the fade. */
  function edges() {
    const body = el.querySelector<HTMLElement>(".thread-body");
    if (!body) return;
    const update = () => {
      body.toggleAttribute("data-more-above", body.scrollTop > 2);
      body.toggleAttribute(
        "data-more-below",
        body.scrollHeight - body.scrollTop - body.clientHeight > 2,
      );
    };
    body.addEventListener("scroll", update, { passive: true });
    update();
  }

  /** Flag replies that weren't on screen before, so they settle in. */
  function markNew() {
    if (threadView.state !== "ready") return;
    const ids = threadView.detail.comments.map((c) => c.id);
    const first = seen.size === 0;
    for (const li of Array.from(el.querySelectorAll<HTMLElement>(".messages > [data-id]"))) {
      const id = li.getAttribute("data-id") ?? "";
      if (!first && !seen.has(id)) li.setAttribute("data-new", "");
    }
    seen = new Set(ids);
  }

  let settled = 0;
  /**
   * Show the loading state only if the answer is slow, so a fast load goes
   * straight from the old view to the new one in a single morph.
   */
  function loadingSoon(gen: number, set: () => void) {
    const show = () => {
      if (gen !== generation || settled === gen) return;
      set();
      render();
    };
    if (el.hidden && drawn === null) show();
    else setTimeout(show, 140);
  }

  async function load(quiet: boolean) {
    const gen = ++generation;
    const src = source;
    if (!src || view === null) return;
    if (view === "list") {
      if (!quiet) loadingSoon(gen, () => (listView = { state: "loading" }));
      try {
        const threads = await src.list();
        if (gen !== generation) return;
        const items = threads
          .map((thread) => ({ thread, label: opts.labelFor(thread.id) }))
          .sort((a, b) => (Number(a.label) || Infinity) - (Number(b.label) || Infinity));
        listView = { state: "ready", items, now: now() };
      } catch (e) {
        if (gen !== generation) return;
        listView = { state: "error", message: message(e) };
      }
    } else if (threadId) {
      const id = threadId;
      if (!quiet) loadingSoon(gen, () => (threadView = { state: "loading" }));
      try {
        const detail = await src.get(id);
        if (gen !== generation) return;
        const me = src.me?.();
        threadView = { state: "ready", detail, now: now(), ...(me ? { meId: me } : {}) };
      } catch (e) {
        if (gen !== generation) return;
        threadView = { state: "error", message: message(e) };
      }
    }
    settled = gen;
    render();
    const body = el.querySelector(".thread-body");
    if (body && !quiet) body.scrollTop = body.scrollHeight;
    edges();
    // Images grow the list as they load; stay pinned to the newest message.
    body?.addEventListener(
      "load",
      () => {
        if (body.scrollHeight - body.scrollTop - body.clientHeight < 400) {
          body.scrollTop = body.scrollHeight;
        }
        edges();
      },
      true,
    );
  }

  async function send() {
    const src = source;
    const id = threadId;
    if (!src || !id || threadView.state !== "ready" || threadView.busy) return;
    const body = reply.textarea.value.trim();
    const picked = files.files();
    if (!body && !picked.length) {
      reply.textarea.focus();
      return;
    }
    reply.error.textContent = "";
    reply.submit.disabled = true;
    files.setUploading(picked.length > 0);
    try {
      await src.reply(id, { body, files: picked });
      reply.textarea.value = "";
      fit();
      files.clear();
      await load(true);
      const scroller = el.querySelector(".thread-body");
      scroller?.scrollTo?.({
        top: scroller.scrollHeight,
        behavior: reducedMotion(el) ? "auto" : "smooth",
      });
    } catch (e) {
      files.setUploading(false);
      reply.error.textContent = message(e);
    } finally {
      reply.submit.disabled = false;
    }
  }

  async function act(action: string) {
    const src = source;
    const id = threadId;
    if (!src || !id || threadView.state !== "ready") return;
    threadView = { ...threadView, busy: true };
    render();
    try {
      await src.act(id, action as ThreadAction);
      await load(true);
    } catch (e) {
      threadView = { ...threadView, busy: false };
      render();
      reply.error.textContent = message(e);
    }
  }

  reply.form.addEventListener("submit", (e) => {
    e.preventDefault();
    void send();
  });
  reply.textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      e.preventDefault();
      api.hide();
    }
  });
  el.addEventListener("click", (e) => {
    const target = (e.target as Element).closest("[data-action]");
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === "panel-close") api.hide();
    else if (action === "back") api.showList();
    else if (action === "retry") void load(false);
    else if (action === "open-thread") {
      const id = target.getAttribute("data-id");
      if (id) api.showThread(id);
    } else if (action === "resolve" || action === "reopen" || action === "approve")
      void act(action);
  });

  function reset() {
    reply.textarea.value = "";
    reply.error.textContent = "";
    fit();
    files.clear();
  }

  const api: ThreadsPanel = {
    el,
    get open() {
      return view !== null;
    },
    get threadId() {
      return view === "thread" ? threadId : null;
    },
    setSource(next) {
      source = next;
      if (!next) api.hide();
      else if (view) void load(false);
    },
    showList() {
      if (view === "thread") opts.onThreadChange?.(null);
      view = "list";
      threadId = null;
      void load(false);
    },
    showThread(id) {
      if (threadId !== id) {
        reset();
        seen = new Set();
      }
      view = "thread";
      threadId = id;
      opts.onThreadChange?.(id);
      void load(false);
    },
    hide() {
      if (view === null) return;
      const hadThread = view === "thread";
      view = null;
      threadId = null;
      generation++;
      seen = new Set();
      reset();
      if (canAnimate(el) && !el.hidden) {
        const out = el.animate(
          [
            { opacity: 1, transform: "none", filter: "blur(0)" },
            { opacity: 0, transform: "translateY(8px) scale(0.97)", filter: "blur(4px)" },
          ],
          { duration: 200, easing: EASE_FLUID },
        );
        exit = out;
        out.addEventListener("finish", () => {
          exit = null;
          if (view === null) render();
        });
      } else render();
      drawn = null;
      if (hadThread) opts.onThreadChange?.(null);
    },
    refresh() {
      if (view) void load(true);
    },
  };
  return api;
}
