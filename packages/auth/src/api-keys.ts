import {
  type AgentActor,
  AnnotateKitError,
  type ApiKeySummary,
  type AuthScope,
  createId,
  type HumanActor,
  isAuthScope,
} from "@annotatekit/core";
import { randomBase62, sha256Hex, timingSafeEqual } from "./encoding.js";
import { bearerToken } from "./jwt.js";
import type { VerifiedPrincipal, Verifier } from "./verifier.js";

/** A stored API key. The key itself is never stored, only its SHA-256 hash. */
export interface ApiKeyRecord extends ApiKeySummary {
  hash: string;
}

/** The record without its hash, for showing to people. */
export function toApiKeySummary(record: ApiKeyRecord): ApiKeySummary {
  const { hash: _hash, ...summary } = record;
  return summary;
}

/** Where API key records live. The SQLite backend implements this too. */
export interface ApiKeyStore {
  put(record: ApiKeyRecord): Promise<void>;
  getByHash(hash: string): Promise<ApiKeyRecord | null>;
  list(filter?: { onBehalfOf?: string }): Promise<ApiKeyRecord[]>;
  update(id: string, patch: Partial<Pick<ApiKeyRecord, "lastUsedAt" | "revokedAt">>): Promise<void>;
}

export function createMemoryApiKeyStore(): ApiKeyStore {
  const records = new Map<string, ApiKeyRecord>();
  return {
    async put(record) {
      records.set(record.id, { ...record });
    },
    async getByHash(hash) {
      for (const record of records.values()) {
        if (timingSafeEqual(record.hash, hash)) return { ...record };
      }
      return null;
    },
    async list(filter) {
      return [...records.values()]
        .filter((r) => !filter?.onBehalfOf || r.onBehalfOf === filter.onBehalfOf)
        .map((r) => ({ ...r }));
    },
    async update(id, patch) {
      const record = records.get(id);
      if (record) records.set(id, { ...record, ...patch });
    },
  };
}

export interface MintApiKeyOptions {
  store: ApiKeyStore;
  /** The signed-in human minting the key. */
  minter: HumanActor;
  /** The minter's own scopes. The key may not exceed them. */
  minterScopes: AuthScope[];
  scopes: AuthScope[];
  /** Agent display name. Defaults to `Agent`. */
  name?: string;
  /** Lifetime in days. Defaults to 30, at most 365. */
  expiresInDays?: number;
  /** Shown in the key, such as `live` or `test`. Defaults to `live`. */
  environment?: string;
  now?: () => number;
}

const MAX_DAYS = 365;
const KEY_PATTERN = /^ak_[a-z0-9]+_[A-Za-z0-9]{32}$/;

/** Creates an API key. Returns the key, shown to the user once, and its record. */
export async function mintApiKey(
  options: MintApiKeyOptions,
): Promise<{ key: string; record: ApiKeyRecord }> {
  const scopes = [...new Set(options.scopes)];
  if (scopes.length === 0 || !scopes.every(isAuthScope)) {
    throw new AnnotateKitError("invalid_input", "An API key needs at least one valid scope");
  }
  const excess = scopes.filter((s) => !options.minterScopes.includes(s));
  if (excess.length > 0) {
    throw new AnnotateKitError(
      "forbidden",
      `Cannot grant scopes you do not hold: ${excess.join(", ")}`,
    );
  }
  const days = options.expiresInDays ?? 30;
  if (!(days > 0 && days <= MAX_DAYS)) {
    throw new AnnotateKitError("invalid_input", `API keys expire after 1 to ${MAX_DAYS} days`);
  }
  const environment = (options.environment ?? "live").toLowerCase();
  if (!/^[a-z0-9]+$/.test(environment)) {
    throw new AnnotateKitError(
      "invalid_input",
      "Key environment must be lowercase letters or digits",
    );
  }
  const now = (options.now ?? Date.now)();
  const key = `ak_${environment}_${randomBase62(32)}`;
  const record: ApiKeyRecord = {
    id: createId("key"),
    prefix: key.slice(0, environment.length + 8),
    hash: await sha256Hex(key),
    name: options.name ?? "Agent",
    onBehalfOf: options.minter.id,
    scopes,
    createdAt: now,
    expiresAt: now + days * 86_400_000,
  };
  await options.store.put(record);
  return { key, record };
}

/** Revokes a key. It stops working on the next request. */
export async function revokeApiKey(store: ApiKeyStore, id: string, now = Date.now()) {
  await store.update(id, { revokedAt: now });
}

export interface ApiKeyVerifierOptions {
  store: ApiKeyStore;
  /**
   * The minter's current scopes, when known. Effective scopes are the key's
   * scopes intersected with these, so removing someone from a group also
   * narrows their agents. Return `undefined` when unknown.
   */
  currentScopes?: (minterId: string) => Promise<AuthScope[] | undefined> | AuthScope[] | undefined;
  now?: () => number;
}

/** Verifies `Authorization: Bearer ak_...` and returns the agent and its scopes. */
export function apiKeyVerifier(options: ApiKeyVerifierOptions): Verifier {
  return {
    async verify(request): Promise<VerifiedPrincipal | null> {
      const key = bearerToken(request);
      if (!key || !KEY_PATTERN.test(key)) return null;
      const record = await options.store.getByHash(await sha256Hex(key));
      const now = (options.now ?? Date.now)();
      if (!record || record.revokedAt !== undefined) return null;
      if (record.expiresAt !== undefined && record.expiresAt <= now) return null;
      let scopes = record.scopes;
      const current = await options.currentScopes?.(record.onBehalfOf);
      if (current) scopes = scopes.filter((s) => current.includes(s));
      await options.store.update(record.id, { lastUsedAt: now });
      const actor: AgentActor = {
        kind: "agent",
        id: `agent_${record.id}`,
        name: record.name,
        onBehalfOf: record.onBehalfOf,
      };
      const principal: VerifiedPrincipal = { actor, scopes };
      if (record.expiresAt !== undefined) principal.expiresAt = record.expiresAt;
      return principal;
    },
  };
}
