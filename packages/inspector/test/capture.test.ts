// @vitest-environment happy-dom
import { bootstrapBreakpoints, tailwindBreakpoints } from "@annotatekit/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  anchorFor,
  buildStyleIndex,
  Capturer,
  detectBreakpoint,
  detectBreakpointsFromStylesheets,
  detectPageCssSystems,
  elementVariables,
  isTailwindUtility,
  type MediaState,
  parseDeclarations,
  resolveAnchor,
  splitVariants,
  tailwindInfo,
  uniqueSelector,
} from "../src/index.js";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

const media = (over: Partial<MediaState> = {}): MediaState => ({
  matched: ["base", "sm", "md"],
  orientation: "landscape",
  colorScheme: "light",
  reducedMotion: false,
  pointer: "fine",
  ...over,
});

describe("selectors and anchors", () => {
  it("prefers ids and identifying attributes", () => {
    document.body.innerHTML = `<div id="app"><button data-testid="save">Save</button><button>Other</button></div>`;
    expect(uniqueSelector(document.querySelector("#app") as Element)).toBe("#app");
    expect(uniqueSelector(document.querySelector("[data-testid]") as Element)).toBe(
      'button[data-testid="save"]',
    );
  });

  it("skips hashed and Tailwind-variant classes and disambiguates siblings", () => {
    document.body.innerHTML = `<ul class="list"><li class="item css-1x2y3z md:p-4">a</li><li class="item">b</li></ul>`;
    const second = document.querySelectorAll("li")[1] as Element;
    const sel = uniqueSelector(second);
    expect(sel).not.toContain("css-");
    expect(sel).toContain(":nth-of-type(2)");
    expect(document.querySelector(sel)).toBe(second);
  });

  it("captures core's ElementAnchor shape", () => {
    document.body.innerHTML = `<main><p>before</p><h1 aria-label="Title" class="hero">  Hello   world </h1></main>`;
    const h1 = document.querySelector("h1") as Element;
    const a = anchorFor(h1, { styles: ["display"] });
    expect(a).toMatchObject({
      tagName: "h1",
      classList: ["hero"],
      attributes: { "aria-label": "Title" },
      text: { exact: "Hello world" },
      scroll: { x: 0, y: 0 },
      computedStyles: { display: "block" },
    });
    expect(a.text?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(a.xpath).toBe("/html[1]/body[1]/main[1]/h1[1]");
    expect(a.fallbackSelectors).toEqual(["body > main > h1"]);
    expect(a.htmlSnippet?.startsWith("<h1")).toBe(true);
  });

  it("re-finds an element through fallbacks and text fingerprints", () => {
    document.body.innerHTML = `<main><h2 class="a">Pricing</h2></main>`;
    const a = anchorFor(document.querySelector("h2") as Element);
    document.body.innerHTML = `<section><div><h2 class="renamed">Pricing</h2></div></section>`;
    expect(resolveAnchor(document, a)?.textContent).toBe("Pricing");
    document.body.innerHTML = `<p>gone</p>`;
    expect(resolveAnchor(document, a)).toBeNull();
  });
});

describe("tailwind", () => {
  it("splits variants without breaking arbitrary values", () => {
    expect(splitVariants("md:hover:bg-[color:var(--brand)]")).toEqual({
      variants: ["md", "hover"],
      utility: "bg-[color:var(--brand)]",
    });
  });

  it("recognises utilities", () => {
    for (const c of [
      "p-4",
      "md:flex",
      "-mt-2",
      "text-sm",
      "bg-blue-500/50",
      "[mask-type:luminance]",
      "!font-bold",
      "hidden",
    ]) {
      expect(isTailwindUtility(c), c).toBe(true);
    }
    for (const c of ["card", "btn-primary", "hero__title", "row", "col", "list", "content", "text"])
      expect(isTailwindUtility(c), c).toBe(false);
  });

  it("groups by variant and computes what is active at the breakpoint", () => {
    const bps = tailwindBreakpoints.breakpoints;
    const info = tailwindInfo(
      ["p-2", "md:p-4", "lg:p-8", "max-lg:hidden", "hover:bg-blue-600", "dark:text-white", "card"],
      bps,
      media(),
    );
    expect(info.byVariant).toEqual({
      "": ["p-2"],
      md: ["md:p-4"],
      lg: ["lg:p-8"],
      "max-lg": ["max-lg:hidden"],
      hover: ["hover:bg-blue-600"],
      dark: ["dark:text-white"],
    });
    expect(info.active).toEqual(["p-2", "md:p-4", "max-lg:hidden"]);
    expect(tailwindInfo(["dark:text-white"], bps, media(), true).active).toEqual([
      "dark:text-white",
    ]);
    expect(tailwindInfo(["dark:text-white"], bps, media({ colorScheme: "dark" })).active).toEqual([
      "dark:text-white",
    ]);
  });
});

describe("css variables and systems", () => {
  it("parses declarations, keeping shorthand var() values intact", () => {
    expect(parseDeclarations(`background: var(--a, url("x;y")); color: red`)).toEqual([
      { property: "background", value: `var(--a, url("x;y"))` },
      { property: "color", value: "red" },
    ]);
  });

  it("indexes var() usage and resolves values on matching elements", () => {
    document.head.innerHTML = `<style>
      :root { --brand: #ff0066; --space: 12px; }
      .btn { background: var(--brand); padding: var(--space); --tw-ring-color: red; }
      .other { margin: var(--nope); }
    </style>`;
    document.body.innerHTML = `<button class="btn" style="border-color: var(--edge)">x</button>`;
    const index = buildStyleIndex(document);
    expect(index.hasTailwindVars).toBe(true);
    const vars = elementVariables(document.querySelector(".btn") as Element, index);
    const names = vars.map((v) => v.name);
    expect(names).toEqual(expect.arrayContaining(["--brand", "--space", "--edge"]));
    expect(names).not.toContain("--nope");
    expect(vars.find((v) => v.name === "--brand")).toMatchObject({ property: "background" });
  });

  it("detects page-level systems from markup and stylesheets", () => {
    document.body.innerHTML = Array.from(
      { length: 5 },
      () => `<div class="flex p-4 text-sm"><span class="sc-abc123">x</span></div>`,
    ).join("");
    const systems = detectPageCssSystems(document);
    expect(systems).toContain("tailwind");
    expect(systems).toContain("styled-components");

    document.body.innerHTML = `<div class="card"><p>hello</p></div>`;
    expect(detectPageCssSystems(document)).toEqual(["plain"]);

    document.head.innerHTML = `<style>:root { --bs-primary: #0d6efd; }</style>`;
    expect(detectPageCssSystems(document)).toEqual(["bootstrap"]);
  });
});

describe("breakpoints", () => {
  it("builds a preset from the page's min-width media queries", () => {
    document.head.innerHTML = `<style>
      @media (min-width: 600px) { .a { color: red } }
      @media (min-width: 60em) { .b { color: red } }
      @media (width >= 1200px) { .c { color: red } }
    </style>`;
    expect(detectBreakpointsFromStylesheets(document)).toEqual({
      system: "detected",
      breakpoints: { base: 0, "600px": 600, "960px": 960, "1200px": 1200 },
    });
  });

  it("names the current breakpoint with core's Breakpoint shape", () => {
    const state = detectBreakpoint({
      system: "t",
      breakpoints: { base: 0, sm: 1, md: 2, huge: 100000 },
    });
    expect(state.media.matched).toEqual(["base", "sm", "md"]);
    expect(state.breakpoint).toEqual({ name: "md", minWidth: 2, maxWidth: 100000, system: "t" });
    expect(state.viewport.width).toBe(window.innerWidth);
    expect(detectBreakpoint(bootstrapBreakpoints).breakpoint.system).toBe("bootstrap");
  });
});

describe("Capturer", () => {
  it("snapshots an element and builds core's CaptureContext", () => {
    document.head.innerHTML = `<style>.row { color: var(--ink); } :root { --ink: #111; }</style>`;
    document.body.innerHTML = `<div class="row flex gap-2 md:p-4" data-testid="row">x</div>`;
    const c = new Capturer(document);
    const snap = c.element(document.querySelector("[data-testid=row]") as Element);
    expect(snap.anchor.attributes).toEqual({ "data-testid": "row" });
    expect(snap.css.systems[0]).toBe("tailwind");
    expect(snap.css.tailwind?.byVariant).toEqual({ "": ["flex", "gap-2"], md: ["md:p-4"] });
    expect(snap.fixed).toBe(false);

    const ctx = c.context(snap, [snap]);
    expect(ctx.breakpoint?.system).toBe("tailwind");
    expect(ctx.cssSystem).toEqual({
      systems: ["tailwind"],
      utilityClasses: ["flex", "gap-2", "md:p-4"],
      // happy-dom does not inherit custom properties; the e2e test checks real values.
      variables: { "--ink": expect.any(String) },
    });
    expect(ctx.extra?.inspector).toMatchObject({ targetCount: 1 });
    expect(c.page()).toMatchObject({ origin: location.origin, pathname: location.pathname });
  });
});
