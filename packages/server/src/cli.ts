#!/usr/bin/env node
import { parseArgs } from "node:util";
import { type Actor, createReviewResolution } from "@annotatekit/core";
import { createSqliteStorage } from "@annotatekit/sqlite";
import { composeServerAuth, createDevAuth, createTokenAuth, type ServerAuth } from "./auth.js";
import { createAnnotateKitServer } from "./handler.js";
import { serve } from "./node.js";

const HELP = `annotatekit-server: serve an AnnotateKit REST API over SQLite

Usage: annotatekit-server [options]

  --db <path>            SQLite file (default: ./annotatekit.db, or :memory:)
  --port <n>             Port (default: 4747)
  --host <host>          Interface to bind (default: 127.0.0.1)
  --cors <origins>       Comma-separated allowed origins, * wildcards (default: http://localhost:*,http://127.0.0.1:*)
  --token <token=name>   Accept a bearer token as an agent; repeatable
  --no-dev-auth          Do not trust the x-annotatekit-actor header
  --direct-resolve <p>   Comma-separated projects where agents resolve without review
  -h, --help             Show this help

Environment: ANNOTATEKIT_DB, ANNOTATEKIT_PORT, ANNOTATEKIT_TOKENS (token=name,...)
`;

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    port: { type: "string" },
    host: { type: "string" },
    cors: { type: "string" },
    token: { type: "string", multiple: true },
    "no-dev-auth": { type: "boolean" },
    "direct-resolve": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const database = values.db ?? process.env.ANNOTATEKIT_DB ?? "./annotatekit.db";
const port = Number(values.port ?? process.env.ANNOTATEKIT_PORT ?? 4747);
const tokenSpecs = [
  ...(values.token ?? []),
  ...(process.env.ANNOTATEKIT_TOKENS?.split(",").filter(Boolean) ?? []),
];
const tokens: Record<string, Actor> = {};
for (const spec of tokenSpecs) {
  const [token, name = "agent"] = spec.split("=");
  if (!token) continue;
  tokens[token] = { kind: "agent", id: `agt_${slug(name)}`, name };
}

const auths: ServerAuth[] = [];
if (Object.keys(tokens).length > 0) auths.push(createTokenAuth({ tokens }));
if (!values["no-dev-auth"]) auths.push(createDevAuth());
const directResolve = new Set(
  (values["direct-resolve"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const storage = createSqliteStorage({ database });
const app = createAnnotateKitServer({
  storage,
  resolution: createReviewResolution({
    requiresReview: (actor, thread) =>
      actor.kind === "agent" && !directResolve.has(thread.projectId),
  }),
  auth: composeServerAuth(...auths),
  cors: {
    origins: (values.cors ?? "http://localhost:*,http://127.0.0.1:*")
      .split(",")
      .map((s) => s.trim()),
  },
});

const running = await serve(app.fetch, { port, hostname: values.host ?? "127.0.0.1" });
process.stderr.write(`AnnotateKit server on ${running.url}/v1 (db: ${database})\n`);
if (!values["no-dev-auth"]) {
  process.stderr.write(
    "Dev auth is on: clients name themselves. Use --no-dev-auth outside local dev.\n",
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void running
      .close()
      .then(() => storage.close())
      .then(() => process.exit(0));
  });
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "agent"
  );
}
