import { isAuthScope } from "@annotatekit/core";
import type { ApiKeyRecord, ApiKeyStore } from "./api-keys.js";
import type { UsedTokenStore } from "./magic-link.js";

/**
 * The part of a `node:sqlite` / `better-sqlite3` database these stores use.
 * `openDatabase()` from `@annotatekit/sqlite` returns one, and so does
 * `createSqliteStorage().db`, so keys can live next to the threads.
 */
export interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

interface KeyRow {
  id: string;
  prefix: string;
  hash: string;
  name: string;
  on_behalf_of: string;
  scopes: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

/** Agent API keys in SQLite, in an `annotatekit_api_keys` table. Only hashes are stored. */
export function createSqliteApiKeyStore(db: SqliteLike): ApiKeyStore {
  db.exec(`CREATE TABLE IF NOT EXISTS annotatekit_api_keys (
    id TEXT PRIMARY KEY,
    prefix TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    on_behalf_of TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    last_used_at INTEGER,
    revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS annotatekit_api_keys_owner ON annotatekit_api_keys (on_behalf_of);`);

  const insert = db.prepare(
    `INSERT INTO annotatekit_api_keys
       (id, prefix, hash, name, on_behalf_of, scopes, created_at, expires_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byHash = db.prepare("SELECT * FROM annotatekit_api_keys WHERE hash = ?");
  const all = db.prepare("SELECT * FROM annotatekit_api_keys ORDER BY created_at");
  const byOwner = db.prepare(
    "SELECT * FROM annotatekit_api_keys WHERE on_behalf_of = ? ORDER BY created_at",
  );
  const touch = db.prepare("UPDATE annotatekit_api_keys SET last_used_at = ? WHERE id = ?");
  const revoke = db.prepare("UPDATE annotatekit_api_keys SET revoked_at = ? WHERE id = ?");

  return {
    async put(r) {
      insert.run(
        r.id,
        r.prefix,
        r.hash,
        r.name,
        r.onBehalfOf,
        JSON.stringify(r.scopes),
        r.createdAt,
        r.expiresAt ?? null,
        r.lastUsedAt ?? null,
        r.revokedAt ?? null,
      );
    },
    async getByHash(hash) {
      const row = byHash.get(hash) as KeyRow | undefined;
      return row ? fromRow(row) : null;
    },
    async list(filter) {
      const rows = (filter?.onBehalfOf ? byOwner.all(filter.onBehalfOf) : all.all()) as KeyRow[];
      return rows.map(fromRow);
    },
    async update(id, patch) {
      if (patch.lastUsedAt !== undefined) touch.run(patch.lastUsedAt, id);
      if (patch.revokedAt !== undefined) revoke.run(patch.revokedAt, id);
    },
  };
}

function fromRow(row: KeyRow): ApiKeyRecord {
  const scopes = (JSON.parse(row.scopes) as string[]).filter(isAuthScope);
  const record: ApiKeyRecord = {
    id: row.id,
    prefix: row.prefix,
    hash: row.hash,
    name: row.name,
    onBehalfOf: row.on_behalf_of,
    scopes,
    createdAt: Number(row.created_at),
  };
  if (row.expires_at !== null) record.expiresAt = Number(row.expires_at);
  if (row.last_used_at !== null) record.lastUsedAt = Number(row.last_used_at);
  if (row.revoked_at !== null) record.revokedAt = Number(row.revoked_at);
  return record;
}

/** One-time magic-link tokens in SQLite, in an `annotatekit_used_tokens` table. */
export function createSqliteUsedTokenStore(db: SqliteLike): UsedTokenStore {
  db.exec(`CREATE TABLE IF NOT EXISTS annotatekit_used_tokens (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );`);
  const claim = db.prepare(
    "INSERT INTO annotatekit_used_tokens (id, expires_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
  );
  const seen = db.prepare("SELECT 1 FROM annotatekit_used_tokens WHERE id = ?");
  const prune = db.prepare("DELETE FROM annotatekit_used_tokens WHERE expires_at < ?");
  return {
    async claim(id, expiresAt, now) {
      prune.run(now);
      if (seen.get(id)) return false;
      claim.run(id, expiresAt);
      return true;
    },
  };
}
