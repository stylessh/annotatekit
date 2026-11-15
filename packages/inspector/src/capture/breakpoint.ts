import {
  type Breakpoint,
  type BreakpointPreset,
  resolveBreakpoint,
  tailwindBreakpoints,
  type Viewport,
} from "@annotatekit/core";
import type { MediaState } from "../types.js";

function eachRule(doc: Document, fn: (rule: CSSRule) => void): void {
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      fn(rule);
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) walk(nested);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Cross-origin stylesheet: not readable.
    }
  }
}

/**
 * Build a preset from the min-width media queries the page's own stylesheets
 * use. Names are the pixel values (`"768px"`), plus `base` at 0.
 */
export function detectBreakpointsFromStylesheets(doc: Document = document): BreakpointPreset {
  const found = new Set<number>();
  const rootPx =
    Number.parseFloat(doc.defaultView?.getComputedStyle(doc.documentElement).fontSize ?? "16") ||
    16;
  eachRule(doc, (rule) => {
    const media = (rule as CSSMediaRule).media?.mediaText;
    if (!media) return;
    const re = /(?:min-width\s*:\s*|width\s*>=?\s*)([\d.]+)(px|em|rem)/g;
    for (const m of media.matchAll(re)) {
      const n = Number.parseFloat(m[1] ?? "0");
      found.add(Math.round(m[2] === "px" ? n : n * rootPx));
    }
  });
  const breakpoints: Record<string, number> = { base: 0 };
  for (const px of Array.from(found).sort((a, b) => a - b)) breakpoints[`${px}px`] = px;
  return { system: "detected", breakpoints };
}

function mq(win: Window, query: string): boolean {
  return typeof win.matchMedia === "function" ? win.matchMedia(query).matches : false;
}

export interface BreakpointState {
  breakpoint: Breakpoint;
  viewport: Viewport;
  media: MediaState;
}

/**
 * Current breakpoint per `preset`, plus the media features that change how a
 * page renders. Uses `matchMedia` so it agrees with the page's own CSS (which
 * measures the layout viewport, scrollbar included).
 */
export function detectBreakpoint(
  preset: BreakpointPreset = tailwindBreakpoints,
  win: Window = window,
): BreakpointState {
  const width = win.innerWidth;
  const height = win.innerHeight;
  const sorted = Object.entries(preset.breakpoints).sort((a, b) => a[1] - b[1]);
  const matches = (min: number) =>
    min <= 0 ||
    (typeof win.matchMedia === "function" ? mq(win, `(min-width: ${min}px)`) : width >= min);
  const matched = sorted.filter(([, min]) => matches(min)).map(([name]) => name);
  const current = sorted.filter(([, min]) => matches(min)).pop();
  const breakpoint = resolveBreakpoint(current ? current[1] : width, preset);
  const pointer = mq(win, "(pointer: coarse)")
    ? "coarse"
    : mq(win, "(pointer: fine)")
      ? "fine"
      : "none";
  return {
    breakpoint,
    viewport: { width, height, devicePixelRatio: win.devicePixelRatio || 1 },
    media: {
      matched,
      orientation: width >= height ? "landscape" : "portrait",
      colorScheme: mq(win, "(prefers-color-scheme: dark)") ? "dark" : "light",
      reducedMotion: mq(win, "(prefers-reduced-motion: reduce)"),
      pointer,
    },
  };
}
