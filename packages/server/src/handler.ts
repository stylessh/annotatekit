import {
  type Actor,
  AnnotateKitError,
  type AnnotateKitErrorCode,
  type AnnotateKitService,
  createAnnotateKitService,
  isAnnotateKitError,
  type ResolutionAdapter,
  type StorageAdapter,
  type StorageChange,
  THREAD_STATUSES,
  type ThreadQuery,
  type ThreadStatus,
  type WhitelistAdapter,
} from "@annotatekit/core";
import { ACTOR_HEADER, type ServerAuth } from "./auth.js";

export type FetchHandler = (request: Request) => Promise<Response>;

export interface CorsOptions {
  /** Allowed origins, `*` wildcards allowed (e.g. `http://localhost:*`), or `"*"` for any. */
  origins: string[] | "*";
  /** Send `Access-Control-Allow-Credentials`. Defaults to `false`. */
  credentials?: boolean;
}

export interface AnnotateKitServerOptions {
  /** Storage to serve. Ignored when `service` is given. */
  storage?: StorageAdapter;
  /** Resolution policy. Ignored when `service` is given. Defaults to review. */
  resolution?: ResolutionAdapter;
  /** A ready service, if you built one yourself. */
  service?: AnnotateKitService;
  auth: ServerAuth;
  /** Checked against the request's `Origin` (or `Referer`) for browser calls. */
  whitelist?: WhitelistAdapter;
  /** Passed to the whitelist as `environment`. */
  environment?: string;
  cors?: CorsOptions;
  /** Path prefix for the REST API. Defaults to `/v1`. */
  basePath?: string;
  /** Extra handlers by path prefix, such as `{ "/mcp": createMcpHandler(...) }`. */
  mount?: Record<string, FetchHandler>;
  /** Largest accepted JSON body in bytes. Defaults to 1 MB. */
  maxBodyBytes?: number;
  /** Heartbeat interval for `/events` in ms. Defaults to 25 s. */
  heartbeatMs?: number;
}

export interface AnnotateKitServer {
  readonly service: AnnotateKitService;
  /** Web-standard handler: mount it in Hono, Next route handlers, Bun, Deno or {@link serve}. */
  fetch: FetchHandler;
}

const STATUS_BY_CODE: Record<AnnotateKitErrorCode, number> = {
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  not_allowed: 403,
  not_found: 404,
  conflict: 409,
  invalid_transition: 409,
  storage_unavailable: 503,
};

interface Ctx {
  request: Request;
  url: URL;
  actor: Actor | null;
  params: string[];
}

type Route = {
  method: string;
  pattern: RegExp;
  run: (ctx: Ctx) => Promise<Response>;
};

