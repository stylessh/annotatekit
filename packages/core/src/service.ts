import { validateAttachments } from "./adapters/attachments.js";
import type { AuthAction, AuthorizationRequest } from "./adapters/auth.js";
import {
  createReviewResolution,
  type ResolutionAdapter,
  type ResolutionOutcome,
} from "./adapters/resolution.js";
import type {
  CommentQuery,
  GroupQuery,
  Page,
  StorageAdapter,
  StorageListener,
  ThreadQuery,
  Unsubscribe,
} from "./adapters/storage.js";
import type { CaptureContext, ElementAnchor, Point, Rect } from "./anchor/types.js";
import { AnnotateKitError } from "./errors.js";
import { createId } from "./ids.js";
import type {
  Actor,
  Annotation,
  AnnotationKind,
  Comment,
  CommentAttachment,
  CommentFormat,
  Group,
  Metadata,
  PageContext,
  ResolutionReference,
  Thread,
  ThreadDetail,
  ThreadIntent,
  ThreadPriority,
  ThreadStatus,
  Timestamp,
} from "./models.js";
import { canTransition, THREAD_STATUSES } from "./status.js";

/** Permission check used by the service. Return `false` to deny. */
export type Authorizer = (request: AuthorizationRequest) => boolean | Promise<boolean>;

export interface AnnotateKitServiceOptions {
  storage: StorageAdapter;
  /** Decides what resolve means. Defaults to {@link createReviewResolution}. */
  resolution?: ResolutionAdapter;
  /** Extra permission check. Without it, any non-null actor may do anything. */
  authorize?: Authorizer;
  now?: () => Timestamp;
}

export interface NewAnnotationInput {
  kind: AnnotationKind;
  anchor: ElementAnchor;
  position?: Point;
  region?: Rect;
  context: CaptureContext;
  metadata?: Metadata;
}

export interface NewCommentInput {
  body: string;
  format?: CommentFormat;
  mentions?: string[];
  attachments?: CommentAttachment[];
  metadata?: Metadata;
}

export interface CreateThreadInput {
  projectId: string;
  page: PageContext;
  annotation: NewAnnotationInput;
  /** The first message. Optional, so a pin can be dropped before typing. */
  comment?: NewCommentInput;
  title?: string;
  intent?: ThreadIntent;
  priority?: ThreadPriority;
  groupId?: string;
  tags?: string[];
  metadata?: Metadata;
}

/** Fields that can be changed with {@link AnnotateKitService.updateThread}. `null` clears a field. */
export interface UpdateThreadInput {
  title?: string | null;
  intent?: ThreadIntent | null;
  priority?: ThreadPriority | null;
  groupId?: string | null;
  tags?: string[] | null;
  metadata?: Metadata | null;
}

export interface SetStatusInput {
  /** Any status but `resolved`, which goes through {@link AnnotateKitService.resolveThread}. */
  status: Exclude<ThreadStatus, "resolved" | "pending_review">;
  /** Posted as a plain system comment so the thread shows who changed what. */
  note?: string;
  /** Merged into the system comment's metadata, for audit. */
  metadata?: Metadata;
}

export interface ResolveThreadInput {
  note?: string;
  reference?: ResolutionReference;
  /** Merged into the system comment's metadata, for audit. */
  metadata?: Metadata;
}

export interface ReopenThreadInput {
  reason?: string;
  metadata?: Metadata;
}

export interface UpdateCommentInput {
  body: string;
}

export interface CreateGroupInput {
  projectId: string;
  name: string;
  color?: string;
  description?: string;
  metadata?: Metadata;
}

export interface UpdateGroupInput {
  name?: string;
  color?: string | null;
  description?: string | null;
  metadata?: Metadata | null;
}

/**
 * The rules layer between callers (renderers, HTTP server, MCP server) and a
 * {@link StorageAdapter}: ids, timestamps, permissions, status transitions,
 * comment counts and resolution policy. Every call takes the acting
 * {@link Actor}, so one service can serve many users.
 */
