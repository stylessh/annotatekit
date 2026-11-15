import {
  AnnotateKitError,
  type AuditEvent,
  type AuditLog,
  auditLimit,
  toAuditEvent,
} from "@annotatekit/core";
import { openDatabase, type SqliteDatabase } from "./driver.js";

export interface SqliteAuditLogOptions {
  /** A file path or an open database, such as `createSqliteStorage().database`. */
  database: string | SqliteDatabase;
  /** Prefix for the table name. Defaults to `ak_`, giving `ak_audit`. */
  tablePrefix?: string;
}

/**
 * An append-only {@link AuditLog} in SQLite. Pass the storage adapter's
 * `database` to keep the audit table next to the threads.
 */
export function createSqliteAuditLog(options: SqliteAuditLogOptions): AuditLog {
  const db =
    typeof options.database === "object" ? options.database : openDatabase(options.database);
  const prefix = options.tablePrefix ?? "ak_";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
    throw new AnnotateKitError("invalid_input", `Invalid table prefix: ${prefix}`);
  }
  const table = `${prefix}audit`;
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    at TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    decision TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ${table}_at ON ${table} (at);
  CREATE INDEX IF NOT EXISTS ${table}_actor ON ${table} (actor_id, at);`);

  const insert = db.prepare(
    `INSERT INTO ${table} (id, at, actor_id, action, decision, data) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  return {
    async record(input) {
      const event = toAuditEvent(input);
      insert.run(
        event.id,
        event.at,
        event.actor?.id ?? null,
        event.action,
        event.decision,
        JSON.stringify(event),
      );
    },
    async list(query = {}) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (query.actorId) {
        where.push("actor_id = ?");
        params.push(query.actorId);
      }
      if (query.action) {
        where.push("action = ?");
        params.push(query.action);
      }
      if (query.decision) {
        where.push("decision = ?");
        params.push(query.decision);
      }
      if (query.since) {
        where.push("at >= ?");
        params.push(query.since);
      }
      if (query.before) {
        where.push("at < ?");
        params.push(query.before);
      }
      const sql = `SELECT data FROM ${table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`;
      params.push(auditLimit(query.limit));
      const rows = db.prepare(sql).all(...params) as { data: string }[];
      return rows.map((row) => JSON.parse(row.data) as AuditEvent);
    },
  };
}
