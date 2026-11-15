import {
  type Actor,
  AnnotateKitError,
  type AnnotateKitErrorCode,
  type AnnotateKitService,
  type ApiKeyList,
  type ApiKeyManager,
  type ApiKeySummary,
  type Comment,
  type CommentQuery,
  type Group,
  type GroupQuery,
  type Page,
  type StorageChange,
  type StorageListener,
  type Thread,
  type ThreadDetail,
} from "@annotatekit/core";

/** The header `@annotatekit/server`'s dev auth reads the actor from. */
export const ACTOR_HEADER = "x-annotatekit-actor";

export interface AnnotateKitClientOptions {
  /** The API root, e.g. `http://localhost:4747/v1`. */
  baseUrl: string;
  /** A bearer token, or a function returning one (called per request). */
  token?: string | (() => string | null | Promise<string | null>);
  /**
   * Send the per-call actor in the `x-annotatekit-actor` header. Only servers
   * running dev auth read it; others identify you from the token. Defaults to `true`.
   */
  sendActor?: boolean;
  /** Custom fetch, for tests or runtimes without a global one. */
  fetch?: typeof fetch;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Delay before reconnecting the event stream, in ms. Defaults to 2000. */
  reconnectMs?: number;
}

export interface AnnotateKitClient extends AnnotateKitService {
  readonly baseUrl: string;
  /** Live changes over the server's `/events` stream. */
  subscribe(listener: StorageListener, options?: { projectId?: string }): () => void;
  /**
   * Agent API keys for the signed-in person, served by `createApiKeyHandler`
   * from `@annotatekit/auth` at `<baseUrl>/keys`. Pass it to the inspector's
   * `apiKeys` option to manage keys from the toolbar.
   */
  readonly apiKeys: ApiKeyManager;
}

const KNOWN_CODES = new Set<string>([
  "not_found",
  "conflict",
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_allowed",
  "invalid_transition",
  "storage_unavailable",
]);

/**
 * An {@link AnnotateKitService} that talks to `@annotatekit/server` over HTTP.
 * Works in browsers, Node 20+, Bun and Deno.
 */
export function createAnnotateKitClient(options: AnnotateKitClientOptions): AnnotateKitClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const sendActor = options.sendActor ?? true;
  const reconnectMs = options.reconnectMs ?? 2000;

  async function headers(actor: Actor | null, hasBody: boolean): Promise<Headers> {
    const h = new Headers(options.headers);
    if (hasBody) h.set("content-type", "application/json");
    const token = typeof options.token === "function" ? await options.token() : options.token;
    if (token) h.set("authorization", `Bearer ${token}`);
    if (sendActor && actor) h.set(ACTOR_HEADER, encodeURIComponent(JSON.stringify(actor)));
    return h;
  }

  async function call<T>(
    actor: Actor | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      const init: RequestInit = { method, headers: await headers(actor, body !== undefined) };
      if (body !== undefined) init.body = JSON.stringify(body);
      response = await doFetch(`${baseUrl}${path}`, init);
    } catch (cause) {
      throw new AnnotateKitError("storage_unavailable", `Cannot reach ${baseUrl}`, { cause });
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
      const code: AnnotateKitErrorCode =
        error?.code && KNOWN_CODES.has(error.code)
          ? (error.code as AnnotateKitErrorCode)
          : response.status >= 500
            ? "storage_unavailable"
            : "invalid_input";
      throw new AnnotateKitError(code, error?.message ?? `HTTP ${response.status}`);
    }
    return data as T;
  }

  const id = encodeURIComponent;

  return {
    baseUrl,
    listThreads: (actor, query = {}) => call<Page<Thread>>(actor, "GET", `/threads${qs(query)}`),
    getThread: (actor, threadId) => call<ThreadDetail>(actor, "GET", `/threads/${id(threadId)}`),
    createThread: (actor, input) => call<ThreadDetail>(actor, "POST", "/threads", input),
    updateThread: (actor, threadId, input) =>
      call<Thread>(actor, "PATCH", `/threads/${id(threadId)}`, input),
    setThreadStatus: (actor, threadId, input) =>
      call<Thread>(actor, "POST", `/threads/${id(threadId)}/status`, input),
    resolveThread: (actor, threadId, input = {}) =>
      call<Thread>(actor, "POST", `/threads/${id(threadId)}/resolve`, input),
    reopenThread: (actor, threadId, input = {}) =>
      call<Thread>(actor, "POST", `/threads/${id(threadId)}/reopen`, input),
    deleteThread: (actor, threadId) => call<void>(actor, "DELETE", `/threads/${id(threadId)}`),
    listComments: (actor, query: CommentQuery) => {
      const { threadId, ...rest } = query;
      return call<Page<Comment>>(actor, "GET", `/threads/${id(threadId)}/comments${qs(rest)}`);
    },
    addComment: (actor, threadId, input) =>
      call<Comment>(actor, "POST", `/threads/${id(threadId)}/comments`, input),
    updateComment: (actor, commentId, input) =>
      call<Comment>(actor, "PATCH", `/comments/${id(commentId)}`, input),
    deleteComment: (actor, commentId) => call<void>(actor, "DELETE", `/comments/${id(commentId)}`),
    listGroups: (actor, query: GroupQuery = {}) =>
      call<Page<Group>>(actor, "GET", `/groups${qs(query)}`),
    createGroup: (actor, input) => call<Group>(actor, "POST", "/groups", input),
    updateGroup: (actor, groupId, input) =>
      call<Group>(actor, "PATCH", `/groups/${id(groupId)}`, input),
    deleteGroup: (actor, groupId) => call<void>(actor, "DELETE", `/groups/${id(groupId)}`),
    apiKeys: {
      list: (listOptions = {}) =>
        call<ApiKeyList>(null, "GET", `/keys${listOptions.all ? "?all=1" : ""}`),
      create: (input) => call<{ key: string; record: ApiKeySummary }>(null, "POST", "/keys", input),
      revoke: (keyId) => call<void>(null, "DELETE", `/keys/${id(keyId)}`),
    },

    subscribe(listener, subscribeOptions = {}) {
      let stopped = false;
      let controller: AbortController | null = null;
      const path = `/events${qs(subscribeOptions)}`;

      const connect = async () => {
        while (!stopped) {
          controller = new AbortController();
          try {
            const response = await doFetch(`${baseUrl}${path}`, {
              headers: await headers(null, false),
              signal: controller.signal,
            });
            if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
            await readEvents(response.body, (event, data) => {
              if (event !== "change") return;
              try {
                listener(JSON.parse(data) as StorageChange);
              } catch {
                // ignore malformed events
              }
            });
          } catch {
            // fall through to reconnect
          }
          if (!stopped) await new Promise((r) => setTimeout(r, reconnectMs));
        }
      };
      void connect();
      return () => {
        stopped = true;
        controller?.abort();
      };
    },
  };
}

function qs(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) onEvent(event, data.join("\n"));
      index = buffer.indexOf("\n\n");
    }
  }
}
