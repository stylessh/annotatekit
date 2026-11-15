import type { AuthScope } from "./scopes.js";

/** An agent API key as shown to people. The key itself is only ever shown once, at creation. */
export interface ApiKeySummary {
  id: string;
  /** The first characters of the key, safe to show in a list. */
  prefix: string;
  /** Agent display name, such as `Claude Code`. */
  name: string;
  /** Id of the human who minted the key; the agent acts on their behalf. */
  onBehalfOf: string;
  scopes: AuthScope[];
  /** Epoch milliseconds. */
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface CreateApiKeyInput {
  /** Agent display name. Defaults to `Agent`. */
  name?: string;
  scopes: AuthScope[];
  /** Defaults to 30, at most 365. */
  expiresInDays?: number;
}

export interface ApiKeyList {
  keys: ApiKeySummary[];
  /** Scopes the signed-in person may put on a new key. Empty when they may not mint keys. */
  grantable: AuthScope[];
  /** Whether they may see and revoke everyone's keys. */
  admin: boolean;
}

/**
 * Lists, mints and revokes agent API keys for the signed-in person. The
 * client implements it over HTTP, and the inspector toolbar renders it.
 */
export interface ApiKeyManager {
  /** Your own keys, or everyone's with `all` when you are an admin. */
  list(options?: { all?: boolean }): Promise<ApiKeyList>;
  create(input: CreateApiKeyInput): Promise<{ key: string; record: ApiKeySummary }>;
  revoke(id: string): Promise<void>;
}
