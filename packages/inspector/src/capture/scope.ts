/**
 * Helpers for elements inside open shadow roots. A selector that crosses into a
 * shadow root is written as `host-selector >>> inner-selector`: match the host
 * in the outer scope, then the rest inside its shadow root.
 */
export const SCOPE_SEPARATOR = " >>> ";

/** A document or shadow root: where a selector is unique. */
export type Scope = Document | ShadowRoot;

const isShadowRoot = (node: Node): node is ShadowRoot =>
  node.nodeType === 11 && "host" in node && !!(node as ShadowRoot).host;

/** The document or shadow root an element lives in. */
export function scopeOf(el: Element): Scope {
  const root = el.getRootNode();
  return isShadowRoot(root) ? root : el.ownerDocument;
}

/** The shadow host when `el` sits inside a shadow root, otherwise null. */
export function hostOf(el: Element): Element | null {
  const root = el.getRootNode();
  return isShadowRoot(root) ? root.host : null;
}

/** The parent element, stepping out of a shadow root to its host. */
export function composedParent(el: Element): Element | null {
  return el.parentElement ?? hostOf(el);
}

/** Like `Node.contains`, but sees into shadow roots. */
export function composedContains(outer: Element, inner: Element): boolean {
  for (let n: Element | null = inner; n; n = composedParent(n)) if (n === outer) return true;
  return false;
}

/** Element children, plus the children of an open shadow root. */
export function composedChildren(el: Element): Element[] {
  const out = Array.from(el.children);
  if (el.shadowRoot) out.push(...Array.from(el.shadowRoot.children));
  return out;
}

/**
 * The innermost element at a viewport point, descending into open shadow
 * roots. `stop` is checked at every level, so an overlay host can be skipped.
 */
export function deepElementFromPoint(
  doc: Document,
  x: number,
  y: number,
  stop: (el: Element) => boolean = () => false,
): Element | null {
  let el = doc.elementFromPoint(x, y);
  while (el && !stop(el) && el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** `querySelector` that follows `>>>` into shadow roots. Invalid selectors give null. */
export function queryDeep(doc: Document, selector: string): Element | null {
  const parts = selector.split(SCOPE_SEPARATOR);
  let scope: Scope | null = doc;
  let hit: Element | null = null;
  for (const part of parts) {
    if (!scope) return null;
    try {
      hit = scope.querySelector(part);
    } catch {
      return null;
    }
    if (!hit) return null;
    scope = hit.shadowRoot;
  }
  return hit;
}
