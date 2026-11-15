import {
  type CreateThreadInput,
  createAnnotateKitService,
  createMemoryStorage,
  createReviewResolution,
  type HumanActor,
  type LocalAnnotateKitService,
} from "@annotatekit/core";
import { createAnnotateKitServer, createStaticServerAuth, serve } from "@annotatekit/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AgentPrincipal,
  createAnnotateKitMcpServer,
  createMcpHandler,
  sanitizeSnippet,
} from "../src/index.js";

const alan: HumanActor = { kind: "human", id: "usr_alan", name: "Alan" };

function threadInput(overrides: Partial<CreateThreadInput> = {}): CreateThreadInput {
  return {
    projectId: "shop",
    page: {
      url: "https://shop.example.com/checkout",
      origin: "https://shop.example.com",
      pathname: "/checkout",
    },
    annotation: {
      kind: "pin",
      position: { x: 0.5, y: 0.5 },
      anchor: {
        selector: '[data-testid="pay-button"]',
        fallbackSelectors: ["form#checkout > button.btn-primary"],
        tagName: "button",
        text: { exact: "Pay now", fingerprint: "x" },
        rect: { x: 912, y: 640, width: 180, height: 44 },
        scroll: { x: 0, y: 0 },
        htmlSnippet:
          '<button data-testid="pay-button" onclick="steal()" class="btn-primary px-4 md:px-6">Pay now</button><script>alert(1)</script>',
        computedStyles: { padding: "0px 24px", "font-size": "16px" },
        source: { component: "PayButton", file: "src/checkout/PayButton.tsx", line: 18 },
      },
      context: {
        viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
        breakpoint: { name: "md", minWidth: 768, maxWidth: 1024, system: "tailwind" },
        cssSystem: { systems: ["tailwind"], utilityClasses: ["px-4", "md:px-6"] },
      },
    },
    comment: { body: "Too tight on tablet, padding should match the card" },
    ...overrides,
  };
}