export function createAnnotateKitServer(options: AnnotateKitServerOptions): AnnotateKitServer {
  const service =
    options.service ??
    (() => {
      if (!options.storage) {
        throw new AnnotateKitError("invalid_input", "Pass either a service or a storage adapter");
      }
      const serviceOptions: Parameters<typeof createAnnotateKitService>[0] = {
        storage: options.storage,
      };
      if (options.resolution) serviceOptions.resolution = options.resolution;
      if (options.auth.authorize) serviceOptions.authorize = options.auth.authorize;
      return createAnnotateKitService(serviceOptions);
    })();
  const basePath = trimSlash(options.basePath ?? "/v1");
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const heartbeatMs = options.heartbeatMs ?? 25_000;
  const corsMatchers =
    options.cors && options.cors.origins !== "*" ? options.cors.origins.map(globToRegExp) : null;
  const mounts = Object.entries(options.mount ?? {}).map(
    ([path, handler]) => [trimSlash(path), handler] as const,
  );

  const id = "([^/]+)";
  const routes: Route[] = [
    route("GET", "/health", async () => json({ ok: true, events: Boolean(service.subscribe) })),
    route("GET", "/me", async ({ actor }) => json({ actor })),
    route("GET", "/threads", async ({ actor, url }) =>
      json(await service.listThreads(actor, threadQuery(url.searchParams))),
    ),
    route("POST", "/threads", async (ctx) =>
      json(await service.createThread(ctx.actor, await body(ctx)), 201),
    ),
    route("GET", `/threads/${id}`, async ({ actor, params }) =>
      json(await service.getThread(actor, p(params))),
    ),
    route("PATCH", `/threads/${id}`, async (ctx) =>
      json(await service.updateThread(ctx.actor, p(ctx.params), await body(ctx))),
    ),
    route("DELETE", `/threads/${id}`, async ({ actor, params }) => {
      await service.deleteThread(actor, p(params));
      return new Response(null, { status: 204 });
    }),
    route("POST", `/threads/${id}/status`, async (ctx) =>
      json(await service.setThreadStatus(ctx.actor, p(ctx.params), await body(ctx))),
    ),
    route("POST", `/threads/${id}/resolve`, async (ctx) =>
      json(await service.resolveThread(ctx.actor, p(ctx.params), await body(ctx, true))),
    ),
    route("POST", `/threads/${id}/reopen`, async (ctx) =>
      json(await service.reopenThread(ctx.actor, p(ctx.params), await body(ctx, true))),
    ),
    route("GET", `/threads/${id}/comments`, async ({ actor, params, url }) =>
      json(
        await service.listComments(actor, {
          threadId: p(params),
          ...pageQuery(url.searchParams),
        }),
      ),
    ),
    route("POST", `/threads/${id}/comments`, async (ctx) =>
      json(await service.addComment(ctx.actor, p(ctx.params), await body(ctx)), 201),
    ),
    route("PATCH", `/comments/${id}`, async (ctx) =>
      json(await service.updateComment(ctx.actor, p(ctx.params), await body(ctx))),
    ),
    route("DELETE", `/comments/${id}`, async ({ actor, params }) => {
      await service.deleteComment(actor, p(params));
      return new Response(null, { status: 204 });
    }),
    route("GET", "/groups", async ({ actor, url }) => {
      const query: Parameters<AnnotateKitService["listGroups"]>[1] = pageQuery(url.searchParams);
      const projectId = url.searchParams.get("projectId");
      if (projectId) query.projectId = projectId;
      return json(await service.listGroups(actor, query));
    }),
    route("POST", "/groups", async (ctx) =>
      json(await service.createGroup(ctx.actor, await body(ctx)), 201),
    ),
    route("PATCH", `/groups/${id}`, async (ctx) =>
      json(await service.updateGroup(ctx.actor, p(ctx.params), await body(ctx))),
    ),
    route("DELETE", `/groups/${id}`, async ({ actor, params }) => {
      await service.deleteGroup(actor, p(params));
      return new Response(null, { status: 204 });
    }),
    route("GET", "/events", async (ctx) => events(ctx)),
  ];

  function route(method: string, path: string, run: Route["run"]): Route {
    return { method, pattern: new RegExp(`^${path}$`), run };
  }

  async function body<T>(ctx: Ctx, optional = false): Promise<T> {
    const length = Number(ctx.request.headers.get("content-length") ?? "0");
    if (length > maxBodyBytes) {
      throw new AnnotateKitError("invalid_input", `Body is larger than ${maxBodyBytes} bytes`);
    }
    const text = await ctx.request.text();
    if (text.length > maxBodyBytes) {
      throw new AnnotateKitError("invalid_input", `Body is larger than ${maxBodyBytes} bytes`);
    }
    if (text.trim() === "") {
      if (optional) return {} as T;
      throw new AnnotateKitError("invalid_input", "A JSON body is required");
    }
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value as T;
    } catch {
      throw new AnnotateKitError("invalid_input", "Body must be a JSON object");
    }
  }

  async function events(ctx: Ctx): Promise<Response> {
    await service.listThreads(ctx.actor, { limit: 1 }); // permission check for reads
    const subscribe = service.subscribe?.bind(service);
    if (!subscribe) {
      throw new AnnotateKitError("storage_unavailable", "This backend cannot stream changes");
    }
    const projectId = ctx.url.searchParams.get("projectId");
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup();
          }
        };
        send(": connected\n\n");
        const unsubscribe = subscribe((change) => {
          void changeProject(ctx.actor, change).then((project) => {
            if (projectId && project !== null && project !== projectId) return;
            send(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
          });
        });
        const timer = setInterval(() => send(": ping\n\n"), heartbeatMs);
        cleanup = () => {
          clearInterval(timer);
          unsubscribe();
        };
        ctx.request.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  /** The project a change belongs to, or `null` when it cannot be told (deletes). */
  async function changeProject(actor: Actor | null, change: StorageChange): Promise<string | null> {
    if (change.type === "delete") return null;
    if (change.collection === "comments") {
      try {
        return (await service.getThread(actor, change.entity.threadId)).thread.projectId;
      } catch {
        return null;
      }
    }
    return change.entity.projectId;
  }

  function corsHeaders(request: Request): Headers {
    const headers = new Headers();
    if (!options.cors) return headers;
    const origin = request.headers.get("origin");
    if (!origin) return headers;
    const allowed = corsMatchers === null || corsMatchers.some((re) => re.test(origin));
    if (!allowed) return headers;
    headers.set("access-control-allow-origin", corsMatchers === null ? "*" : origin);
    if (corsMatchers !== null) headers.set("vary", "origin");
    if (options.cors.credentials) headers.set("access-control-allow-credentials", "true");
    headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    headers.set(
      "access-control-allow-headers",
      `authorization, content-type, ${ACTOR_HEADER}, mcp-session-id, mcp-protocol-version`,
    );
    headers.set("access-control-expose-headers", "mcp-session-id");
    headers.set("access-control-max-age", "600");
    return headers;
  }

  async function checkWhitelist(request: Request, actor: Actor | null) {
    if (!options.whitelist) return;
    const pageUrl = request.headers.get("origin") ?? request.headers.get("referer");
    // Non-browser callers (agents, scripts) send neither; auth covers them.
    if (!pageUrl || pageUrl === "null") return;
    const context: Parameters<WhitelistAdapter["check"]>[0] = { url: pageUrl, actor };
    if (options.environment !== undefined) context.environment = options.environment;
    const decision = await options.whitelist.check(context);
    if (!decision.allowed) {
      throw new AnnotateKitError("not_allowed", decision.reason ?? "Origin is not whitelisted");
    }
  }

  async function dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    for (const [prefix, handler] of mounts) {
      if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
        return handler(request);
      }
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return errorResponse("not_found", `No route for ${url.pathname}`);
    }
    const path = url.pathname.slice(basePath.length) || "/";
    let methodMismatch = false;
    for (const r of routes) {
      const match = r.pattern.exec(path);
      if (!match) continue;
      if (r.method !== request.method) {
        methodMismatch = true;
        continue;
      }
      const actor = await options.auth.authenticate(request);
      await checkWhitelist(request, actor);
      return r.run({
        request,
        url,
        actor,
        params: match.slice(1).map((s) => decodeURIComponent(s)),
      });
    }
    if (methodMismatch) {
      return json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, 405);
    }
    return errorResponse("not_found", `No route for ${request.method} ${path}`);
  }

  return {
    service,
    async fetch(request) {
      let response: Response;
      try {
        response = await dispatch(request);
      } catch (error) {
        response = toErrorResponse(error);
      }
      const cors = corsHeaders(request);
      if ([...cors.keys()].length === 0) return response;
      const headers = new Headers(response.headers);
      cors.forEach((value, key) => {
        headers.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

function p(params: string[]): string {
  return params[0] ?? "";
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function errorResponse(code: AnnotateKitErrorCode, message: string): Response {
  return json({ error: { code, message } }, STATUS_BY_CODE[code]);
}

function toErrorResponse(error: unknown): Response {
  if (isAnnotateKitError(error)) return errorResponse(error.code, error.message);
  console.error("[annotatekit] unexpected error", error);
  return json({ error: { code: "internal", message: "Internal server error" } }, 500);
}

function pageQuery(params: URLSearchParams): { cursor?: string; limit?: number } {
  const query: { cursor?: string; limit?: number } = {};
  const cursor = params.get("cursor");
  if (cursor) query.cursor = cursor;
  const limit = params.get("limit");
  if (limit !== null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) {
      throw new AnnotateKitError("invalid_input", `limit must be a positive integer, got ${limit}`);
    }
    query.limit = n;
  }
  return query;
}

/** Parse thread list query parameters. `status` and `tags` are comma-separated. */
export function threadQuery(params: URLSearchParams): ThreadQuery {
  const query: ThreadQuery = pageQuery(params);
  for (const key of ["projectId", "pageUrl", "pathname", "groupId", "authorId"] as const) {
    const value = params.get(key);
    if (value) query[key] = value;
  }
  const updatedSince = params.get("updatedSince");
  if (updatedSince) query.updatedSince = updatedSince;
  const status = params.get("status");
  if (status) {
    const statuses = status.split(",").map((s) => s.trim()) as ThreadStatus[];
    for (const s of statuses) {
      if (!THREAD_STATUSES.includes(s)) {
        throw new AnnotateKitError("invalid_input", `Unknown status: ${s}`);
      }
    }
    query.status = statuses.length === 1 ? statuses[0] : statuses;
  }
  const tags = params.get("tags");
  if (tags) query.tags = tags.split(",").map((t) => t.trim());
  return query;
}

function trimSlash(path: string): string {
  const withLead = path.startsWith("/") ? path : `/${path}`;
  return withLead.length > 1 ? withLead.replace(/\/+$/, "") : "";
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
