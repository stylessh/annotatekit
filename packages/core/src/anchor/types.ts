export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A quote of the element's visible text, used to re-find the element when
 * selectors break. `fingerprint` is a hash of the normalised `exact` text.
 */
export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
  fingerprint: string;
}

/** Where the element comes from in source, when a framework can tell us. */
export interface SourceHint {
  framework?: string;
  component?: string;
  file?: string;
  line?: number;
  column?: number;
}

/**
 * Everything needed to find an element again and describe it to a human or
 * an agent. Captured once, at annotation time.
 */
export interface ElementAnchor {
  /** Best CSS selector for the element. */
  selector: string;
  /** Less specific selectors tried in order when `selector` no longer matches. */
  fallbackSelectors?: string[];
  xpath?: string;
  tagName: string;
  elementId?: string;
  classList?: string[];
  /** Stable attributes worth keeping, such as `data-testid`, `role`, `aria-label`. */
  attributes?: Record<string, string>;
  text?: TextQuote;
  /** Element box in document coordinates (viewport rect plus scroll). */
  rect: Rect;
  /** Window scroll offsets at capture time. */
  scroll: Point;
  /** Trimmed `outerHTML`, for context. */
  htmlSnippet?: string;
  /** A whitelist of computed style properties, such as `color` or `font-size`. */
  computedStyles?: Record<string, string>;
  source?: SourceHint;
}

export interface Viewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface Breakpoint {
  /** Breakpoint name, such as `md`. */
  name: string;
  /** Inclusive lower bound in CSS pixels. */
  minWidth: number;
  /** Exclusive upper bound in CSS pixels; absent for the largest breakpoint. */
  maxWidth?: number;
  /** The breakpoint system the name comes from, such as `tailwind`. */
  system?: string;
}

export type CssSystemName =
  | "tailwind"
  | "bootstrap"
  | "css-modules"
  | "styled-components"
  | "emotion"
  | "vanilla-extract"
  | "unocss"
  | "plain";

export interface CssSystemInfo {
  /** Systems detected on the page or element, most likely first. */
  systems: CssSystemName[];
  /** Utility classes on the element that belong to a detected system. */
  utilityClasses?: string[];
  /** CSS custom properties resolved on the element, such as `--brand: #f00`. */
  variables?: Record<string, string>;
}

/** The environment the annotation was captured in. */
export interface CaptureContext {
  viewport: Viewport;
  breakpoint?: Breakpoint;
  cssSystem?: CssSystemInfo;
  colorScheme?: "light" | "dark";
  userAgent?: string;
  /** Room for renderer- or inspector-specific data. */
  extra?: Record<string, unknown>;
}
