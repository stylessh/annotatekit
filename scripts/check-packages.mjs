// Packs every public package the way `pnpm publish` would (publishConfig
// applied, workspace:* rewritten) and checks the tarball with publint and
// Are The Types Wrong. Run after `pnpm build`: node scripts/check-packages.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = (name) => join(root, "node_modules/.bin", name);
const out = mkdtempSync(join(tmpdir(), "annotatekit-pack-"));
const failures = [];

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  for (const dir of readdirSync(join(root, "packages")).sort()) {
    const pkgDir = join(root, "packages", dir);
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    if (pkg.private) continue;
    const tarball = run("pnpm", ["pack", "--pack-destination", out], pkgDir)
      .trim()
      .split("\n")
      .pop();
    const problems = [];

    // The packed manifest is what npm users get.
    const manifest = JSON.parse(run("tar", ["-xOzf", tarball, "package/package.json"], root));
    const text = JSON.stringify(manifest);
    if (text.includes("workspace:")) problems.push("manifest still has workspace: ranges");
    if (text.includes("@annotatekit/source"))
      problems.push("manifest exports the source condition");
    const files = run("tar", ["-tzf", tarball], root);
    if (!files.includes("package/LICENSE")) problems.push("LICENSE missing from tarball");
    if (!files.includes("package/README.md")) problems.push("README.md missing from tarball");

    for (const [tool, args] of [
      ["publint", ["run", tarball, "--strict"]],
      ["attw", [tarball, "--profile", "esm-only", "--format", "table-flipped"]],
    ]) {
      try {
        run(bin(tool), args, root);
      } catch (e) {
        problems.push(`${tool}:\n${e.stdout || ""}${e.stderr || ""}`.trim());
      }
    }

    if (problems.length) failures.push(`${pkg.name}\n  ${problems.join("\n  ")}`);
    console.log(`${problems.length ? "✗" : "✓"} ${pkg.name}`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.join("\n\n")}`);
  process.exit(1);
}
