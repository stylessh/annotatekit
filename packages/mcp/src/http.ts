import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  type AgentPrincipal,
  type AnnotateKitMcpOptions,
  createAnnotateKitMcpServer,
} from "./server.js";

export interface McpHandlerOptions extends Omit<AnnotateKitMcpOptions, "principal"> {
  /**
   * Find the agent behind a request, usually from its bearer token. Return
   * `null` to answer 401. The client name is filled in per tool call when the
   * principal's actor name is left empty.
   */
  authenticate(request: Request): AgentPrincipal | null | Promise<AgentPrincipal | null>;
  /** Calls per principal per minute. Defaults to 120; `0` turns limiting off. */
  rateLimitPerMinute?: number;
}

/**
 * A stateless Streamable HTTP handler (`Request` in, `Response` out). Mount it
 * at `/mcp` in any fetch-based framework, or with `@annotatekit/server`'s
 * `mount` option.
 */
export function createMcpHandler(
  options: McpHandlerOptions,
): (request: Request) => Promise<Response> {
  const limit = options.rateLimitPerMinute ?? 120;
  const windows = new Map<string, { start: number; count: number }>();

  function limited(key: string): number | null {
    if (limit <= 0) return null;
    const now = Date.now();
    const window = windows.get(key);
    if (!window || now - window.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (now - w.start >= 60_000) windows.delete(k);
      }
      return null;
    }
    window.count += 1;
    return window.count > limit ? Math.ceil((window.start + 60_000 - now) / 1000) : null;
  }

  return async (request) => {
    if (request.method !== "POST") {
      // Stateless mode has no server-initiated stream and no sessions to delete.
      return jsonRpcError(405, -32000, "Method not allowed", { allow: "POST" });
    }
    const principal = await options.authenticate(request);
    if (!principal) {
      return jsonRpcError(401, -32001, "Unauthorized", {
        "www-authenticate": 'Bearer realm="annotatekit"',
      });
    }
    const retryAfter = limited(principal.actor.id);
    if (retryAfter !== null) {
      return jsonRpcError(429, -32002, `rate_limited: retry in ${retryAfter}s`, {
        "retry-after": String(retryAfter),
      });
    }

    const { authenticate: _a, rateLimitPerMinute: _r, ...rest } = options;
    const server = createAnnotateKitMcpServer({
      ...rest,
      principal: (clientName) =>
        principal.actor.name
          ? principal
          : { ...principal, actor: { ...principal.actor, name: clientName ?? "Agent" } },
    });
    // No sessionIdGenerator: stateless mode, one server per request.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      void transport.close();
      void server.close();
    }
  };
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