export interface AnnotateKitService {
  listThreads(actor: Actor | null, query?: ThreadQuery): Promise<Page<Thread>>;
  getThread(actor: Actor | null, threadId: string): Promise<ThreadDetail>;
  createThread(actor: Actor | null, input: CreateThreadInput): Promise<ThreadDetail>;
  updateThread(actor: Actor | null, threadId: string, input: UpdateThreadInput): Promise<Thread>;
  setThreadStatus(actor: Actor | null, threadId: string, input: SetStatusInput): Promise<Thread>;
  resolveThread(actor: Actor | null, threadId: string, input?: ResolveThreadInput): Promise<Thread>;
  reopenThread(actor: Actor | null, threadId: string, input?: ReopenThreadInput): Promise<Thread>;
  deleteThread(actor: Actor | null, threadId: string): Promise<void>;

  listComments(actor: Actor | null, query: CommentQuery): Promise<Page<Comment>>;
  addComment(actor: Actor | null, threadId: string, input: NewCommentInput): Promise<Comment>;
  updateComment(
    actor: Actor | null,
    commentId: string,
    input: UpdateCommentInput,
  ): Promise<Comment>;
  deleteComment(actor: Actor | null, commentId: string): Promise<void>;

  listGroups(actor: Actor | null, query?: GroupQuery): Promise<Page<Group>>;
  createGroup(actor: Actor | null, input: CreateGroupInput): Promise<Group>;
  updateGroup(actor: Actor | null, groupId: string, input: UpdateGroupInput): Promise<Group>;
  deleteGroup(actor: Actor | null, groupId: string): Promise<void>;

  /** Live changes, when the backing storage can report them. */
  subscribe?(listener: StorageListener): Unsubscribe;
}

/** A service running in this process over a {@link StorageAdapter}. */
export interface LocalAnnotateKitService extends AnnotateKitService {
  readonly storage: StorageAdapter;
}

const MAX_COMMENT_LENGTH = 20_000;

