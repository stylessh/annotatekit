import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Run tests against workspace sources, so packages need no build first.
    alias: [
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
