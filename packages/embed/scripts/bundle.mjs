// Builds dist/annotatekit.js: one self-contained, minified script for a <script> tag.
import { build } from "esbuild";

await build({
  entryPoints: [new URL("../src/auto.ts", import.meta.url).pathname],
  outfile: new URL("../dist/annotatekit.js", import.meta.url).pathname,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  platform: "browser",
  // Resolve workspace packages from source, like the rest of the repo's tooling.
  conditions: ["@annotatekit/source"],
  legalComments: "none",
  logLevel: "warning",
});
