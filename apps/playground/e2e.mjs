// Drives the playground in real Chromium. Run after `vite build`: node e2e.mjs
// Part one uses localStorage; part two runs the REST server and the real MCP
// CLI and walks the whole loop: annotate, agent reads and resolves, human approves.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { preview } from "vite";

// require() honours NODE_PATH, so a globally installed Playwright works too.
const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const shots = process.env.SHOTS_DIR;
const server = await preview({ preview: { port: 4317, strictPort: true }, logLevel: "silent" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const ready = () => page.waitForFunction(() => window.inspector);
await page.goto("http://localhost:4317/?server=off");
await page.evaluate(() => localStorage.clear());
await page.reload();
await ready();
assert.equal(await page.evaluate(() => window.backend), "local");
await page.evaluate(() => {
  window.__pageClicks = 0;
  document
    .querySelector("[data-testid=cta]")
    .addEventListener("click", () => window.__pageClicks++);
});

const shadow = (sel) =>
  page.evaluate(async (s) => {
    // The overlay renders on the next animation frame; let it settle first.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const root = document.querySelector("[data-annotatekit-overlay]").shadowRoot;
    return Array.from(root.querySelectorAll(s)).map((el) => ({
      hidden: el.hidden,
      text: el.textContent,
      rect: el.getBoundingClientRect().toJSON(),
    }));
  }, sel);
const draft = async () => JSON.parse(await page.textContent("#out"));
const center = async (sel) => {
  const b = await page.locator(sel).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// 1. Toggle on with the shortcut; toolbar reports the breakpoint.
await page.keyboard.press("Alt+KeyA");
assert.equal(await page.evaluate(() => window.inspector.active), true);
assert.match((await shadow(".bp"))[0].text, /^xl · 1280px$/);

// 2. Hover highlights the element under the pointer with a label.
const cta = await center("[data-testid=cta]");
await page.mouse.move(cta.x, cta.y);
await page.waitForTimeout(50);
const [hl] = await shadow(".hl");
const ctaBox = await page.locator("[data-testid=cta]").boundingBox();
assert.equal(hl.hidden, false);
assert.ok(
  Math.abs(hl.rect.x - ctaBox.x) < 1 && Math.abs(hl.rect.width - ctaBox.width) < 1,
  "highlight matches target",
);
assert.match((await shadow(".label"))[0].text, /^button\.btn\.btn--primary/);
if (shots) await page.screenshot({ path: `${shots}/1-hover.png` });

// 3. Click opens the composer without triggering the page's own handler; Enter saves a pin.
await page.mouse.click(cta.x, cta.y);
assert.equal(await page.evaluate(() => window.__pageClicks), 0, "page click swallowed");
assert.equal((await shadow(".composer"))[0].hidden, false);
await page.keyboard.type("Make this button louder");
if (shots) await page.screenshot({ path: `${shots}/2-composer.png` });
await page.keyboard.press("Enter");
let d = await draft();
assert.equal(d.kind, "pin");
assert.equal(d.comment, "Make this button louder");
assert.equal(d.anchor.selector, 'button[data-testid="cta"]');
assert.ok(d.position.x > 0.4 && d.position.x < 0.6, "pin position is relative to the element");
assert.equal(d.context.cssSystem.variables["--color-brand"], "#4f46e5");
assert.deepEqual(d.context.breakpoint, {
  name: "xl",
  minWidth: 1280,
  maxWidth: 1536,
  system: "tailwind",
});
assert.ok(d.context.cssSystem.systems.includes("tailwind"));
assert.equal(d.page.pathname, "/");
assert.equal((await shadow(".pin")).length, 1);

// 4. Shift-click two cards, release Shift: one region annotation covering both.
const cards = page.locator(".card");
await page.keyboard.down("Shift");
for (const i of [0, 1]) {
  const b = await cards.nth(i).boundingBox();
  await page.mouse.click(b.x + 10, b.y + 10);
}
assert.equal((await shadow(".sel")).length, 2);
if (shots) await page.screenshot({ path: `${shots}/3-group-select.png` });
await page.keyboard.up("Shift");
await page.keyboard.type("Align these prices");
await page.keyboard.press("Enter");
d = await draft();
assert.equal(d.kind, "region");
assert.equal(d.targets.length, 2);
assert.equal(d.anchor.selector, "#pricing", "region anchors to the common ancestor");
let pins = await shadow(".pin");
assert.equal(pins.length, 2);
assert.ok(
  pins.some((p) => p.text === "22"),
  "group pin shows its element count",
);

// 5. Shift-click a single element: annotate the whole element.
const scale = await cards.nth(2).boundingBox();
await page.keyboard.down("Shift");
await page.mouse.click(scale.x + 10, scale.y + 10);
await page.keyboard.up("Shift");
await page.keyboard.type("Highlight this plan");
await page.keyboard.press("Enter");
d = await draft();
assert.equal(d.kind, "element");

// 6. Drag an area over the pricing grid.
const grid = await page.locator("#pricing").boundingBox();
await page.mouse.move(grid.x + 4, grid.y + 4);
await page.mouse.down();
await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height / 2, { steps: 4 });
await page.mouse.move(grid.x + grid.width - 4, grid.y + grid.height - 4, { steps: 4 });
if (shots) await page.screenshot({ path: `${shots}/4-area.png` });
await page.mouse.up();
await page.keyboard.type("Too much whitespace");
await page.keyboard.press("Enter");
d = await draft();
assert.equal(d.kind, "region");
assert.equal(d.targets.length, 3, "box captures the three cards");
assert.ok(d.region.width > 500);

// 6b. Text mode: select part of a sentence and quote it.
const clickShadow = async (sel) => {
  const [el] = await shadow(sel);
  await page.mouse.click(el.rect.x + el.rect.width / 2, el.rect.y + el.rect.height / 2);
};
await clickShadow("[data-action=mode-text]");
const lede = await page.locator(".hero__lede").boundingBox();
await page.mouse.move(lede.x + 1, lede.y + 8);
await page.mouse.down();
await page.mouse.move(lede.x + 160, lede.y + 8, { steps: 6 });
await page.mouse.up();
await page.waitForFunction(() => {
  const root = document.querySelector("[data-annotatekit-overlay]").shadowRoot;
  return !root.querySelector(".composer").hidden;
});
const ledeText = (await page.textContent(".hero__lede")).trim().replace(/\s+/g, " ");
await page.keyboard.type("Reword this");
await page.keyboard.press("Enter");
d = await draft();
assert.equal(d.kind, "region");
assert.ok(d.quote.exact.length > 3, "text got quoted");
assert.ok(ledeText.startsWith(d.quote.exact), `quote ${d.quote.exact} starts the lede`);
assert.match(d.anchor.selector, /hero__lede/);
await page.waitForFunction(() => document.querySelectorAll("#threads li").length === 5);
assert.ok((await shadow(".mark")).length >= 1, "quoted text is underlined");
if (shots) await page.screenshot({ path: `${shots}/4b-text.png` });
await clickShadow("[data-action=mode-element]");

// 7. Everything was persisted through core's localStorage adapter.
await page.waitForFunction(() => document.querySelectorAll("#threads li").length === 5);
assert.equal((await shadow(".pin")).length, 5);

// 8. Pins follow their element on scroll.
await page.mouse.move(5, 5);
await page.evaluate(() => window.scrollTo(0, 200));
const ctaAfter = await page.locator("[data-testid=cta]").boundingBox();
const firstPin = (await shadow(".pin"))[0];
assert.ok(
  Math.abs(firstPin.rect.y + 24 - (ctaAfter.y + ctaAfter.height / 2)) < 3,
  "pin stays on the CTA after scroll",
);

// 9. Resolving a thread elsewhere updates its pin; clicking a pin outlines its targets.
await page.locator("#threads li").first().locator("button").click();
await page.waitForTimeout(50);
pins = await page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const root = document.querySelector("[data-annotatekit-overlay]").shadowRoot;
  return Array.from(root.querySelectorAll(".pin"), (p) => p.dataset.status);
});
assert.deepEqual(pins, ["resolved", "open", "open", "open", "open"]);
await page.evaluate(() => window.scrollTo(0, 0));
const groupPin = (await shadow(".pin"))[1];
await page.mouse.click(groupPin.rect.x + 12, groupPin.rect.y + 12);
assert.equal((await shadow(".region")).length, 1);
assert.equal((await shadow(".sel")).length, 2, "focused group outlines its two cards");
if (shots) await page.screenshot({ path: `${shots}/5-focused-group.png` });

