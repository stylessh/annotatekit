/**
 * Helpers for elements inside open shadow roots and same-origin iframes. A
 * selector that crosses into one is written as `outer >>> inner`: match the
 * shadow host or iframe in the outer scope, then the rest inside its shadow
 * root or document.
 *
 * Crossing out of an iframe stops at `root`, the document the inspector runs
 * in, so a page that is itself framed (say, by Storybook) never gets selectors
 * that start in its parent.
 */
export const SCOPE_SEPARATOR = " >>> ";

/** A document or shadow root: where a selector is unique. */
export type Scope = Document | ShadowRoot;

interface Offset {
  x: number;
  y: number;
}

const isShadowRoot = (node: Node): node is ShadowRoot =>
  node.nodeType === 11 && "host" in node && !!(node as ShadowRoot).host;

/** The iframe element that holds `doc`, if its parent is same-origin. */
export function frameOf(doc: Document): Element | null {
  try {
    return doc.defaultView?.frameElement ?? null;
  } catch {
    return null;
  }
}

/** The document inside an iframe, when it is same-origin and loaded. */
export function frameDocument(el: Element): Document | null {
  if (el.localName !== "iframe" && el.localName !== "frame") return null;
  try {
    return (el as HTMLIFrameElement).contentDocument ?? null;
  } catch {
    return null;
  }
}

/** The document or shadow root an element lives in. */
export function scopeOf(el: Element): Scope {
  const root = el.getRootNode();
  return isShadowRoot(root) ? root : el.ownerDocument;
}

/**
 * The shadow host, or (inside an iframe below `root`) the iframe element, that
 * `el`'s scope hangs from. Null at the top.
 */
export function hostOf(el: Element, root?: Document): Element | null {
  const node = el.getRootNode();
  if (isShadowRoot(node)) return node.host;
  if (root && el.ownerDocument !== root) return frameOf(el.ownerDocument);
  return null;
}

/** The parent element, stepping out of a shadow root to its host (and out of frames below `root`). */
export function composedParent(el: Element, root?: Document): Element | null {
  return el.parentElement ?? hostOf(el, root);
}

/** Like `Node.contains`, but sees into shadow roots and frames below `root`. */
export function composedContains(outer: Element, inner: Element, root?: Document): boolean {
  for (let n: Element | null = inner; n; n = composedParent(n, root)) if (n === outer) return true;
  return false;
}

/** Element children, plus an open shadow root's children and a same-origin frame's root element. */
export function composedChildren(el: Element): Element[] {
  const out = Array.from(el.children);
  if (el.shadowRoot) out.push(...Array.from(el.shadowRoot.children));
  const frameDoc = frameDocument(el);
  if (frameDoc?.body) out.push(frameDoc.body);
  return out;
}

/** Where a frame's content box starts, in its own document's viewport. */
function contentOrigin(frame: Element): Offset {
  const r = frame.getBoundingClientRect();
  const view = frame.ownerDocument.defaultView;
  const cs = view?.getComputedStyle(frame);
  const pad = (side: string) =>
    Number.parseFloat(cs?.getPropertyValue(`padding-${side}`) ?? "") || 0;
  return { x: r.left + frame.clientLeft + pad("left"), y: r.top + frame.clientTop + pad("top") };
}

/** How far `doc`'s viewport is offset inside `root`'s viewport. Zero for `root` itself. */
export function frameOffset(doc: Document, root: Document): Offset {
  const off = { x: 0, y: 0 };
  for (let d = doc; d !== root; ) {
    const frame = frameOf(d);
    if (!frame) break;
    const o = contentOrigin(frame);
    off.x += o.x;
    off.y += o.y;
    d = frame.ownerDocument;
  }
  return off;
}

/** `getBoundingClientRect` in `root`'s viewport, even for elements inside iframes. */
export function clientRect(el: Element, root: Document = el.ownerDocument): DOMRect {
  const r = el.getBoundingClientRect();
  if (el.ownerDocument === root) return r;
  const off = frameOffset(el.ownerDocument, root);
  return new DOMRect(r.x + off.x, r.y + off.y, r.width, r.height);
}

/** Every same-origin document framed below `root`, at any depth. */
export function frameDocuments(root: Document): Document[] {
  const out: Document[] = [];
  const walk = (doc: Document) => {
    for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
      const inner = frameDocument(frame);
      if (inner && !out.includes(inner)) {
        out.push(inner);
        walk(inner);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * The innermost element at a point in `doc`'s viewport, descending into open
 * shadow roots and same-origin iframes. `stop` is checked at every level, so
 * an overlay host can be skipped.
 */
export function deepElementFromPoint(
  doc: Document,
  x: number,
  y: number,
  stop: (el: Element) => boolean = () => false,
): Element | null {
  let el = doc.elementFromPoint(x, y);
  let lx = x;
  let ly = y;
  while (el && !stop(el)) {
    let inner: Element | null = null;
    if (el.shadowRoot) {
      inner = el.shadowRoot.elementFromPoint(lx, ly);
    } else {
      const frameDoc = frameDocument(el);
      if (frameDoc) {
        const o = contentOrigin(el);
        lx -= o.x;
        ly -= o.y;
        inner = frameDoc.elementFromPoint(lx, ly);
      }
    }
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** `querySelector` that follows `>>>` into shadow roots and frames. Invalid selectors give null. */
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
    scope = hit.shadowRoot ?? frameDocument(hit);
  }
  return hit;
}
