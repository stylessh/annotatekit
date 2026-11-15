import {
  AnnotateKitError,
  type Annotation,
  type AnnotationQuery,
  type Collection,
  type CollectionName,
  type Comment,
  type CommentQuery,
  type Group,
  type GroupQuery,
  type Page,
  type PageQuery,
  type StorageAdapter,
  type StorageChange,
  type StorageListener,
  type Thread,
  type ThreadQuery,
} from "@annotatekit/core";
import { openDatabase, type SqliteDatabase } from "./driver.js";

export type { SqliteDatabase, SqliteStatement } from "./driver.js";
export { openDatabase } from "./driver.js";

export interface SqliteStorageOptions {
  /**
   * A file path, `:memory:`, or an open database. Any driver with the
   * `better-sqlite3` shape works (`node:sqlite`, `better-sqlite3`, `bun:sqlite`).
   * Defaults to `:memory:` with `node:sqlite`.
   */
  database?: string | SqliteDatabase;
  /** Prefix for table names, to share a database with other data. Defaults to `ak_`. */
  tablePrefix?: string;
}

export interface SqliteStorageAdapter extends StorageAdapter {
  readonly database: SqliteDatabase;
  subscribe(listener: StorageListener): () => void;
  close(): Promise<void>;
}

const SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * A {@link StorageAdapter} backed by SQLite. Each entity is stored as JSON,
 * with the fields that queries filter on copied into indexed columns.
 *
 * `subscribe` reports changes made through this adapter instance. Writes from
 * other processes are not observed.
 */