// 10. Pins survive a reload, and the breakpoint follows the viewport.
await page.setViewportSize({ width: 500, height: 800 });
await page.reload();
await page.waitForFunction(() => document.querySelectorAll("#threads li").length === 5);
assert.equal((await shadow(".pin")).length, 5);
assert.match((await shadow(".bp"))[0].text, /^base · 500px$/);
if (shots) await page.screenshot({ path: `${shots}/6-mobile.png` });

// 11. Escape exits; destroy cleans up.
await page.keyboard.press("Alt+KeyA");
await page.keyboard.press("Escape");
assert.equal(await page.evaluate(() => window.inspector.active), false);
await page.evaluate(() => window.inspector.destroy());
assert.equal(await page.locator("[data-annotatekit-overlay]").count(), 0);

// 12. The agent loop: REST server + the real MCP CLI over stdio.
const API_PORT = 4748;
const api = `http://127.0.0.1:${API_PORT}/v1`;
const apiServer = spawn(
  process.execPath,
  [join(root, "packages/server/dist/cli.js"), "--db", ":memory:", "--port", String(API_PORT)],
  { stdio: ["ignore", "ignore", "inherit"] },
);
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${api}/health`)).ok) break;
    } catch {}
    if (i > 50) throw new Error("server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`http://localhost:4317/?server=${encodeURIComponent(api)}`);
  await ready();
  assert.equal(await page.evaluate(() => window.backend), "server");
  await page.keyboard.press("Alt+KeyA");
  const target = await center("[data-testid=cta]");
  await page.mouse.click(target.x, target.y);
  await page.keyboard.type("CTA contrast is too low");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("#threads li").length === 1);

  // An agent connects through the actual annotatekit-mcp CLI.
  const agent = new Client({ name: "e2e-agent", version: "1.0.0" });
  await agent.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "packages/mcp/dist/cli.js"), "--server", api, "--user", "Playground user"],
    }),
  );
  const call = async (name, args = {}) => {
    const res = await agent.callTool({ name, arguments: args });
    assert.ok(!res.isError, `${name} failed: ${res.content?.[0]?.text}`);
    return JSON.parse(res.content[0].text);
  };
  const listed = await call("list_threads", { projectId: "playground" });
  const threads = listed.threads ?? listed.items ?? listed;
  assert.equal(threads.length, 1, "agent sees the new thread");
  const threadId = threads[0].id;
  const context = JSON.stringify(await call("get_annotation_context", { threadId }));
  assert.ok(context.includes("data-testid"), "agent sees the selector");
  assert.ok(context.includes("--color-brand"), "agent sees the CSS variables");
  assert.ok(context.includes('"xl"'), "agent sees the breakpoint");
  const resolved = await call("resolve_thread", {
    threadId,
    summary: "Darkened the CTA background",
    commitRef: "abc1234",
  });
  assert.equal(resolved.status, "pending_review");
  await agent.close();

  // The page hears about it live, without a reload.
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-annotatekit-overlay]").shadowRoot;
    return root.querySelector(".pin")?.dataset.status === "pending_review";
  });
  await page.waitForFunction(
    () => document.querySelector("#threads li")?.dataset.status === "pending_review",
  );
  if (shots) await page.screenshot({ path: `${shots}/7-pending-review.png` });

  // A human approves on the page.
  await page.locator("#threads li button", { hasText: "Approve" }).click();
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-annotatekit-overlay]").shadowRoot;
    return root.querySelector(".pin")?.dataset.status === "resolved";
  });
  const detail = await (await fetch(`${api}/threads/${threadId}`)).json();
  assert.equal(detail.thread.status, "resolved");
  assert.equal(detail.thread.resolution.reviewedBy.name, "Playground user");
} finally {
  apiServer.kill();
}

assert.deepEqual(errors, []);
await browser.close();
server.httpServer.close();
console.log("e2e: all checks passed");
