import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

const BUNDLE = fileURLToPath(new URL("../../packages/embed/dist/annotatekit.js", import.meta.url));
const ATTRS = ["project", "server", "user-name", "theme", "accent"];
const escapeAttr = (v: string) => v.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Serves `/embed/`: a plain page whose only AnnotateKit code is the one-line
 * script tag from `@annotatekit/embed` (build it first). Query parameters
 * become the tag's data attributes, e.g. `/embed/?server=http://localhost:4747/v1`.
 */
function embedDemo(): Plugin {
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/embed/annotatekit.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(readFileSync(BUNDLE));
      return;
    }
    if (url.pathname !== "/embed/" && url.pathname !== "/embed") return next();
    const attrs = ATTRS.filter((a) => url.searchParams.has(a))
      .map((a) => ` data-${a}="${escapeAttr(url.searchParams.get(a) ?? "")}"`)
      .join("");
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Plain site</title>
    <style>body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }</style>
  </head>
  <body>
    <h1>A plain site</h1>
    <p>No framework, no build step. Press Alt+A to annotate.</p>
    <p><button id="buy" type="button">Buy now</button></p>
    <script src="/embed/annotatekit.js" data-project="plain-site"${attrs}></script>
  </body>
</html>`);
  };
  return {
    name: "annotatekit-embed-demo",
    configureServer: (server) => void server.middlewares.use(handle),
    configurePreviewServer: (server) => void server.middlewares.use(handle),
  };
}

// Top-level await picks the backend before the overlay mounts.
export default defineConfig({
  // Use workspace packages' sources, so `pnpm ui` needs no build first.
  resolve: { conditions: ["@annotatekit/source", ...defaultClientConditions] },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        ui: fileURLToPath(new URL("./ui.html", import.meta.url)),
      },
    },
  },
  plugins: [embedDemo()],
});
