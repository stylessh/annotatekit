import { createTextQuote, type ElementAnchor, normalizeText } from "@annotatekit/core";
import {
  composedParent,
  hostOf,
  queryDeep,
  SCOPE_SEPARATOR,
  type Scope,
  scopeOf,
} from "./scope.js";

/** Same normalisation and truncation as capture, so long texts compare equal. */
const fingerprintOf = (el: Element) => createTextQuote(el.textContent ?? "").fingerprint;

export const DEFAULT_IDENTIFYING_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "data-component",
  "data-annotate-id",
] as const;

/** Attributes kept on the anchor for humans and agents, besides the identifying ones. */
const DESCRIPTIVE_ATTRIBUTES = ["role", "aria-label", "name", "type", "href", "alt", "title"];

const SNIPPET_MAX = 300;
const ATTR_MAX = 500;

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/([^\w-])/g, "\\$1").replace(/^(\d)/, "\\3$1 ");
}

/** Hashed or generated class names make poor selectors: they change every build. */
export function isUnstableClass(cls: string): boolean {
  return (
    /^(css|sc|jsx|emotion|svelte)-[a-z0-9]+$/i.test(cls) ||
    /__[A-Za-z0-9_-]{5,}$/.test(cls) || // CSS modules: Button_root__a1B2c
    /^_[a-zA-Z0-9]{5,}$/.test(cls) ||
    /[:[\]/!@.%]/.test(cls) // Tailwind variant/arbitrary classes churn and need escaping
  );
}

function isUnique(root: Scope, selector: string, el: Element): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function nthOfType(el: Element): string {
  // A shadow root's top-level elements have no parentElement, only the root.
  const parent = el.parentElement ?? (hostOf(el) ? (el.parentNode as ShadowRoot) : null);
  if (!parent) return "";
  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  return same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : "";
}

function segmentFor(el: Element, identifying: readonly string[]): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && !/^\d|[:.]/.test(el.id)) return `#${cssEscape(el.id)}`;
  for (const attr of identifying) {
    const v = el.getAttribute(attr);
    if (v) return `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
  }
  const stable = Array.from(el.classList)
    .filter((c) => !isUnstableClass(c))
    .slice(0, 2);
  return tag + stable.map((c) => `.${cssEscape(c)}`).join("") + nthOfType(el);
}

/** Prefix for an element inside a shadow root: its host's selector and `>>>`. */
function hostPrefix(el: Element, selectorOf: (host: Element) => string): string {
  const host = hostOf(el);
  return host ? selectorOf(host) + SCOPE_SEPARATOR : "";
}

/**
 * The shortest unique selector found by walking up until the chain is unique.
 * Inside a shadow root it is unique within that root, after the host's selector.
 */
export function uniqueSelector(
  el: Element,
  identifying: readonly string[] = DEFAULT_IDENTIFYING_ATTRIBUTES,
): string {
  const root = scopeOf(el);
  const prefix = hostPrefix(el, (h) => uniqueSelector(h, identifying));
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== el.ownerDocument.documentElement) {
    const seg = segmentFor(node, identifying);
    parts.unshift(seg);
    const candidate = parts.join(" > ");
    if (isUnique(root, candidate, el)) return prefix + candidate;
    node = node.parentElement;
  }
  return prefix + parts.join(" > ");
}

/** A purely structural selector (`body > main:nth-of-type(1) > …`) that survives class renames. */
export function structuralSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.tagName !== "HTML") {
    parts.unshift(node.tagName.toLowerCase() + nthOfType(node));
    node = node.parentElement;
  }
  return hostPrefix(el, structuralSelector) + parts.join(" > ");
}

/** XPath can't enter shadow roots, so elements inside one get none. */
export function xpathFor(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node) {
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    const index = parent
      ? Array.from(parent.children)
          .filter((c) => c.tagName === node?.tagName)
          .indexOf(node) + 1
      : 1;
    parts.unshift(`${tag}[${index}]`);
    node = parent;
  }
  return `/${parts.join("/")}`;
}

/** Short readable ancestor path, e.g. `main > section.hero > button.cta`. Not unique. */
export function elementPath(el: Element, depth = 4): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && parts.length < depth && node.tagName !== "HTML") {
    const tag = node.tagName.toLowerCase();
    const cls = Array.from(node.classList).find((c) => !isUnstableClass(c));
    parts.unshift(node.id ? `${tag}#${node.id}` : cls ? `${tag}.${cls}` : tag);
    node = composedParent(node);
  }
  return parts.join(" > ");
}

