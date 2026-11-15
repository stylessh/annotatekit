import type {
  AnnotationQuery,
  Collection,
  CollectionName,
  CommentQuery,
  GroupQuery,
  Page,
  PageQuery,
  StorageChange,
  ThreadQuery,
} from "../adapters/storage.js";
import { AnnotateKitError } from "../errors.js";
import type { Annotation, Comment, Group, Thread } from "../models.js";

export const STATE_VERSION = 1;

/** The serialisable snapshot both built-in adapters keep. */
export interface StorageState {
  version: typeof STATE_VERSION;
  threads: Record<string, Thread>;
  annotations: Record<string, Annotation>;
  comments: Record<string, Comment>;
  groups: Record<string, Group>;
}

export function emptyState(): StorageState {
  return { version: STATE_VERSION, threads: {}, annotations: {}, comments: {}, groups: {} };
}

export const COLLECTIONS: readonly CollectionName[] = [
  "threads",
  "annotations",
  "comments",
  "groups",
];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * Hooks the state-backed collections use to load and save. `read` returns the
 * current state, which callers treat as read-only; `write` stores a new state
 * and reports what changed.
 */
export interface StateDriver {
  read(): StorageState;
  write(state: StorageState, changes: StorageChange[]): void;
}

export interface StateCollections {
  threads: Collection<Thread, ThreadQuery>;
  annotations: Collection<Annotation, AnnotationQuery>;
  comments: Collection<Comment, CommentQuery>;
  groups: Collection<Group, GroupQuery>;
}

export function createStateCollections(driver: StateDriver): StateCollections {
  return {
    threads: {
      get: async (id) => clone(driver.read().threads[id] ?? null),
      list: async (query = {}) =>
        paginate(Object.values(driver.read().threads).filter(threadFilter(query)), query),
      put: async (thread) => putEntity(driver, "threads", thread),
      delete: async (id) =>
        mutate(driver, (state, changes) => {
          if (!state.threads[id]) return false;
          delete state.threads[id];
          changes.push({ type: "delete", collection: "threads", id });
          for (const annotation of Object.values(state.annotations)) {
            if (annotation.threadId !== id) continue;
            delete state.annotations[annotation.id];
            changes.push({ type: "delete", collection: "annotations", id: annotation.id });
          }
          for (const comment of Object.values(state.comments)) {
            if (comment.threadId !== id) continue;
            delete state.comments[comment.id];
            changes.push({ type: "delete", collection: "comments", id: comment.id });
          }
          return true;
        }),
    },
    annotations: {
      get: async (id) => clone(driver.read().annotations[id] ?? null),
      list: async (query = {}) =>
        paginate(
          Object.values(driver.read().annotations).filter(
            (a) =>
              (query.projectId === undefined || a.projectId === query.projectId) &&
              (query.threadId === undefined || a.threadId === query.threadId),
          ),
          query,
        ),
      put: async (annotation) => putEntity(driver, "annotations", annotation),
      delete: async (id) => deleteEntity(driver, "annotations", id),
    },
    comments: {
      get: async (id) => clone(driver.read().comments[id] ?? null),
      list: async (query) => {
        if (!query?.threadId) {
          throw new AnnotateKitError("invalid_input", "comments.list requires a threadId");
        }
        return paginate(
          Object.values(driver.read().comments).filter((c) => c.threadId === query.threadId),
          query,
        );
      },
      put: async (comment) => putEntity(driver, "comments", comment),
      delete: async (id) => deleteEntity(driver, "comments", id),
    },
    groups: {
      get: async (id) => clone(driver.read().groups[id] ?? null),
      list: async (query = {}) =>
        paginate(
          Object.values(driver.read().groups).filter(
            (g) => query.projectId === undefined || g.projectId === query.projectId,
          ),
          query,
        ),
      put: async (group) => putEntity(driver, "groups", group),
      delete: async (id) =>
        mutate(driver, (state, changes) => {
          if (!state.groups[id]) return false;
          delete state.groups[id];
          changes.push({ type: "delete", collection: "groups", id });
          for (const thread of Object.values(state.threads)) {
            if (thread.groupId !== id) continue;
            const { groupId: _removed, ...rest } = thread;
            state.threads[thread.id] = rest;
            changes.push({
              type: "put",
              collection: "threads",
              id: thread.id,
              entity: clone(rest),
            });
          }
          return true;
        }),
    },
  };
}

