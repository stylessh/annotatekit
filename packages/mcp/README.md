# @annotatekit/mcp

An MCP server that lets coding agents (Claude Code, Cursor, Codex) read the
feedback people left on your site, pull the full element context behind each
annotation, reply, and resolve. It is a thin layer over the core service, so it
works with any storage, auth and resolution adapter.

## Local (stdio)

Point it at the same SQLite file your app or `annotatekit-server` uses:

```json
{
  "mcpServers": {
    "annotatekit": {
      "command": "npx",
      "args": ["@annotatekit/mcp", "--db", "./annotatekit.db", "--user", "Alan"]
    }
  }
}
```

Or at a running server, so the browser sees agent changes live:

```sh
annotatekit-mcp --server http://localhost:4747/v1 --token $ANNOTATEKIT_TOKEN
```

Flags: `--project <id>` (repeatable) limits the agent to projects,
`--read-only` grants only `annotations:read`, and `--direct-resolve shop` lets
agent resolves in that project skip review (SQLite mode; with `--server` the
server's policy applies).

## Tools

| Tool                     | Scope                 | What it does                                                                            |
| ------------------------ | --------------------- | --------------------------------------------------------------------------------------- |
| `list_threads`           | `annotations:read`    | Open threads by default; filter by project, page URL (globs), status, group, breakpoint |
| `get_thread`             | `annotations:read`    | A thread with every comment                                                             |
| `get_annotation_context` | `annotations:read`    | Selectors, text, rect, sanitised DOM snippet, styles, breakpoint, CSS system, source    |
| `list_groups`            | `annotations:read`    | Groups with thread counts                                                               |
| `reply_to_thread`        | `annotations:write`   | Post a markdown comment                                                                 |
| `set_thread_status`      | `annotations:write`   | `in_progress` or back to `open`, posting a system comment                               |
| `resolve_thread`         | `annotations:resolve` | Report a fix with a summary, commit/PR link and files                                   |
| `reopen_thread`          | `annotations:resolve` | Reopen with a reason                                                                    |

Agent resolves land in `pending_review` by default, so a human confirms on the
page. Every write records `source: "mcp"`, the tool and the MCP client name in
the comment metadata. Comment bodies come back under an `untrusted` key and
snippets are stripped of scripts, event handlers and input values.

Also: the resource `annotatekit://threads/{threadId}`, and the prompts
`work_on_feedback` and `triage_feedback`.

## In code

```ts
import { createAnnotateKitService } from "@annotatekit/core";
import { createAnnotateKitMcpServer, createMcpHandler } from "@annotatekit/mcp";

// stdio or any MCP transport
const server = createAnnotateKitMcpServer({
  service,
  principal: (clientName) => ({
    actor: { kind: "agent", id: "agt_local", name: clientName ?? "Agent" },
    scopes: ["annotations:read", "annotations:write", "annotations:resolve"],
  }),
});

// Stateless Streamable HTTP, e.g. mounted in @annotatekit/server
const mcp = createMcpHandler({
  service,
  authenticate: (request) => lookUpAgentKey(request.headers.get("authorization")),
  rateLimitPerMinute: 120,
});
createAnnotateKitServer({ service, auth, mount: { "/mcp": mcp } });
```