export function isFixed(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  let node: Element | null = el;
  while (node && node !== el.ownerDocument.body) {
    const pos = view.getComputedStyle(node).position;
    if (pos === "fixed" || pos === "sticky") return true;
    node = composedParent(node);
  }
  return false;
}

/** Element box in document coordinates (viewport rect plus scroll). */
export function documentRect(el: Element): ElementAnchor["rect"] {
  const r = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  return {
    x: r.left + (view?.scrollX ?? 0),
    y: r.top + (view?.scrollY ?? 0),
    width: r.width,
    height: r.height,
  };
}

function snippet(el: Element): string {
  const html = el.outerHTML.replace(/\s+/g, " ");
  return html.length > SNIPPET_MAX ? `${html.slice(0, SNIPPET_MAX - 1)}…` : html;
}

function siblingText(el: Element, dir: "prev" | "next"): string {
  let node = dir === "prev" ? el.previousSibling : el.nextSibling;
  let out = "";
  while (node && out.length < 64) {
    const t = node.textContent ?? "";
    out = dir === "prev" ? t + out : out + t;
    node = dir === "prev" ? node.previousSibling : node.nextSibling;
  }
  return out;
}

export interface AnchorOptions {
  identifyingAttributes?: readonly string[];
  /** Computed style properties to record. */
  styles?: readonly string[];
}

export function anchorFor(el: Element, opts: AnchorOptions = {}): ElementAnchor {
  const identifying = opts.identifyingAttributes ?? DEFAULT_IDENTIFYING_ATTRIBUTES;
  const view = el.ownerDocument.defaultView;
  const selector = uniqueSelector(el, identifying);
  const anchor: ElementAnchor = {
    selector,
    tagName: el.tagName.toLowerCase(),
    rect: documentRect(el),
    scroll: { x: view?.scrollX ?? 0, y: view?.scrollY ?? 0 },
    htmlSnippet: snippet(el),
  };
  if (!hostOf(el)) anchor.xpath = xpathFor(el);
  const fallbacks = [structuralSelector(el)].filter((s) => s !== selector);
  if (fallbacks.length) anchor.fallbackSelectors = fallbacks;
  if (el.id) anchor.elementId = el.id;
  if (el.classList.length) anchor.classList = Array.from(el.classList);

  const attributes: Record<string, string> = {};
  for (const name of [...identifying, ...DESCRIPTIVE_ATTRIBUTES]) {
    const v = el.getAttribute(name);
    if (v != null) attributes[name] = v.slice(0, ATTR_MAX);
  }
  if (Object.keys(attributes).length) anchor.attributes = attributes;

  const text = normalizeText(el.textContent ?? "");
  if (text) {
    anchor.text = createTextQuote(text, {
      prefix: siblingText(el, "prev"),
      suffix: siblingText(el, "next"),
    });
  }

  if (opts.styles?.length && view) {
    const computed = view.getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const p of opts.styles) {
      const v = computed.getPropertyValue(p);
      if (v) styles[p] = v;
    }
    anchor.computedStyles = styles;
  }
  return anchor;
}

const query = queryDeep;

/**
 * Find an anchored element again: primary selector, then fallbacks, then an
 * element of the same tag whose text fingerprint matches.
 */
export function resolveAnchor(
  doc: Document,
  anchor: Pick<ElementAnchor, "selector"> &
    Partial<Pick<ElementAnchor, "fallbackSelectors" | "text" | "tagName">>,
): Element | null {
  for (const s of [anchor.selector, ...(anchor.fallbackSelectors ?? [])]) {
    const hit = query(doc, s);
    if (hit && (!anchor.text || fingerprintOf(hit) === anchor.text.fingerprint)) return hit;
  }
  if (anchor.text && anchor.tagName) {
    for (const el of Array.from(doc.getElementsByTagName(anchor.tagName))) {
      if (fingerprintOf(el) === anchor.text.fingerprint) return el;
    }
  }
  // Text changed but structure didn't: accept the primary selector anyway.
  return query(doc, anchor.selector);
}
