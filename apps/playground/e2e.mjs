// Drives the playground in real Chromium. Run after `vite build`: node e2e.mjs
import { createRequire } from "node:module";

// require() honours NODE_PATH, so a globally installed Playwright works too.
const { chromium } = createRequire(import.meta.url)("playwright");

import assert from "node:assert/strict";
import { preview } from "vite";

const shots = process.env.SHOTS_DIR;
const server = await preview({ preview: { port: 4317, strictPort: true }, logLevel: "silent" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:4317/");
await page.evaluate(() => localStorage.clear());
await page.reload();
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

// 7. Everything was persisted through core's localStorage adapter.
await page.waitForFunction(() => document.querySelectorAll("#threads li").length === 4);
assert.equal((await shadow(".pin")).length, 4);

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
assert.deepEqual(pins, ["resolved", "open", "open", "open"]);
await page.evaluate(() => window.scrollTo(0, 0));
const groupPin = (await shadow(".pin"))[1];
await page.mouse.click(groupPin.rect.x + 12, groupPin.rect.y + 12);
assert.equal((await shadow(".region")).length, 1);
assert.equal((await shadow(".sel")).length, 2, "focused group outlines its two cards");
if (shots) await page.screenshot({ path: `${shots}/5-focused-group.png` });

// 10. Pins survive a reload, and the breakpoint follows the viewport.
await page.setViewportSize({ width: 500, height: 800 });
await page.reload();
await page.waitForFunction(() => document.querySelectorAll("#threads li").length === 4);
assert.equal((await shadow(".pin")).length, 4);
assert.match((await shadow(".bp"))[0].text, /^base · 500px$/);
if (shots) await page.screenshot({ path: `${shots}/6-mobile.png` });

// 11. Escape exits; destroy cleans up.
await page.keyboard.press("Alt+KeyA");
await page.keyboard.press("Escape");
assert.equal(await page.evaluate(() => window.inspector.active), false);
await page.evaluate(() => window.inspector.destroy());
assert.equal(await page.locator("[data-annotatekit-overlay]").count(), 0);

assert.deepEqual(errors, []);
await browser.close();
server.httpServer.close();
console.log("e2e: all checks passed");
