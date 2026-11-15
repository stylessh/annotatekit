import {
  type Actor,
  type AnnotateKitService,
  type Annotation,
  type CreateThreadInput,
  createAnnotateKitService,
  type ElementAnchor,
  type Group,
  type StorageAdapter,
  type TextQuote,
  type Thread,
  type ThreadDetail,
  type ThreadStatus,
} from "@annotatekit/core";
import type { Inspector } from "./overlay/inspector.js";
import type { AnnotationDraft, RenderableAnnotation } from "./types.js";

/** Inspector-specific data kept in `Annotation.metadata.inspector`. */
export interface InspectorAnnotationMetadata {
  /** The anchor scrolls with the viewport (fixed/sticky), so `region` is in viewport space. */
  fixed: boolean;
  /** Anchors of every element in a multi-element region. */
  targets?: ElementAnchor[];
  /** The selected text, for text annotations. */
  quote?: TextQuote;
}

export interface DraftToThreadOptions {
  projectId: string;
  groupId?: string;
  tags?: string[];
}

const TITLE_MAX = 80;

function titleFrom(comment: string): string {
  const line = comment.split("\n")[0]?.trim() ?? "";
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

/** Turn an inspector draft into core's input for `service.createThread`. */
export function draftToThreadInput(
  draft: AnnotationDraft,
  opts: DraftToThreadOptions,
): CreateThreadInput {
  const meta: InspectorAnnotationMetadata = { fixed: draft.fixed };
  if (draft.targets.length > 1) meta.targets = draft.targets.map((t) => t.anchor);
  if (draft.quote) meta.quote = draft.quote;
  const input: CreateThreadInput = {
    projectId: opts.projectId,
    page: draft.page,
    title: titleFrom(draft.comment),
    annotation: {
      kind: draft.kind,
      anchor: draft.anchor,
      context: draft.context,
      metadata: { inspector: meta },
    },
    comment: { body: draft.comment, format: "plain" },
  };
  if (draft.position) input.annotation.position = draft.position;
  if (draft.region) input.annotation.region = draft.region;
  if (opts.groupId) input.groupId = opts.groupId;
  if (opts.tags?.length) input.tags = opts.tags;
  return input;
}

function inspectorMeta(annotation: Annotation): Partial<InspectorAnnotationMetadata> {
  const meta = annotation.metadata?.inspector;
  return meta && typeof meta === "object" ? (meta as Partial<InspectorAnnotationMetadata>) : {};
}

/** What the overlay needs to draw a stored annotation. The id is the thread's. */
export function toRenderable(
  thread: Thread,
  annotation: Annotation,
  extra: { label?: string; color?: string } = {},
): RenderableAnnotation {
  const meta = inspectorMeta(annotation);
  const r: RenderableAnnotation = {
    id: thread.id,
    kind: annotation.kind,
    anchor: annotation.anchor,
    status: thread.status,
    fixed: !!meta.fixed,
  };
  if (annotation.position) r.position = annotation.position;
  if (annotation.region) r.region = annotation.region;
  if (meta.targets && meta.targets.length > 1) r.targets = meta.targets.map((t) => t.selector);
  if (meta.quote) r.quote = meta.quote;
  if (thread.groupId) r.groupId = thread.groupId;
  if (extra.label) r.label = extra.label;
  if (extra.color) r.color = extra.color;
  return r;
}

export interface BindServiceOptions {
  /** Any `AnnotateKitService`: local over a storage adapter, or a remote client. */
  service: AnnotateKitService;
  projectId: string;
  /** Who is annotating. A function is read on every call, so sign-in changes apply. */
  actor: Actor | null | (() => Actor | null);
  /** Group new threads go into, e.g. the group picked in your UI. */
  groupId?: () => string | undefined;
  /** Which threads to show. Defaults to every status except `dismissed`. */
  statuses?: ThreadStatus[];
  /** Page key for filtering. Defaults to `location.pathname`. */
  pathname?: () => string;
  onCreated?: (detail: ThreadDetail) => void;
  onError?: (error: unknown) => void;
}

export interface BindStorageOptions extends Omit<BindServiceOptions, "service"> {
  storage: StorageAdapter;
}

export interface ServiceBinding {
  /** Reload threads for the current page, e.g. after client-side navigation. */
  reload(): Promise<void>;
  unbind(): void;
}

const DEFAULT_STATUSES: ThreadStatus[] = ["open", "in_progress", "pending_review", "resolved"];

async function listAll<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/**
 * Wire an inspector to an AnnotateKit service: show the page's threads as pins,
 * create a thread (with its first comment) for each draft, and follow changes
 * made elsewhere (other tabs, agents over MCP) through `service.subscribe`.
 */
export function bindService(inspector: Inspector, opts: BindServiceOptions): ServiceBinding {
  const { service, projectId } = opts;
  const actor = () => (typeof opts.actor === "function" ? opts.actor() : opts.actor);
  const pathname = opts.pathname ?? (() => location.pathname);
  const fail = (e: unknown) => (opts.onError ? opts.onError(e) : console.error("[annotatekit]", e));
  let disposed = false;
  let queued: Promise<void> | null = null;

  async function load(): Promise<void> {
    const who = actor();
    const [threads, groups] = await Promise.all([
      listAll((cursor) =>
        service.listThreads(who, {
          projectId,
          pathname: pathname(),
          status: opts.statuses ?? DEFAULT_STATUSES,
          cursor,
        }),
      ),
      listAll<Group>((cursor) => service.listGroups(who, { projectId, cursor })),
    ]);
    const colors = new Map(groups.map((g) => [g.id, g.color]));
    const details = await Promise.all(threads.map((t) => service.getThread(who, t.id)));
    if (disposed) return;
    const list: RenderableAnnotation[] = [];
    for (const { thread, annotation } of details) {
      if (!annotation) continue;
      const color = thread.groupId ? colors.get(thread.groupId) : undefined;
      list.push(toRenderable(thread, annotation, color ? { color } : {}));
    }
    inspector.setAnnotations(list);
  }

  /** Coalesce bursts of changes (creating a thread writes several records) into one reload. */
  function reload(): Promise<void> {
    queued ??= Promise.resolve()
      .then(load)
      .catch(fail)
      .finally(() => {
        queued = null;
      });
    return queued;
  }

  const offCreate = inspector.on("create", (draft) => {
    const groupId = opts.groupId?.();
    const input = draftToThreadInput(draft, { projectId, ...(groupId ? { groupId } : {}) });
    service
      .createThread(actor(), input)
      .then(async (detail) => {
        opts.onCreated?.(detail);
        if (!service.subscribe) await reload();
      })
      .catch(fail);
  });
  const offChanges = service.subscribe?.((change) => {
    if (change.collection !== "comments") void reload();
  });

  void reload();
  return {
    reload,
    unbind() {
      disposed = true;
      offCreate();
      offChanges?.();
    },
  };
}

/** {@link bindService} over a local service built on `storage`. */
export function bindStorage(inspector: Inspector, opts: BindStorageOptions): ServiceBinding {
  const { storage, ...rest } = opts;
  return bindService(inspector, { ...rest, service: createAnnotateKitService({ storage }) });
}