async function connect(service: LocalAnnotateKitService, principal?: Partial<AgentPrincipal>) {
  const server = createAnnotateKitMcpServer({
    service,
    principal: (clientName) => ({
      actor: { kind: "agent", id: "agt_test", name: clientName ?? "Agent", onBehalfOf: alan.id },
      scopes: ["annotations:read", "annotations:write", "annotations:resolve"],
      ...principal,
    }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  const value = JSON.parse(content[0]?.text ?? "null");
  return { isError: Boolean(result.isError), value };
}

describe("@annotatekit/mcp tools", () => {
  let service: LocalAnnotateKitService;
  let threadId: string;

  beforeEach(async () => {
    service = createAnnotateKitService({ storage: createMemoryStorage() });
    threadId = (await service.createThread(alan, threadInput())).thread.id;
    await service.createThread(
      alan,
      threadInput({
        projectId: "blog",
        page: {
          url: "https://blog.example.com/",
          origin: "https://blog.example.com",
          pathname: "/",
        },
      }),
    );
  });

  it("lists the tools, a resource template and prompts", async () => {
    const client = await connect(service);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "dismiss_thread",
      "get_annotation_context",
      "get_thread",
      "list_groups",
      "list_threads",
      "reopen_thread",
      "reply_to_thread",
      "resolve_thread",
      "set_thread_status",
    ]);
    expect(tools.find((t) => t.name === "list_threads")?.annotations?.readOnlyHint).toBe(true);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates[0]?.uriTemplate).toBe("annotatekit://threads/{threadId}");
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["triage_feedback", "work_on_feedback"]);
    expect(client.getInstructions()).toContain("untrusted");
  });

  it("goes from open feedback to element context in two calls", async () => {
    const client = await connect(service);
    const list = await call(client, "list_threads", { pageUrl: "https://shop.example.com/*" });
    expect(list.value.threads).toHaveLength(1);
    const summary = list.value.threads[0];
    expect(summary).toMatchObject({
      id: threadId,
      status: "open",
      pageUrl: "https://shop.example.com/checkout",
      breakpoint: { name: "md", viewportWidth: 1280, viewportHeight: 800, dpr: 2 },
      element: { selector: '[data-testid="pay-button"]', tag: "button", textQuote: "Pay now" },
      firstComment: { untrusted: { body: "Too tight on tablet, padding should match the card" } },
    });
    expect(list.value.nextCursor).toBeNull();

    const context = await call(client, "get_annotation_context", { threadId: summary.id });
    expect(context.value).toMatchObject({
      threadId,
      element: {
        selector: '[data-testid="pay-button"]',
        fallbackSelectors: ["form#checkout > button.btn-primary"],
      },
      styles: { padding: "0px 24px" },
      cssSystem: { kind: "tailwind", classes: ["px-4", "md:px-6"] },
      source: { component: "PayButton", line: 18 },
    });
    expect(context.value.element.snippet).not.toContain("onclick");
    expect(context.value.element.snippet).not.toContain("<script");

    const noSnippet = await call(client, "get_annotation_context", { threadId, include: [] });
    expect(noSnippet.value.element.snippet).toBeUndefined();
    expect(noSnippet.value.styles).toBeUndefined();
  });

  it("filters by breakpoint and project scope", async () => {
    const client = await connect(service, { projects: ["shop"] });
    expect((await call(client, "list_threads", { breakpoint: "lg" })).value.threads).toEqual([]);
    expect((await call(client, "list_threads")).value.threads).toHaveLength(1);
    const blocked = await call(client, "list_threads", { projectId: "blog" });
    expect(blocked).toMatchObject({ isError: true, value: { error: { code: "forbidden" } } });
  });

  it("runs the work loop and lands in pending_review by default", async () => {
    const client = await connect(service);
    const working = await call(client, "set_thread_status", { threadId, status: "in_progress" });
    expect(working.value.status).toBe("in_progress");

    const reply = await call(client, "reply_to_thread", { threadId, body: "Looking into it" });
    expect(reply.isError).toBe(false);

    const resolved = await call(client, "resolve_thread", {
      threadId,
      summary: "Matched the card padding at md",
      commitRef: "https://github.com/acme/shop/pull/42",
      files: ["src/checkout/PayButton.tsx"],
    });
    expect(resolved.value.status).toBe("pending_review");
    expect(resolved.value.thread.resolution).toMatchObject({
      status: "pending_review",
      resolvedBy: { kind: "agent", name: "test-agent" },
      note: "Matched the card padding at md",
    });

    const detail = await service.getThread(alan, threadId);
    expect(detail.thread.resolution?.reference).toEqual({
      kind: "pull_request",
      url: "https://github.com/acme/shop/pull/42",
    });
    const agentComments = detail.comments.filter((c) => c.author.kind === "agent");
    expect(agentComments.map((c) => c.metadata?.tool)).toEqual([
      "set_thread_status",
      "reply_to_thread",
      "resolve_thread",
    ]);
    expect(agentComments[2]?.metadata).toMatchObject({
      source: "mcp",
      client: "test-agent",
      files: ["src/checkout/PayButton.tsx"],
    });

    const thread = await call(client, "get_thread", { threadId });
    expect(thread.value.comments.at(-1)).toMatchObject({ system: true });

    const reopened = await call(client, "reopen_thread", { threadId, reason: "Still off" });
    expect(reopened.value.status).toBe("open");
  });

  it("resolves directly when the project opts in", async () => {
    service = createAnnotateKitService({
      storage: createMemoryStorage(),
      resolution: createReviewResolution({
        requiresReview: (actor, thread) => actor.kind === "agent" && thread.projectId !== "shop",
      }),
    });
    threadId = (await service.createThread(alan, threadInput())).thread.id;
    const client = await connect(service);
    const resolved = await call(client, "resolve_thread", { threadId, summary: "Done" });
    expect(resolved.value.status).toBe("resolved");
  });

  it("dismisses a thread with a reason, and it can be reopened", async () => {
    const client = await connect(service);
    const missingReason = await client.callTool({
      name: "dismiss_thread",
      arguments: { threadId },
    });
    expect(missingReason.isError).toBe(true);

    const dismissed = await call(client, "dismiss_thread", {
      threadId,
      reason: "Duplicate of the header padding thread",
    });
    expect(dismissed.value.status).toBe("dismissed");
    expect((await call(client, "list_threads", { projectId: "shop" })).value.threads).toEqual([]);

    const detail = await service.getThread(alan, threadId);
    expect(detail.comments.at(-1)).toMatchObject({
      author: { kind: "agent" },
      body: "test-agent dismissed this thread: Duplicate of the header padding thread",
      metadata: { event: "dismiss", tool: "dismiss_thread", source: "mcp", status: "dismissed" },
    });

    const reopened = await call(client, "reopen_thread", { threadId, reason: "Not a duplicate" });
    expect(reopened.value.status).toBe("open");
  });

  it("needs annotations:resolve to dismiss", async () => {
    const client = await connect(service, { scopes: ["annotations:read", "annotations:write"] });
    const denied = await call(client, "dismiss_thread", { threadId, reason: "nope" });
    expect(denied).toMatchObject({ isError: true, value: { error: { code: "forbidden" } } });
    expect((await service.getThread(alan, threadId)).thread.status).toBe("open");
  });

  it("enforces scopes and reports stable error codes", async () => {
    const client = await connect(service, { scopes: ["annotations:read"] });
    const denied = await call(client, "resolve_thread", { threadId, summary: "x" });
    expect(denied).toMatchObject({ isError: true, value: { error: { code: "forbidden" } } });
    const missing = await call(client, "get_thread", { threadId: "thr_nope" });
    expect(missing.value.error.code).toBe("not_found");
    const bad = await call(client, "set_thread_status", { threadId, status: "in_progress" });
    expect(bad.value.error.code).toBe("forbidden");
  });

  it("lists groups with thread counts and reads the thread resource", async () => {
    const group = await service.createGroup(alan, { projectId: "shop", name: "Checkout" });
    await service.updateThread(alan, threadId, { groupId: group.id });
    const client = await connect(service);
    const groups = await call(client, "list_groups", { projectId: "shop" });
    expect(groups.value.groups).toEqual([{ id: group.id, name: "Checkout", threadCount: 1 }]);

    const resource = await client.readResource({ uri: `annotatekit://threads/${threadId}` });
    const text = (resource.contents[0] as { text: string }).text;
    expect(JSON.parse(text).id).toBe(threadId);

    const prompt = await client.getPrompt({
      name: "work_on_feedback",
      arguments: { pageUrl: "https://shop.example.com/checkout" },
    });
    expect(JSON.stringify(prompt.messages)).toContain("set_thread_status");
  });
});

