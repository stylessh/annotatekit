import { createId } from "../ids.js";
import type { Actor } from "../models.js";

/** Who did something, copied from the verified actor at the time. */
export interface AuditActor {
  kind: Actor["kind"];
  id: string;
  name: string;
  provider?: string;
  onBehalfOf?: string;
}

/**
 * - `allow`: the action went through.
 * - `deny`: authentication, the whitelist or a permission check refused it.
 * - `error`: it was allowed but failed, such as bad input or a missing thread.
 */
export type AuditDecision = "allow" | "deny" | "error";

export interface AuditEvent {
  id: string;
  /** ISO 8601 timestamp. */
  at: string;
  /** `null` for anonymous requests. */
  actor: AuditActor | null;
  /**
   * What was attempted: an `AuthAction` such as `thread:resolve`, or
   * `session:issue`, `apikey:mint`, `apikey:revoke`, `audit:read`.
   */
  action: string;
  decision: AuditDecision;
  /** Why it was denied or failed. */
  reason?: string;
  /** What it acted on, such as `{ type: "thread", id: "thr_…" }`. */
  target?: { type: string; id: string };
  /** Page origin the request came from, for browser calls. */
  origin?: string;
  /** HTTP status the server answered with. */
  status?: number;
  /** Anything else worth keeping, such as the identity provider. */
  details?: Record<string, string | number | boolean>;
}

export type AuditEventInput = Omit<AuditEvent, "id" | "at"> & { at?: string };

export interface AuditQuery {
  actorId?: string;
  action?: string;
  decision?: AuditDecision;
  /** Only events at or after this ISO time. */
  since?: string;
  /** Only events strictly before this ISO time, for paging back. */
  before?: string;
  /** Defaults to 100, at most 1000. Newest first. */
  limit?: number;
}

/**
 * Append-only record of writes, denials and credential grants, so "who
 * resolved this?" always has an answer. `@annotatekit/sqlite` has a durable one.
 */
export interface AuditLog {
  record(event: AuditEventInput): Promise<void>;
  /** Newest first. */
  list(query?: AuditQuery): Promise<AuditEvent[]>;
}

export const DEFAULT_AUDIT_LIMIT = 100;
export const MAX_AUDIT_LIMIT = 1000;

/** The audit fields of an actor. Never copies email or groups. */
export function auditActor(actor: Actor | null): AuditActor | null {
  if (!actor) return null;
  const out: AuditActor = { kind: actor.kind, id: actor.id, name: actor.name };
  if (actor.kind === "human" && actor.provider) out.provider = actor.provider;
  if (actor.kind === "agent" && actor.onBehalfOf) out.onBehalfOf = actor.onBehalfOf;
  return out;
}

/** Fills in `id` and `at`. */
export function toAuditEvent(input: AuditEventInput): AuditEvent {
  return { ...input, id: createId("aud"), at: input.at ?? new Date().toISOString() };
}

export function auditLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_AUDIT_LIMIT;
  return Math.max(1, Math.min(MAX_AUDIT_LIMIT, Math.floor(limit)));
}

export interface MemoryAuditLogOptions {
  /** Oldest events are dropped past this many. Defaults to 10,000. */
  maxEvents?: number;
}

/** Keeps events in memory. For tests and local development. */
export function createMemoryAuditLog(options: MemoryAuditLogOptions = {}): AuditLog {
  const max = options.maxEvents ?? 10_000;
  const events: AuditEvent[] = [];
  return {
    async record(input) {
      events.push(toAuditEvent(input));
      if (events.length > max) events.splice(0, events.length - max);
    },
    async list(query = {}) {
      const out: AuditEvent[] = [];
      const limit = auditLimit(query.limit);
      for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        const e = events[i] as AuditEvent;
        if (query.actorId && e.actor?.id !== query.actorId) continue;
        if (query.action && e.action !== query.action) continue;
        if (query.decision && e.decision !== query.decision) continue;
        if (query.since && e.at < query.since) continue;
        if (query.before && e.at >= query.before) continue;
        out.push(structuredClone(e));
      }
      return out;
    },
  };
}
