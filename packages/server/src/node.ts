import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { FetchHandler } from "./handler.js";

/** Adapt a fetch handler to Node's `http` request listener. */
export function toNodeListener(
  handler: FetchHandler,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handle(handler, req, res);
  };
}

export interface ServeOptions {
  /** Defaults to 4747. Use 0 for a random free port. */
  port?: number;
  /** Defaults to `127.0.0.1`, so the server is not exposed to the network. */
  hostname?: string;
}

export interface RunningServer {
  server: Server;
  /** e.g. `http://127.0.0.1:4747` */
  url: string;
  close(): Promise<void>;
}

/** Start a Node HTTP server for a fetch handler. */
export async function serve(
  handler: FetchHandler,
  options: ServeOptions = {},
): Promise<RunningServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  const server = createServer(toNodeListener(handler));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4747, hostname, () => resolve());
  });
  const address = server.address() as AddressInfo;
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    server,
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(handler: FetchHandler, req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const request = toRequest(req, controller.signal);
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    if (!response.body) {
      res.end();
      return;
    }
    res.flushHeaders();
    const reader = response.body.getReader();
    controller.signal.addEventListener("abort", () => {
      void reader.cancel().catch(() => {});
    });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error("[annotatekit] request failed", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "internal", message: "Internal server error" } }));
    } else {
      res.end();
    }
  }
}

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers, signal };
  if (method !== "GET" && method !== "HEAD") {
    init.body = new ReadableStream({
      start(controller) {
        req.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        req.on("end", () => controller.close());
        req.on("error", (error) => controller.error(error));
      },
    });
    init.duplex = "half";
  }
  return new Request(url, init);
}
