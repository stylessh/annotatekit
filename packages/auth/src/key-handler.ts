import {
  AnnotateKitError,
  type ApiKeyList,
  type AuditEventInput,
  type AuditLog,
  type AuthScope,
  auditActor,
  type HumanActor,
  isAnnotateKitError,
  scopesForRoles,
} from "@annotatekit/core";
import { type ApiKeyStore, mintApiKey, revokeApiKey, toApiKeySummary } from "./api-keys.js";
import { recordAudit } from "./audit.js";
import type { RoleMapper } from "./roles.js";
import type { Verifier } from "./verifier.js";

export interface ApiKeyHandlerOptions {
  store: ApiKeyStore;
  /** Who is asking. Usually the same verifier the server uses, minus `apiKeyVerifier`. */
  verifier: Verifier;
  roles: RoleMapper;
  /**
   * The scope someone needs to mint keys. Defaults to `project:admin`. Set
   * `annotations:write` to let every commenter connect their own agent.
   */
  mintScope?: AuthScope;
  /** Shown in new keys, such as `live` or `test`. Defaults to `live`. */
  environment?: string;
  audit?: AuditLog;
  now?: () => number;
}

const GUEST_PROVIDER = "shared-password";
const NAME_MAX = 80;

/**
 * Web-standard handler for managing agent API keys. Mount it next to the REST
 * API, e.g. `createAnnotateKitServer({ mount: { "/v1/keys": keys } })`:
 *
 * - `GET /keys` (`?all=1` for admins): `ApiKeyList`.
 * - `POST /keys` with `CreateApiKeyInput`: `{ key, record }`. The key is shown once.
 * - `DELETE /keys/:id`: revokes. Your own keys, or anyone's for admins.
 *
 * Only people can manage keys, never agents. Shared-password guests can't
 * mint them. Writes need `content-type: application/json` or are `DELETE`s,
 * so a browser can't send them cross-site without a CORS preflight.
 */
export function createApiKeyHandler(options: ApiKeyHandlerOptions) {
  const mintScope = options.mintScope ?? "project:admin";
  const clock = options.now ?? Date.now;

  async function whoami(request: Request) {
    const principal = await options.verifier.verify(request);
    if (!principal) throw new AnnotateKitError("unauthorized", "Sign in to manage agent keys");
    if (principal.actor.kind !== "human") {
      throw new AnnotateKitError("forbidden", "Agents cannot manage API keys");
    }
    const actor: HumanActor = principal.actor;
    const scopes = principal.scopes ?? scopesForRoles(await options.roles(actor));
    const canMint = scopes.includes(mintScope) && actor.provider !== GUEST_PROVIDER;
    return { actor, scopes, canMint, admin: scopes.includes("project:admin") };
  }

  async function list(request: Request, url: URL): Promise<Response> {
    const me = await whoami(request);
    const all =
      me.admin && (url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true");
    const records = await options.store.list(all ? undefined : { onBehalfOf: me.actor.id });
    const body: ApiKeyList = {
      keys: records.map(toApiKeySummary).sort((a, b) => b.createdAt - a.createdAt),
      grantable: me.canMint ? me.scopes : [],
      admin: me.admin,
    };
    return json(body);
  }

  async function create(request: Request, audit: Partial<AuditEventInput>): Promise<Response> {
    requireJson(request);
    const me = await whoami(request);
    audit.actor = auditActor(me.actor);
    if (!me.canMint) {
      throw new AnnotateKitError(
        "forbidden",
        me.actor.provider === GUEST_PROVIDER
          ? "Guests cannot create agent keys"
          : `Creating agent keys needs ${mintScope}`,
      );
    }
    const input = await readBody(request);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length > NAME_MAX) {
      throw new AnnotateKitError("invalid_input", `Name is longer than ${NAME_MAX} characters`);
    }
    if (!Array.isArray(input.scopes) || !input.scopes.every((s) => typeof s === "string")) {
      throw new AnnotateKitError("invalid_input", "scopes must be a list of scope names");
    }
    if (input.expiresInDays !== undefined && typeof input.expiresInDays !== "number") {
      throw new AnnotateKitError("invalid_input", "expiresInDays must be a number");
    }
    const mint: Parameters<typeof mintApiKey>[0] = {
      store: options.store,
      minter: me.actor,
      minterScopes: me.scopes,
      scopes: input.scopes as AuthScope[],
      now: clock,
    };
    if (name) mint.name = name;
    if (input.expiresInDays !== undefined) mint.expiresInDays = input.expiresInDays;
    if (options.environment) mint.environment = options.environment;
    const { key, record } = await mintApiKey(mint);
    audit.target = { type: "apikey", id: record.id };
    audit.details = { scopes: record.scopes.join(" "), name: record.name };
    return json({ key, record: toApiKeySummary(record) }, 201);
  }

  async function revoke(
    request: Request,
    id: string,
    audit: Partial<AuditEventInput>,
  ): Promise<Response> {
    audit.target = { type: "apikey", id };
    const me = await whoami(request);
    audit.actor = auditActor(me.actor);
    const record = (await options.store.list()).find((r) => r.id === id);
    if (!record) throw new AnnotateKitError("not_found", "No such key");
    if (record.onBehalfOf !== me.actor.id && !me.admin) {
      throw new AnnotateKitError("forbidden", "You can only revoke your own keys");
    }
    if (record.revokedAt === undefined) await revokeApiKey(options.store, id, clock());
    return new Response(null, { status: 204 });
  }

  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = /\/keys(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (!match) return error("not_found", "Not found");
    const id = match[1] ? decodeURIComponent(match[1]) : undefined;
    const audit: Partial<AuditEventInput> = { actor: null };
    let response: Response;
    try {
      if (!id && request.method === "GET") return await list(request, url);
      if (!id && request.method === "POST") {
        audit.action = "apikey:mint";
        response = await create(request, audit);
      } else if (id && request.method === "DELETE") {
        audit.action = "apikey:revoke";
        response = await revoke(request, id, audit);
      } else {
        return json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, 405);
      }
    } catch (err) {
      if (!isAnnotateKitError(err)) throw err;
      response = error(err.code, err.message);
      audit.reason = err.message;
    }
    if (audit.action) {
      const status = response.status;
      const event: AuditEventInput = {
        actor: audit.actor ?? null,
        action: audit.action,
        decision: status === 401 || status === 403 ? "deny" : status >= 400 ? "error" : "allow",
        status,
      };
      if (audit.reason) event.reason = audit.reason;
      if (audit.target) event.target = audit.target;
      if (audit.details) event.details = audit.details;
      const origin = request.headers.get("origin");
      if (origin && origin !== "null") event.origin = origin;
      await recordAudit(options.audit, event);
    }
    return response;
  };
}

function requireJson(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new AnnotateKitError("invalid_input", "Send JSON with content-type: application/json");
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new AnnotateKitError("invalid_input", "Body must be a JSON object");
}

const STATUS: Record<string, number> = {
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  not_allowed: 403,
  not_found: 404,
  conflict: 409,
};

function error(code: string, message: string): Response {
  return json({ error: { code, message } }, STATUS[code] ?? 500);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
