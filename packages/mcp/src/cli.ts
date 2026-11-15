#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createAnnotateKitClient } from "@annotatekit/client";
import {
  type AnnotateKitService,
  createAnnotateKitService,
  createReviewResolution,
} from "@annotatekit/core";
import { createSqliteStorage } from "@annotatekit/sqlite";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AgentPrincipal, createAnnotateKitMcpServer, SCOPES, type Scope } from "./server.js";

const HELP = `annotatekit-mcp: AnnotateKit MCP server over stdio

Usage: annotatekit-mcp [options]

Backend (pick one):
  --db <path>              SQLite file shared with your app (default: ./annotatekit.db)
  --server <url>           An @annotatekit/server API root, e.g. http://localhost:4747/v1
  --token <token>          Bearer token for --server

Agent:
  --project <id>           Limit the agent to a project; repeatable (default: all)
  --user <name>            The human the agent works for, recorded as onBehalfOf
  --read-only              Only grant annotations:read
  --direct-resolve <ids>   Comma-separated projects where agent resolves skip review (--db only)
  -h, --help               Show this help

Environment: ANNOTATEKIT_DB, ANNOTATEKIT_SERVER, ANNOTATEKIT_TOKEN, ANNOTATEKIT_USER

Example client config:
  { "mcpServers": { "annotatekit": { "command": "npx", "args": ["@annotatekit/mcp", "--db", "./annotatekit.db"] } } }
`;

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    server: { type: "string" },
    token: { type: "string" },
    project: { type: "string", multiple: true },
    user: { type: "string" },
    "read-only": { type: "boolean" },
    "direct-resolve": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const remote = values.server ?? process.env.ANNOTATEKIT_SERVER;
let service: AnnotateKitService;
let close = async () => {};

if (remote) {
  const token = values.token ?? process.env.ANNOTATEKIT_TOKEN;
  service = createAnnotateKitClient(token ? { baseUrl: remote, token } : { baseUrl: remote });
} else {
  const directResolve = new Set(
    (values["direct-resolve"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const storage = createSqliteStorage({
    database: values.db ?? process.env.ANNOTATEKIT_DB ?? "./annotatekit.db",
  });
  service = createAnnotateKitService({
    storage,
    resolution: createReviewResolution({
      requiresReview: (actor, thread) =>
        actor.kind === "agent" && !directResolve.has(thread.projectId),
    }),
  });
  close = () => storage.close();
}

const user = values.user ?? process.env.ANNOTATEKIT_USER;
const scopes: readonly Scope[] = values["read-only"] ? ["annotations:read"] : SCOPES;
const projects = values.project?.length ? values.project : undefined;

const server = createAnnotateKitMcpServer({
  service,
  principal: (clientName) => {
    const name = clientName ?? "Agent";
    const principal: AgentPrincipal = {
      actor: { kind: "agent", id: `agt_${slug(name)}`, name },
      scopes,
    };
    if (user) principal.actor.onBehalfOf = user;
    if (projects) principal.projects = projects;
    return principal;
  },
});

await server.connect(new StdioServerTransport());
process.stderr.write(
  `annotatekit-mcp ready (${remote ? `server ${remote}` : `sqlite ${values.db ?? process.env.ANNOTATEKIT_DB ?? "./annotatekit.db"}`})\n`,
);

const shutdown = () => {
  void server
    .close()
    .then(close)
    .finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("end", shutdown);

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "agent"
  );
}
