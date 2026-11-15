#!/usr/bin/env node
// One command for the whole local loop: build the packages, then run the REST
// server (SQLite in .annotatekit/) and the playground side by side.
//
//   pnpm dev                       server on :4747, playground on :5173
//   ANNOTATEKIT_PORT=4800 pnpm dev
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.ANNOTATEKIT_PORT ?? "4747";
const db = process.env.ANNOTATEKIT_DB ?? join(root, ".annotatekit", "dev.db");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (!process.argv.includes("--no-build")) {
  console.log("[dev] building packages…");
  const built = spawnSync(pnpm, ["--filter", "./packages/**", "-r", "run", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
mkdirSync(dirname(db), { recursive: true });

const children = [];
function run(name, color, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = "";
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(`${prefix}${line}\n`);
    });
  }
  child.on("exit", (code) => {
    console.log(`${prefix}exited with ${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const apiUrl = `http://localhost:${port}/v1`;
run("server", "36", process.execPath, [
  join(root, "packages/server/dist/cli.js"),
  "--db",
  db,
  "--port",
  port,
]);
run("playground", "35", pnpm, ["--filter", "@annotatekit/playground", "dev"], {
  VITE_ANNOTATEKIT_SERVER: apiUrl,
});

console.log(`[dev] API ${apiUrl} · SQLite ${db}`);
console.log(`[dev] Agents: node packages/mcp/dist/cli.js --server ${apiUrl} --user "$USER"`);
