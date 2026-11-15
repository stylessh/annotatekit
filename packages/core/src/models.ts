import type { CaptureContext, ElementAnchor, Point, Rect } from "./anchor/types.js";

/** ISO-8601 timestamp, e.g. `2026-11-15T15:47:18.000Z`. */
export type Timestamp = string;

/** Free-form, JSON-serialisable bag for adapter- or app-specific data. */
export type Metadata = Record<string, unknown>;

/** A person using AnnotateKit. */
export interface HumanActor {
  kind: "human";
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  /** Where this identity was verified, such as `host`, `oidc:okta`, `magic-link` or `shared-password`. */
  provider?: string;
  /** Whether the identity provider vouched for `email`. Email-domain rules only trust verified emails. */
  emailVerified?: boolean;
  /** Raw groups or roles from the identity provider or host app, before role mapping. */
  groups?: string[];
}

/**
 * An automated actor, such as a coding agent reached over MCP. `onBehalfOf`
 * is the id of the human that delegated the work, when known.
 */
export interface AgentActor {
  kind: "agent";
  id: string;
  name: string;
  model?: string;
  onBehalfOf?: string;
}

/** Anyone who can author comments or change a thread. */
export type Actor = HumanActor | AgentActor;

/**
 * Lifecycle of a thread.
 *
 * - `open`: new feedback, nobody has picked it up.
 * - `in_progress`: someone (often an agent) is working on it.
 * - `pending_review`: a fix was proposed and waits for a human to accept it.
 * - `resolved`: done.
 * - `dismissed`: closed without a change (won't fix, duplicate, invalid).
 */
export type ThreadStatus = "open" | "in_progress" | "pending_review" | "resolved" | "dismissed";

export type ThreadPriority = "low" | "normal" | "high" | "urgent";

/** What the feedback is about. Helps agents triage. */
export type ThreadIntent = "bug" | "change" | "question" | "praise" | "other";

/** Where the feedback was left. */
export interface PageContext {
  /** Full URL at capture time, including query and hash. */
  url: string;
  /** `location.origin`, used for whitelisting and filtering. */
  origin: string;
  /** `location.pathname`, used to group threads per page. */
  pathname: string;
  title?: string;
}

/** Something that points at the change that resolved a thread. */
export interface ResolutionReference {
  kind: "commit" | "pull_request" | "deploy" | "issue" | "url";
  url: string;
  label?: string;
}

export interface Resolution {
  resolvedBy: Actor;
  resolvedAt: Timestamp;
  note?: string;
  reference?: ResolutionReference;
  /** Set when a human accepted a fix that was `pending_review`. */
  reviewedBy?: Actor;
  reviewedAt?: Timestamp;
}

/**
 * The top-level unit of feedback: a conversation about one place on a page,
 * with a lifecycle. Its visual anchor lives in the linked {@link Annotation}
 * and its messages in {@link Comment}s.
 */
export interface Thread {
  id: string;
  projectId: string;
  annotationId: string;
  page: PageContext;
  status: ThreadStatus;
  title?: string;
  intent?: ThreadIntent;
  priority?: ThreadPriority;
  groupId?: string;
  tags?: string[];
  resolution?: Resolution;
  createdBy: Actor;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  commentCount: number;
  lastCommentAt?: Timestamp;
  metadata?: Metadata;
}

/**
 * How an annotation is drawn.
 *
 * - `pin`: a point on an element, at `position` (0..1 relative to the element box).
 * - `region`: a free rectangle, at `region` (document coordinates).
 * - `element`: the whole anchored element.
 */
export type AnnotationKind = "pin" | "region" | "element";

/** The visual mark on the page that a thread is attached to. */
export interface Annotation {
  id: string;
  projectId: string;
  threadId: string;
  kind: AnnotationKind;
  anchor: ElementAnchor;
  /** Pin location relative to the anchor element box; x and y in 0..1. */
  position?: Point;
  /** Region rectangle in document coordinates. */
  region?: Rect;
  context: CaptureContext;
  createdBy: Actor;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  metadata?: Metadata;
}

export type CommentFormat = "markdown" | "plain";

export interface CommentAttachment {
  kind: "image" | "file" | "link";
  url: string;
  name?: string;
  mimeType?: string;
}

export interface Comment {
  id: string;
  threadId: string;
  author: Actor;
  body: string;
  format: CommentFormat;
  mentions?: string[];
  attachments?: CommentAttachment[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  editedAt?: Timestamp;
  metadata?: Metadata;
}

/** A named bucket that threads can be grouped into, like "Checkout polish". */
export interface Group {
  id: string;
  projectId: string;
  name: string;
  color?: string;
  description?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  metadata?: Metadata;
}

/** A thread with everything needed to render it or hand it to an agent. */
export interface ThreadDetail {
  thread: Thread;
  annotation: Annotation | null;
  comments: Comment[];
}