export function createAnnotateKitService(
  options: AnnotateKitServiceOptions,
): LocalAnnotateKitService {
  const { storage } = options;
  const resolution = options.resolution ?? createReviewResolution();
  const now = options.now ?? monotonicClock();

  async function check(
    actor: Actor | null,
    action: AuthAction,
    extra: Omit<AuthorizationRequest, "actor" | "action"> = {},
  ): Promise<Actor> {
    const isRead = action === "thread:read";
    if (!actor && !isRead) {
      throw new AnnotateKitError("unauthorized", "Sign in to do this");
    }
    if (options.authorize && !(await options.authorize({ actor, action, ...extra }))) {
      throw new AnnotateKitError("forbidden", `Not allowed: ${action}`);
    }
    // Reads may be anonymous when the authorizer allows them.
    return actor as Actor;
  }

  async function loadThread(threadId: string): Promise<Thread> {
    const thread = await storage.threads.get(threadId);
    if (!thread) throw new AnnotateKitError("not_found", `Thread ${threadId} not found`);
    return thread;
  }

  async function loadComment(commentId: string): Promise<Comment> {
    const comment = await storage.comments.get(commentId);
    if (!comment) throw new AnnotateKitError("not_found", `Comment ${commentId} not found`);
    return comment;
  }

  async function loadGroup(groupId: string): Promise<Group> {
    const group = await storage.groups.get(groupId);
    if (!group) throw new AnnotateKitError("not_found", `Group ${groupId} not found`);
    return group;
  }

  async function assertGroup(projectId: string, groupId: string | undefined | null) {
    if (!groupId) return;
    const group = await loadGroup(groupId);
    if (group.projectId !== projectId) {
      throw new AnnotateKitError("invalid_input", `Group ${groupId} belongs to another project`);
    }
  }

  async function writeComment(thread: Thread, author: Actor, input: NewCommentInput) {
    const attachments = validateAttachments(input.attachments);
    // A comment can be just an attachment, e.g. a screenshot.
    const body = attachments?.length && !input.body?.trim() ? "" : validateBody(input.body);
    const at = now();
    const comment: Comment = {
      id: createId("cmt"),
      threadId: thread.id,
      author,
      body,
      format: input.format ?? "markdown",
      createdAt: at,
      updatedAt: at,
    };
    if (input.mentions?.length) comment.mentions = [...input.mentions];
    if (attachments?.length) comment.attachments = structuredClone(attachments);
    if (input.metadata) comment.metadata = structuredClone(input.metadata);
    const stored = await storage.comments.put(comment);
    await storage.threads.put({
      ...thread,
      commentCount: thread.commentCount + 1,
      lastCommentAt: at,
      updatedAt: at,
    });
    return stored;
  }

  async function systemComment(
    thread: Thread,
    actor: Actor,
    body: string,
    event: string,
    metadata: Metadata | undefined,
  ): Promise<Thread> {
    await writeComment(thread, actor, {
      body,
      format: "plain",
      metadata: { ...metadata, system: true, event },
    });
    return loadThread(thread.id);
  }

  async function applyOutcome(thread: Thread, outcome: ResolutionOutcome): Promise<Thread> {
    const next: Thread = { ...thread, status: outcome.status, updatedAt: now() };
    if (outcome.resolution) next.resolution = outcome.resolution;
    else delete next.resolution;
    return storage.threads.put(next);
  }

  const service: LocalAnnotateKitService = {
    storage,

    async listThreads(actor, query = {}) {
      await check(actor, "thread:read");
      return storage.threads.list(query);
    },

    async getThread(actor, threadId) {
      const thread = await loadThread(threadId);
      await check(actor, "thread:read", { thread });
      const annotation = await storage.annotations.get(thread.annotationId);
      const comments: Comment[] = [];
      let cursor: string | undefined;
      do {
        const page = await storage.comments.list({ threadId, cursor, limit: 500 });
        comments.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return { thread, annotation, comments };
    },

    async createThread(actor, input) {
      if (!input.projectId) throw new AnnotateKitError("invalid_input", "projectId is required");
      validatePage(input.page);
      validateAnnotation(input.annotation);
      await assertGroup(input.projectId, input.groupId);
      const at = now();
      const threadId = createId("thr");
      const annotationId = createId("ann");
      const thread: Thread = {
        id: threadId,
        projectId: input.projectId,
        annotationId,
        page: { ...input.page },
        status: "open",
        createdBy: actor as Actor,
        createdAt: at,
        updatedAt: at,
        commentCount: 0,
      };
      if (input.title !== undefined) thread.title = input.title;
      if (input.intent !== undefined) thread.intent = input.intent;
      if (input.priority !== undefined) thread.priority = input.priority;
      if (input.groupId !== undefined) thread.groupId = input.groupId;
      if (input.tags !== undefined) thread.tags = [...input.tags];
      if (input.metadata !== undefined) thread.metadata = structuredClone(input.metadata);
      const author = await check(actor, "thread:create", { thread });
      thread.createdBy = author;

      const annotation: Annotation = {
        id: annotationId,
        projectId: input.projectId,
        threadId,
        kind: input.annotation.kind,
        anchor: structuredClone(input.annotation.anchor),
        context: structuredClone(input.annotation.context),
        createdBy: author,
        createdAt: at,
        updatedAt: at,
      };
      if (input.annotation.position) annotation.position = { ...input.annotation.position };
      if (input.annotation.region) annotation.region = { ...input.annotation.region };
      if (input.annotation.metadata)
        annotation.metadata = structuredClone(input.annotation.metadata);

      let storedThread = await storage.threads.put(thread);
      const storedAnnotation = await storage.annotations.put(annotation);
      const comments: Comment[] = [];
      if (input.comment) {
        comments.push(await writeComment(storedThread, author, input.comment));
        storedThread = await loadThread(threadId);
      }
      return { thread: storedThread, annotation: storedAnnotation, comments };
    },

    async updateThread(actor, threadId, input) {
      const thread = await loadThread(threadId);
      await check(actor, "thread:update", { thread });
      if (input.groupId) await assertGroup(thread.projectId, input.groupId);
      const next: Thread = { ...thread, updatedAt: now() };
      for (const key of ["title", "intent", "priority", "groupId", "tags", "metadata"] as const) {
        const value = input[key];
        if (value === undefined) continue;
        if (value === null) delete next[key];
        else (next as unknown as Record<string, unknown>)[key] = structuredClone(value);
      }
      return storage.threads.put(next);
    },

    async setThreadStatus(actor, threadId, input) {
      const thread = await loadThread(threadId);
      const status = input.status as ThreadStatus;
      if (
        !THREAD_STATUSES.includes(status) ||
        status === "resolved" ||
        status === "pending_review"
      ) {
        throw new AnnotateKitError(
          "invalid_input",
          `Use resolveThread to resolve; got status ${String(input.status)}`,
        );
      }
      // Dismissing closes a thread, so it needs the same permission as resolving.
      // Picking up or handing back is open to any writer.
      const action = status === "dismissed" ? "thread:resolve" : "thread:status";
      const author = await check(actor, action, { thread });
      if (thread.status === status) return thread;
      if (!canTransition(thread.status, status)) {
        throw new AnnotateKitError(
          "invalid_transition",
          `Cannot move a thread from ${thread.status} to ${status}`,
        );
      }
      const next: Thread = { ...thread, status, updatedAt: now() };
      if (status === "open") delete next.resolution;
      const stored = await storage.threads.put(next);
      const verb = status === "dismissed" ? "dismissed this thread" : `set status to ${status}`;
      const body = input.note ? `${author.name} ${verb}: ${input.note}` : `${author.name} ${verb}`;
      const event = status === "dismissed" ? "dismiss" : "status";
      return systemComment(stored, author, body, event, { ...input.metadata, status });
    },

    async resolveThread(actor, threadId, input = {}) {
      const thread = await loadThread(threadId);
      const author = await check(actor, "thread:resolve", { thread });
      const request: Parameters<ResolutionAdapter["resolve"]>[0] = { thread, actor: author };
      if (input.note !== undefined) request.note = input.note;
      if (input.reference !== undefined) request.reference = input.reference;
      const outcome = await resolution.resolve(request);
      const stored = await applyOutcome(thread, outcome);
      await resolution.onResolved?.(stored);
      const verb =
        outcome.status === "pending_review"
          ? "proposed a fix for review"
          : thread.status === "pending_review"
            ? "approved the fix"
            : "resolved this thread";
      const body = input.note ? `${author.name} ${verb}: ${input.note}` : `${author.name} ${verb}`;
      return systemComment(stored, author, body, "resolve", {
        ...input.metadata,
        status: outcome.status,
        ...(input.reference ? { reference: input.reference } : {}),
      });
    },

    async reopenThread(actor, threadId, input = {}) {
      const thread = await loadThread(threadId);
      const author = await check(actor, "thread:resolve", { thread });
      let outcome: ResolutionOutcome;
      if (resolution.reopen) {
        const request: Parameters<NonNullable<ResolutionAdapter["reopen"]>>[0] = {
          thread,
          actor: author,
        };
        if (input.reason !== undefined) request.reason = input.reason;
        outcome = await resolution.reopen(request);
      } else {
        if (!canTransition(thread.status, "open")) {
          throw new AnnotateKitError(
            "invalid_transition",
            `Cannot move a thread from ${thread.status} to open`,
          );
        }
        outcome = { status: "open" };
      }
      const stored = await applyOutcome(thread, outcome);
      const body = input.reason
        ? `${author.name} reopened this thread: ${input.reason}`
        : `${author.name} reopened this thread`;
      return systemComment(stored, author, body, "reopen", { ...input.metadata, status: "open" });
    },

    async deleteThread(actor, threadId) {
      const thread = await loadThread(threadId);
      await check(actor, "thread:delete", { thread });
      await storage.threads.delete(threadId);
    },

    async listComments(actor, query) {
      const thread = await loadThread(query.threadId);
      await check(actor, "thread:read", { thread });
      return storage.comments.list(query);
    },

    async addComment(actor, threadId, input) {
      const thread = await loadThread(threadId);
      const author = await check(actor, "comment:create", { thread });
      return writeComment(thread, author, input);
    },

    async updateComment(actor, commentId, input) {
      const comment = await loadComment(commentId);
      const thread = await loadThread(comment.threadId);
      const author = await check(actor, "comment:update", { thread, comment });
      if (author.id !== comment.author.id && !options.authorize) {
        throw new AnnotateKitError("forbidden", "Only the author can edit a comment");
      }
      const at = now();
      return storage.comments.put({
        ...comment,
        body: validateBody(input.body),
        updatedAt: at,
        editedAt: at,
      });
    },

    async deleteComment(actor, commentId) {
      const comment = await loadComment(commentId);
      const thread = await loadThread(comment.threadId);
      const author = await check(actor, "comment:delete", { thread, comment });
      if (author.id !== comment.author.id && !options.authorize) {
        throw new AnnotateKitError("forbidden", "Only the author can delete a comment");
      }
      await storage.comments.delete(commentId);
      await storage.threads.put({
        ...thread,
        commentCount: Math.max(0, thread.commentCount - 1),
        updatedAt: now(),
      });
    },

    async listGroups(actor, query = {}) {
      await check(actor, "thread:read");
      return storage.groups.list(query);
    },

    async createGroup(actor, input) {
      if (!input.projectId) throw new AnnotateKitError("invalid_input", "projectId is required");
      const name = input.name?.trim();
      if (!name) throw new AnnotateKitError("invalid_input", "Group name is required");
      const at = now();
      const group: Group = {
        id: createId("grp"),
        projectId: input.projectId,
        name,
        createdAt: at,
        updatedAt: at,
      };
      if (input.color !== undefined) group.color = input.color;
      if (input.description !== undefined) group.description = input.description;
      if (input.metadata !== undefined) group.metadata = structuredClone(input.metadata);
      await check(actor, "group:manage", { group });
      return storage.groups.put(group);
    },

    async updateGroup(actor, groupId, input) {
      const group = await loadGroup(groupId);
      await check(actor, "group:manage", { group });
      const next: Group = { ...group, updatedAt: now() };
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) throw new AnnotateKitError("invalid_input", "Group name is required");
        next.name = name;
      }
      for (const key of ["color", "description", "metadata"] as const) {
        const value = input[key];
        if (value === undefined) continue;
        if (value === null) delete next[key];
        else (next as unknown as Record<string, unknown>)[key] = structuredClone(value);
      }
      return storage.groups.put(next);
    },

    async deleteGroup(actor, groupId) {
      const group = await loadGroup(groupId);
      await check(actor, "group:manage", { group });
      await storage.groups.delete(groupId);
    },
  };
  if (storage.subscribe) {
    const subscribe = storage.subscribe.bind(storage);
    service.subscribe = (listener) => subscribe(listener);
  }
  return service;
}