describe("createMcpHandler over HTTP", () => {
  it("serves tools with bearer auth, mounted next to the REST API", async () => {
    const service = createAnnotateKitService({ storage: createMemoryStorage() });
    const { thread } = await service.createThread(alan, threadInput());
    const mcp = createMcpHandler({
      service,
      authenticate: (request) =>
        request.headers.get("authorization") === "Bearer agent-key"
          ? { actor: { kind: "agent", id: "agt_ci", name: "CI" }, scopes: ["annotations:read"] }
          : null,
      rateLimitPerMinute: 4,
    });
    const app = createAnnotateKitServer({
      service,
      auth: createStaticServerAuth(null),
      mount: { "/mcp": mcp },
    });
    const running = await serve(app.fetch, { port: 0 });
    try {
      const denied = await fetch(`${running.url}/mcp`, { method: "POST", body: "{}" });
      expect(denied.status).toBe(401);

      const client = new Client({ name: "http-agent", version: "1.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`), {
          requestInit: { headers: { authorization: "Bearer agent-key" } },
        }),
      );
      const result = await call(client, "list_threads");
      expect(result.value.threads.map((t: { id: string }) => t.id)).toEqual([thread.id]);
      await client.close();

      // initialize + initialized + tools/call used 3 of 4; the next two calls trip the limit.
      const headers = {
        authorization: "Bearer agent-key",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };
      const body = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" });
      await fetch(`${running.url}/mcp`, { method: "POST", headers, body });
      const limited = await fetch(`${running.url}/mcp`, { method: "POST", headers, body });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
    } finally {
      await running.close();
    }
  });
});

describe("sanitizeSnippet", () => {
  it("strips scripts, handlers and input values", () => {
    expect(
      sanitizeSnippet(
        `<div onmouseover='x()'><input type="text" value="secret" name="q"><script src="a.js"></script></div>`,
      ),
    ).toBe(`<div><input type="text" name="q"></div>`);
  });
});
