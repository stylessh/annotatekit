import type { CssDetail, CssSystemName, CssVariableUsage, MediaState } from "../types.js";

/** Utilities that are complete on their own (`flex`, `hidden`, `truncate`). */
const TW_STANDALONE =
  /^(?:container|sr-only|not-sr-only|static|fixed|absolute|relative|sticky|block|inline|inline-block|inline-flex|inline-grid|inline-table|flex|grid|contents|flow-root|hidden|table|visible|invisible|collapse|truncate|underline|overline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|italic|not-italic|antialiased|subpixel-antialiased|grow|shrink|isolate|transform|transition|outline|ring|shadow|rounded|border|filter|blur|grayscale|invert|sepia|ordinal|slashed-zero|tabular-nums|proportional-nums|lining-nums|oldstyle-nums|diagonal-fractions|stacked-fractions|resize|snap-start|snap-end|snap-center)$/;

/** Utility families that always take a value (`p-4`, `text-sm`, `bg-red-500`, `grid-cols-3`). */
const TW_PREFIXED =
  /^(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|w|h|min-w|min-h|max-w|max-h|size|inset|inset-x|inset-y|top|right|bottom|left|start|end|z|gap|gap-x|gap-y|space-x|space-y|order|col|row|basis|grow|shrink|flex|grid-cols|grid-rows|grid-flow|col-span|row-span|col-start|col-end|row-start|row-end|auto-cols|auto-rows|items|justify|justify-items|justify-self|content|self|place-content|place-items|place-self|text|font|leading|tracking|bg|from|via|to|fill|stroke|border|border-x|border-y|border-t|border-r|border-b|border-l|border-s|border-e|rounded|rounded-t|rounded-r|rounded-b|rounded-l|rounded-s|rounded-e|rounded-tl|rounded-tr|rounded-br|rounded-bl|shadow|ring|ring-offset|outline|outline-offset|opacity|overflow|overflow-x|overflow-y|overscroll|object|aspect|cursor|select|pointer-events|duration|delay|ease|animate|scale|scale-x|scale-y|rotate|translate-x|translate-y|skew-x|skew-y|origin|divide|divide-x|divide-y|decoration|underline-offset|list|line-clamp|whitespace|break|columns|backdrop|blur|brightness|contrast|hue-rotate|saturate|drop-shadow|accent|caret|scroll|scroll-m|scroll-p|snap|touch|will-change|indent|align|mix-blend|bg-blend|float|clear|box|display|visibility|transition|inset-ring|field-sizing|line|tab|text-shadow|mask)-.+$/;

/** Split `md:hover:bg-[color:var(--x)]` into variants and utility, respecting brackets. */
export function splitVariants(cls: string): { variants: string[]; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of cls) {
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    if (ch === ":" && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const utility = parts.pop() ?? "";
  return { variants: parts, utility };
}

export function isTailwindUtility(cls: string): boolean {
  let { utility } = splitVariants(cls);
  utility = utility.replace(/^!|!$/g, "");
  if (/^\[[a-z-]+:.+\]$/.test(utility)) return true; // arbitrary property: [mask-type:luminance]
  utility = utility.replace(/^-/, "");
  return TW_STANDALONE.test(utility) || TW_PREFIXED.test(utility);
}

function variantActive(
  variant: string,
  breakpoints: Record<string, number>,
  media: MediaState,
  darkClass: boolean,
): boolean {
  if (variant in breakpoints) return media.matched.includes(variant);
  const max = variant.startsWith("max-") ? variant.slice(4) : "";
  if (max && max in breakpoints) return !media.matched.includes(max);
  if (variant === "dark") return darkClass || media.colorScheme === "dark";
  if (variant === "motion-reduce") return media.reducedMotion;
  if (variant === "motion-safe") return !media.reducedMotion;
  if (variant === "portrait" || variant === "landscape") return media.orientation === variant;
  // Interactive states (hover, focus, …) and anything unknown: not active at rest.
  return false;
}

export function tailwindInfo(
  classes: string[],
  breakpoints: Record<string, number>,
  media: MediaState,
  darkClass = false,
): NonNullable<CssDetail["tailwind"]> {
  const byVariant: Record<string, string[]> = {};
  const active: string[] = [];
  for (const cls of classes) {
    if (!isTailwindUtility(cls)) continue;
    const { variants } = splitVariants(cls);
    const key = variants.join(":");
    const bucket = byVariant[key] ?? [];
    bucket.push(cls);
    byVariant[key] = bucket;
    if (variants.every((v) => variantActive(v, breakpoints, media, darkClass))) active.push(cls);
  }
  return { byVariant, active };
}

// ---------------------------------------------------------------------------
// Page-level detection
// ---------------------------------------------------------------------------

export interface StyleIndex {
  /** Style rules that reference at least one custom property. */
  varRules: Array<{ selector: string; decls: Array<{ property: string; vars: string[] }> }>;
  hasTailwindVars: boolean;
  hasBootstrapVars: boolean;
  hasStyledTag: boolean;
  hasEmotionTag: boolean;
}

const VAR_RE = /var\(\s*(--[\w-]+)/g;

/** Split a declaration block into property/value pairs, respecting parens and strings. */
export function parseDeclarations(cssText: string): Array<{ property: string; value: string }> {
  const out: Array<{ property: string; value: string }> = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const push = (chunk: string) => {
    const i = chunk.indexOf(":");
    if (i > 0) out.push({ property: chunk.slice(0, i).trim(), value: chunk.slice(i + 1).trim() });
  };
  for (let i = 0; i < cssText.length; i++) {
    const ch = cssText.charAt(i);
    if (quote) {
      if (ch === quote && cssText[i - 1] !== "\\") quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) {
      push(cssText.slice(start, i));
      start = i + 1;
    }
  }
  push(cssText.slice(start));
  return out;
}

/** Scan same-origin stylesheets once; reuse the index for every capture. */
export function buildStyleIndex(doc: Document = document): StyleIndex {
  const index: StyleIndex = {
    varRules: [],
    hasTailwindVars: false,
    hasBootstrapVars: false,
    hasStyledTag: !!doc.querySelector("style[data-styled], style[data-styled-version]"),
    hasEmotionTag: !!doc.querySelector("style[data-emotion]"),
  };
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style;
      const selector = (rule as CSSStyleRule).selectorText;
      if (style && selector) {
        const decls: StyleIndex["varRules"][number]["decls"] = [];
        // Read cssText rather than iterating longhands: a shorthand that uses var()
        // (e.g. `background: var(--brand)`) reports empty longhand values.
        for (const { property, value } of parseDeclarations(style.cssText)) {
          if (property.startsWith("--tw-")) index.hasTailwindVars = true;
          if (property.startsWith("--bs-")) index.hasBootstrapVars = true;
          const vars = Array.from(value.matchAll(VAR_RE), (m) => m[1] ?? "");
          if (vars.some((v) => v.startsWith("--tw-"))) index.hasTailwindVars = true;
          if (vars.length) decls.push({ property, vars });
        }
        if (decls.length) index.varRules.push({ selector, decls });
      }
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) walk(nested);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      /* cross-origin */
    }
  }
  return index;
}