export function createSqliteStorage(options: SqliteStorageOptions = {}): SqliteStorageAdapter {
  const ownsDatabase = typeof options.database !== "object";
  const db =
    typeof options.database === "object"
      ? options.database
      : openDatabase(options.database ?? ":memory:");
  const prefix = options.tablePrefix ?? "ak_";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
    throw new AnnotateKitError("invalid_input", `Invalid table prefix: ${prefix}`);
  }
  const t = {
    threads: `${prefix}threads`,
    annotations: `${prefix}annotations`,
    comments: `${prefix}comments`,
    groups: `${prefix}groups`,
    meta: `${prefix}meta`,
  };
  migrate(db, t);

  const listeners = new Set<StorageListener>();
  let closed = false;

  function emit(changes: StorageChange[]) {
    for (const change of changes) for (const listener of listeners) listener(change);
  }

  function assertOpen() {
    if (closed) throw new AnnotateKitError("storage_unavailable", "SQLite storage is closed");
  }

  function transaction<R>(fn: () => R): R {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function getRow<T>(table: string, id: string): T | null {
    assertOpen();
    const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  function listRows<T>(
    table: string,
    where: string[],
    params: unknown[],
    query: PageQuery,
  ): Page<T> {
    assertOpen();
    const limit = normalizeLimit(query.limit);
    const clauses = [...where];
    const args = [...params];
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor);
      clauses.push("(created_at > ? OR (created_at = ? AND id > ?))");
      args.push(createdAt, createdAt, id);
    }
    const sql = `SELECT id, created_at, data FROM ${table}${
      clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""
    } ORDER BY created_at, id LIMIT ?`;
    const rows = db.prepare(sql).all(...args, limit + 1) as {
      id: string;
      created_at: string;
      data: string;
    }[];
    const items = rows.slice(0, limit);
    const page: Page<T> = { items: items.map((row) => JSON.parse(row.data) as T) };
    const last = items[items.length - 1];
    if (last && rows.length > limit) {
      page.nextCursor = encodeCursor(last.created_at, last.id);
    }
    return page;
  }

  function deleteRow(table: string, id: string): boolean {
    return db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
  }

  function requireId(collection: CollectionName, entity: { id?: unknown } | null | undefined) {
    if (!entity || typeof entity.id !== "string" || entity.id === "") {
      throw new AnnotateKitError(
        "invalid_input",
        `${collection}.put requires an entity with an id`,
      );
    }
  }

  const putThread = db.prepare(
    `INSERT OR REPLACE INTO ${t.threads}
      (id, project_id, status, page_url, pathname, group_id, author_id, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const putAnnotation = db.prepare(
    `INSERT OR REPLACE INTO ${t.annotations} (id, project_id, thread_id, created_at, data)
      VALUES (?, ?, ?, ?, ?)`,
  );
  const putComment = db.prepare(
    `INSERT OR REPLACE INTO ${t.comments} (id, thread_id, created_at, data) VALUES (?, ?, ?, ?)`,
  );
  const putGroup = db.prepare(
    `INSERT OR REPLACE INTO ${t.groups} (id, project_id, created_at, data) VALUES (?, ?, ?, ?)`,
  );

  function writeThread(thread: Thread) {
    putThread.run(
      thread.id,
      thread.projectId,
      thread.status,
      thread.page?.url ?? null,
      thread.page?.pathname ?? null,
      thread.groupId ?? null,
      thread.createdBy?.id ?? null,
      thread.createdAt,
      thread.updatedAt,
      JSON.stringify(thread),
    );
  }

  const threads: Collection<Thread, ThreadQuery> = {
    get: async (id) => getRow<Thread>(t.threads, id),
    list: async (query = {}) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const eq = (column: string, value: string | undefined) => {
        if (value === undefined) return;
        where.push(`${column} = ?`);
        params.push(value);
      };
      eq("project_id", query.projectId);
      eq("page_url", query.pageUrl);
      eq("pathname", query.pathname);
      eq("group_id", query.groupId);
      eq("author_id", query.authorId);
      if (query.status !== undefined) {
        const statuses = [query.status].flat();
        where.push(`status IN (${statuses.map(() => "?").join(", ")})`);
        params.push(...statuses);
      }
      for (const tag of query.tags ?? []) {
        where.push(`EXISTS (SELECT 1 FROM json_each(data, '$.tags') WHERE value = ?)`);
        params.push(tag);
      }
      if (query.updatedSince !== undefined) {
        where.push("updated_at >= ?");
        params.push(query.updatedSince);
      }
      return listRows<Thread>(t.threads, where, params, query);
    },
    put: async (thread) => {
      assertOpen();
      requireId("threads", thread);
      const stored = structuredClone(thread);
      writeThread(stored);
      emit([
        { type: "put", collection: "threads", id: stored.id, entity: structuredClone(stored) },
      ]);
      return stored;
    },
    delete: async (id) => {
      assertOpen();
      const changes: StorageChange[] = [];
      const removed = transaction(() => {
        if (!deleteRow(t.threads, id)) return false;
        changes.push({ type: "delete", collection: "threads", id });
        for (const [table, collection] of [
          [t.annotations, "annotations"],
          [t.comments, "comments"],
        ] as const) {
          const rows = db
            .prepare(`SELECT id FROM ${table} WHERE thread_id = ? ORDER BY created_at, id`)
            .all(id) as { id: string }[];
          db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(id);
          for (const row of rows) changes.push({ type: "delete", collection, id: row.id });
        }
        return true;
      });
      emit(changes);
      return removed;
    },
  };

  const annotations: Collection<Annotation, AnnotationQuery> = {
    get: async (id) => getRow<Annotation>(t.annotations, id),
    list: async (query = {}) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (query.projectId !== undefined) {
        where.push("project_id = ?");
        params.push(query.projectId);
      }
      if (query.threadId !== undefined) {
        where.push("thread_id = ?");
        params.push(query.threadId);
      }
      return listRows<Annotation>(t.annotations, where, params, query);
    },
    put: async (annotation) => {
      assertOpen();
      requireId("annotations", annotation);
      const stored = structuredClone(annotation);
      putAnnotation.run(
        stored.id,
        stored.projectId,
        stored.threadId,
        stored.createdAt,
        JSON.stringify(stored),
      );
      emit([
        {
          type: "put",
          collection: "annotations",
          id: stored.id,
          entity: structuredClone(stored),
        },
      ]);
      return stored;
    },
    delete: async (id) => {
      assertOpen();
      const removed = deleteRow(t.annotations, id);
      if (removed) emit([{ type: "delete", collection: "annotations", id }]);
      return removed;
    },
  };

  const comments: Collection<Comment, CommentQuery> = {
    get: async (id) => getRow<Comment>(t.comments, id),
    list: async (query) => {
      if (!query?.threadId) {
        throw new AnnotateKitError("invalid_input", "comments.list requires a threadId");
      }
      return listRows<Comment>(t.comments, ["thread_id = ?"], [query.threadId], query);
    },
    put: async (comment) => {
      assertOpen();
      requireId("comments", comment);
      const stored = structuredClone(comment);
      putComment.run(stored.id, stored.threadId, stored.createdAt, JSON.stringify(stored));
      emit([
        { type: "put", collection: "comments", id: stored.id, entity: structuredClone(stored) },
      ]);
      return stored;
    },
    delete: async (id) => {
      assertOpen();
      const removed = deleteRow(t.comments, id);
      if (removed) emit([{ type: "delete", collection: "comments", id }]);
      return removed;
    },
  };

  const groups: Collection<Group, GroupQuery> = {
    get: async (id) => getRow<Group>(t.groups, id),
    list: async (query = {}) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (query.projectId !== undefined) {
        where.push("project_id = ?");
        params.push(query.projectId);
      }
      return listRows<Group>(t.groups, where, params, query);
    },
    put: async (group) => {
      assertOpen();
      requireId("groups", group);
      const stored = structuredClone(group);
      putGroup.run(stored.id, stored.projectId, stored.createdAt, JSON.stringify(stored));
      emit([{ type: "put", collection: "groups", id: stored.id, entity: structuredClone(stored) }]);
      return stored;
    },
    delete: async (id) => {
      assertOpen();
      const changes: StorageChange[] = [];
      const removed = transaction(() => {
        if (!deleteRow(t.groups, id)) return false;
        changes.push({ type: "delete", collection: "groups", id });
        const rows = db
          .prepare(`SELECT data FROM ${t.threads} WHERE group_id = ? ORDER BY created_at, id`)
          .all(id) as { data: string }[];
        for (const row of rows) {
          const { groupId: _removed, ...thread } = JSON.parse(row.data) as Thread;
          writeThread(thread);
          changes.push({ type: "put", collection: "threads", id: thread.id, entity: thread });
        }
        return true;
      });
      emit(changes);
      return removed;
    },
  };

  return {
    name: "sqlite",
    database: db,
    threads,
    annotations,
    comments,
    groups,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      if (ownsDatabase) db.close();
    },
  };
}

function migrate(db: SqliteDatabase, t: Record<string, string>) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${t.meta} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.prepare(`SELECT value FROM ${t.meta} WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  const version = row ? Number(row.value) : 0;
  if (version > SCHEMA_VERSION) {
    throw new AnnotateKitError(
      "storage_unavailable",
      `Database schema v${version} is newer than this adapter (v${SCHEMA_VERSION})`,
    );
  }
  if (version === SCHEMA_VERSION) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${t.threads} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      page_url TEXT,
      pathname TEXT,
      group_id TEXT,
      author_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${t.threads}_project ON ${t.threads} (project_id, status, created_at, id);
    CREATE INDEX IF NOT EXISTS ${t.threads}_created ON ${t.threads} (created_at, id);
    CREATE INDEX IF NOT EXISTS ${t.threads}_page ON ${t.threads} (pathname);
    CREATE INDEX IF NOT EXISTS ${t.threads}_group ON ${t.threads} (group_id);
    CREATE TABLE IF NOT EXISTS ${t.annotations} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${t.annotations}_thread ON ${t.annotations} (thread_id);
    CREATE TABLE IF NOT EXISTS ${t.comments} (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${t.comments}_thread ON ${t.comments} (thread_id, created_at, id);
    CREATE TABLE IF NOT EXISTS ${t.groups} (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${t.groups}_project ON ${t.groups} (project_id);
  `);
  db.prepare(`INSERT OR REPLACE INTO ${t.meta} (key, value) VALUES ('schema_version', ?)`).run(
    String(SCHEMA_VERSION),
  );
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AnnotateKitError("invalid_input", `limit must be a positive integer, got ${limit}`);
  }
  return Math.min(limit, MAX_LIMIT);
}

function encodeCursor(createdAt: string, id: string): string {
  return encodeURIComponent(JSON.stringify([createdAt, id]));
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