/** Work out the changes between two snapshots, for cross-tab sync. */
export function diffStates(before: StorageState, after: StorageState): StorageChange[] {
  const changes: StorageChange[] = [];
  for (const collection of COLLECTIONS) {
    const prev = before[collection] as Record<string, { id: string }>;
    const next = after[collection] as Record<string, { id: string }>;
    for (const [id, entity] of Object.entries(next)) {
      const old = prev[id];
      if (!old || JSON.stringify(old) !== JSON.stringify(entity)) {
        changes.push({ type: "put", collection, id, entity: clone(entity) } as StorageChange);
      }
    }
    for (const id of Object.keys(prev)) {
      if (!(id in next)) changes.push({ type: "delete", collection, id });
    }
  }
  return changes;
}

/** Check that unknown input looks like a {@link StorageState}; fall back to empty. */
export function parseState(raw: unknown): StorageState {
  if (!raw || typeof raw !== "object") return emptyState();
  const value = raw as Partial<StorageState>;
  if (value.version !== STATE_VERSION) return emptyState();
  const state = emptyState();
  for (const collection of COLLECTIONS) {
    const records = value[collection];
    if (records && typeof records === "object") {
      (state as unknown as Record<CollectionName, unknown>)[collection] = records;
    }
  }
  return state;
}

export function clone<T>(value: T): T {
  return value === null || value === undefined ? value : structuredClone(value);
}

function mutate<R>(
  driver: StateDriver,
  fn: (state: StorageState, changes: StorageChange[]) => R,
): R {
  const state = structuredClone(driver.read());
  const changes: StorageChange[] = [];
  const result = fn(state, changes);
  if (changes.length > 0) driver.write(state, changes);
  return result;
}

function putEntity<K extends CollectionName>(
  driver: StateDriver,
  collection: K,
  entity: StorageState[K][string],
): StorageState[K][string] {
  if (!entity || typeof entity.id !== "string" || entity.id === "") {
    throw new AnnotateKitError("invalid_input", `${collection}.put requires an entity with an id`);
  }
  const stored = clone(entity);
  mutate(driver, (state, changes) => {
    (state[collection] as Record<string, unknown>)[stored.id] = stored;
    changes.push({
      type: "put",
      collection,
      id: stored.id,
      entity: clone(stored),
    } as StorageChange);
  });
  return clone(stored);
}

function deleteEntity(driver: StateDriver, collection: CollectionName, id: string): boolean {
  return mutate(driver, (state, changes) => {
    const records = state[collection] as Record<string, unknown>;
    if (!(id in records)) return false;
    delete records[id];
    changes.push({ type: "delete", collection, id });
    return true;
  });
}

function threadFilter(query: ThreadQuery): (thread: Thread) => boolean {
  const statuses = query.status === undefined ? undefined : new Set([query.status].flat());
  return (t) =>
    (query.projectId === undefined || t.projectId === query.projectId) &&
    (query.pageUrl === undefined || t.page.url === query.pageUrl) &&
    (query.pathname === undefined || t.page.pathname === query.pathname) &&
    (statuses === undefined || statuses.has(t.status)) &&
    (query.groupId === undefined || t.groupId === query.groupId) &&
    (query.authorId === undefined || t.createdBy.id === query.authorId) &&
    (query.tags === undefined || query.tags.every((tag) => t.tags?.includes(tag))) &&
    (query.updatedSince === undefined || t.updatedAt >= query.updatedSince);
}

function paginate<T extends { id: string; createdAt: string }>(
  items: T[],
  query: PageQuery,
): Page<T> {
  const limit = normalizeLimit(query.limit);
  const sorted = items.sort(compareByCreated);
  let start = 0;
  if (query.cursor) {
    const after = decodeCursor(query.cursor);
    start = sorted.findIndex(
      (item) => compareKeys(item.createdAt, item.id, after[0], after[1]) > 0,
    );
    if (start === -1) start = sorted.length;
  }
  const slice = sorted.slice(start, start + limit);
  const page: Page<T> = { items: slice.map(clone) };
  const last = slice[slice.length - 1];
  if (last && start + limit < sorted.length) page.nextCursor = encodeCursor(last);
  return page;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AnnotateKitError("invalid_input", `limit must be a positive integer, got ${limit}`);
  }
  return Math.min(limit, MAX_LIMIT);
}

function compareByCreated(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
) {
  return compareKeys(a.createdAt, a.id, b.createdAt, b.id);
}

function compareKeys(aTime: string, aId: string, bTime: string, bId: string): number {
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  if (aId !== bId) return aId < bId ? -1 : 1;
  return 0;
}

function encodeCursor(item: { createdAt: string; id: string }): string {
  return encodeURIComponent(JSON.stringify([item.createdAt, item.id]));
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(decodeURIComponent(cursor));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // fall through
  }
  throw new AnnotateKitError("invalid_input", `Invalid cursor: ${cursor}`);
}
