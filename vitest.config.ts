import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Run tests against workspace sources, so packages need no build first.
    alias: [
      // Solid's default export condition under Node is its server build, where
      // effects and onMount never run. Tests need the browser build.
      {
        find: /^solid-js$/,
        replacement: fileURLToPath(
          new URL("./packages/solid/node_modules/solid-js/dist/solid.js", import.meta.url),
        ),
      },
      {
        find: /^@annotatekit\/([a-z-]+)$/,
        replacement: fileURLToPath(new URL("./packages/$1/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
