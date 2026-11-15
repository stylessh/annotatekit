import type { Annotation, Comment, Group, Thread, ThreadStatus, Timestamp } from "../models.js";

export type Unsubscribe = () => void;

/** One page of results. `nextCursor` is absent on the last page. */
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface PageQuery {
  /** Opaque cursor from a previous {@link Page.nextCursor}. */
  cursor?: string | undefined;
  /** Page size. Adapters pick a default (the built-in ones use 50). */
  limit?: number | undefined;
}

export interface ThreadQuery extends PageQuery {
  projectId?: string | undefined;
  /** Exact match on `page.url`. */
  pageUrl?: string | undefined;
  /** Exact match on `page.pathname`. */
  pathname?: string | undefined;
  status?: ThreadStatus | ThreadStatus[] | undefined;
  groupId?: string | undefined;
  /** Matches `createdBy.id`. */
  authorId?: string | undefined;
  /** Threads that carry every tag listed. */
  tags?: string[] | undefined;
  /** Threads updated at or after this time. */
  updatedSince?: Timestamp | undefined;
}

export interface AnnotationQuery extends PageQuery {
  projectId?: string | undefined;
  threadId?: string | undefined;
}

export interface CommentQuery extends PageQuery {
  threadId: string;
}

export interface GroupQuery extends PageQuery {
  projectId?: string | undefined;
}

/**
 * Uniform CRUD over one entity type. `put` inserts or replaces by id and
 * returns the stored copy. `delete` returns whether something was removed.
 */
export interface Collection<T extends { id: string }, Q extends PageQuery> {
  get(id: string): Promise<T | null>;
  list(query?: Q): Promise<Page<T>>;
  put(entity: T): Promise<T>;
  delete(id: string): Promise<boolean>;
}

export type CollectionName = "threads" | "annotations" | "comments" | "groups";

interface EntityByCollection {
  threads: Thread;
  annotations: Annotation;
  comments: Comment;
  groups: Group;
}

export type StorageChange = {
  [K in CollectionName]:
    | { type: "put"; collection: K; id: string; entity: EntityByCollection[K] }
    | { type: "delete"; collection: K; id: string };
}[CollectionName];

export type StorageListener = (change: StorageChange) => void;

/**
 * Where threads, annotations, comments and groups are persisted.
 *
 * Adapters are deliberately dumb: validation, id generation, permissions and
 * status rules happen above them. Two rules adapters must follow:
 *
 * - Deleting a thread also deletes its annotation and comments.
 * - Deleting a group clears `groupId` on threads that pointed at it.
 *
 * Results are returned as copies; mutating them must not change stored data.
 * Lists are ordered by `createdAt`, oldest first, then by `id`.
 */
export interface StorageAdapter {
  readonly name: string;
  readonly threads: Collection<Thread, ThreadQuery>;
  readonly annotations: Collection<Annotation, AnnotationQuery>;
  readonly comments: Collection<Comment, CommentQuery>;
  readonly groups: Collection<Group, GroupQuery>;
  /** Called after every change, including ones made in another tab or by a backend. */
  subscribe?(listener: StorageListener): Unsubscribe;
  /** Release connections, listeners and timers. */
  close?(): Promise<void>;
}