const BOOTSTRAP_CLASS =
  /^(?:col-(?:sm-|md-|lg-|xl-|xxl-)?(?:\d{1,2}|auto)|d-(?:sm-|md-|lg-|xl-)?(?:none|flex|block|grid|inline-flex)|btn-(?:primary|secondary|success|danger|warning|info|light|dark|link|outline-\w+)|justify-content-\w+|align-items-\w+|text-bg-\w+)$/;

function classSystems(classes: string[]): CssSystemName[] {
  const out = new Set<CssSystemName>();
  let tw = 0;
  for (const c of classes) {
    if (/^sc-[a-zA-Z0-9]+$/.test(c)) out.add("styled-components");
    else if (/^css-[a-z0-9]{5,}(-[\w]+)?$/.test(c)) out.add("emotion");
    else if (
      /^[A-Za-z][\w-]*_[\w-]+__[A-Za-z0-9_-]{5}$/.test(c) ||
      /^_[\w-]+_[a-z0-9]{5,}_\d+$/.test(c)
    )
      out.add("css-modules");
    else if (BOOTSTRAP_CLASS.test(c)) out.add("bootstrap");
    if (isTailwindUtility(c)) tw++;
  }
  if (tw > 0 && tw >= Math.min(2, classes.length)) out.add("tailwind");
  return Array.from(out);
}

export function detectPageCssSystems(
  doc: Document = document,
  index = buildStyleIndex(doc),
): CssSystemName[] {
  const counts = new Map<CssSystemName, number>();
  const bump = (s: CssSystemName, n = 1) => counts.set(s, (counts.get(s) ?? 0) + n);
  if (index.hasTailwindVars) bump("tailwind", 50);
  if (index.hasStyledTag) bump("styled-components", 50);
  if (index.hasEmotionTag) bump("emotion", 50);
  if (index.hasBootstrapVars) bump("bootstrap", 50);
  const els = doc.body ? Array.from(doc.body.querySelectorAll("[class]")).slice(0, 2000) : [];
  for (const el of els) for (const s of classSystems(Array.from(el.classList))) bump(s);
  const systems = Array.from(counts.entries())
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);
  return systems.length ? systems : ["plain"];
}

function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false; // pseudo-elements and unsupported selectors
  }
}

const MAX_VARS = 40;

export function elementVariables(el: Element, index: StyleIndex): CssVariableUsage[] {
  const view = el.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(el);
  const seen = new Map<string, CssVariableUsage>();
  const add = (name: string, property?: string) => {
    if (seen.has(name) || seen.size >= MAX_VARS) return;
    const value = computed?.getPropertyValue(name).trim() ?? "";
    const usage: CssVariableUsage = { name, value };
    if (property) usage.property = property;
    seen.set(name, usage);
  };
  const inline = (el as HTMLElement).style;
  if (inline) {
    for (const d of parseDeclarations(inline.cssText)) {
      for (const m of d.value.matchAll(VAR_RE)) if (m[1]) add(m[1], d.property);
    }
  }
  for (const rule of index.varRules) {
    if (!safeMatches(el, rule.selector)) continue;
    for (const d of rule.decls) {
      if (d.property.startsWith("--tw-")) continue; // Tailwind plumbing, not design tokens
      for (const v of d.vars) if (!v.startsWith("--tw-")) add(v, d.property);
    }
  }
  return Array.from(seen.values());
}

export function cssDetailFor(
  el: Element,
  opts: {
    index: StyleIndex;
    breakpoints: Record<string, number>;
    media: MediaState;
    pageSystems: CssSystemName[];
  },
): CssDetail {
  const classes = Array.from(el.classList);
  const systems = classSystems(classes);
  const info: CssDetail = {
    systems: systems.length ? systems : ["plain"],
    variables: elementVariables(el, opts.index),
  };
  if (
    systems.includes("tailwind") ||
    (opts.pageSystems.includes("tailwind") && classes.some(isTailwindUtility))
  ) {
    if (!info.systems.includes("tailwind")) info.systems.unshift("tailwind");
    const darkClass =
      el.ownerDocument.documentElement.classList.contains("dark") || !!el.closest(".dark");
    info.tailwind = tailwindInfo(classes, opts.breakpoints, opts.media, darkClass);
  }
  info.systems = info.systems.filter((s, _i, a) => s !== "plain" || a.length === 1);
  return info;
}