/**
 * ISO timestamps that never repeat or go backwards within one service, so
 * comments written in the same millisecond keep their order.
 */
function monotonicClock(): () => Timestamp {
  let last = 0;
  return () => {
    last = Math.max(Date.now(), last + 1);
    return new Date(last).toISOString();
  };
}

function validateBody(body: unknown): string {
  if (typeof body !== "string" || body.trim() === "") {
    throw new AnnotateKitError("invalid_input", "Comment body is required");
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new AnnotateKitError(
      "invalid_input",
      `Comment body is longer than ${MAX_COMMENT_LENGTH} characters`,
    );
  }
  return body;
}

function validatePage(page: PageContext | undefined): void {
  if (!page || typeof page.url !== "string") {
    throw new AnnotateKitError("invalid_input", "page.url is required");
  }
  try {
    new URL(page.url);
  } catch {
    throw new AnnotateKitError("invalid_input", `page.url is not a valid URL: ${page.url}`);
  }
  if (typeof page.origin !== "string" || typeof page.pathname !== "string") {
    throw new AnnotateKitError("invalid_input", "page.origin and page.pathname are required");
  }
}

function validateAnnotation(annotation: NewAnnotationInput | undefined): void {
  if (!annotation) throw new AnnotateKitError("invalid_input", "annotation is required");
  if (!["pin", "region", "element"].includes(annotation.kind)) {
    throw new AnnotateKitError("invalid_input", `Unknown annotation kind: ${annotation.kind}`);
  }
  if (!annotation.anchor || typeof annotation.anchor.selector !== "string") {
    throw new AnnotateKitError("invalid_input", "annotation.anchor.selector is required");
  }
  if (!annotation.context?.viewport) {
    throw new AnnotateKitError("invalid_input", "annotation.context.viewport is required");
  }
}

/** Build {@link PageContext} from a URL string. */
export function pageContextFromUrl(url: string, title?: string): PageContext {
  const parsed = new URL(url);
  const page: PageContext = { url: parsed.href, origin: parsed.origin, pathname: parsed.pathname };
  if (title !== undefined) page.title = title;
  return page;
}
