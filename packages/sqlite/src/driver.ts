import { createRequire } from "node:module";

export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint };
}

/** The subset of the `better-sqlite3` / `node:sqlite` API the adapter uses. */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): unknown;
}

/**
 * Open a database with Node's built-in `node:sqlite` (Node 22.13+), in WAL
 * mode for files so readers do not block the writer.
 */
export function openDatabase(path: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  let mod: { DatabaseSync: new (path: string) => SqliteDatabase };
  try {
    mod = withoutSqliteWarning(() => require("node:sqlite"));
  } catch (cause) {
    throw new Error(
      "node:sqlite is not available. Use Node 22.13 or newer, or pass an open better-sqlite3 database.",
      { cause },
    );
  }
  const db = new mod.DatabaseSync(path);
  if (path !== ":memory:" && path !== "") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

/** `node:sqlite` prints an ExperimentalWarning on load; keep it out of stdio MCP logs. */
function withoutSqliteWarning<T>(fn: () => T): T {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning.message;
    if (message.includes("SQLite")) return;
    return (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return fn();
  } finally {
    process.emitWarning = original;
  }
}
