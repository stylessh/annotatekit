import { createAnnotateKitClient } from "@annotatekit/client";
import {
  type AnnotateKitService,
  createAnnotateKitService,
  createLocalStorageAdapter,
} from "@annotatekit/core";

export interface Backend {
  service: AnnotateKitService;
  kind: "server" | "local";
  label: string;
}

const DEFAULT_SERVER = "http://localhost:4747/v1";

/**
 * Where the playground keeps threads. `?server=<url>` or `VITE_ANNOTATEKIT_SERVER`
 * picks the REST server (default `http://localhost:4747/v1`); `?server=off` forces
 * localStorage. If the server doesn't answer `/health`, fall back to localStorage.
 */
export async function pickBackend(): Promise<Backend> {
  const param = new URLSearchParams(location.search).get("server");
  const url = param ?? import.meta.env.VITE_ANNOTATEKIT_SERVER ?? DEFAULT_SERVER;
  if (url !== "off" && (await healthy(url))) {
    return {
      service: createAnnotateKitClient({ baseUrl: url }),
      kind: "server",
      label: `server ${url} (live)`,
    };
  }
  const storage = createLocalStorageAdapter({ key: "annotatekit:playground" });
  return {
    service: createAnnotateKitService({ storage }),
    kind: "local",
    label: "localStorage (start the server with `pnpm dev` to share with agents)",
  };
}

async function healthy(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
