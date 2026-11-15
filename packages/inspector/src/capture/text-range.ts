import { createTextQuote, normalizeText, type TextQuote } from "@annotatekit/core";

const CONTEXT = 32;

/** A text node and an offset inside it. */
interface Point {
  node: Text;
  offset: number;
}

/**
 * The element's visible text with whitespace collapsed (as core's
 * `normalizeText` does), plus where each character came from in the DOM.
 */
interface TextIndex {
  text: string;
  points: Point[];
}

function textNodes(node: Node, out: Text[] = []): Text[] {
  if (node.nodeType === 3) out.push(node as Text);
  else if (node.nodeType === 1 || node.nodeType === 9 || node.nodeType === 11) {
    const tag = (node as Element).localName;
    if (tag !== "script" && tag !== "style" && tag !== "template") {
      for (let c = node.firstChild; c; c = c.nextSibling) textNodes(c, out);
    }
  }
  return out;
}

function indexText(root: Node): TextIndex {
  let text = "";
  const points: Point[] = [];
  let pendingSpace: Point | null = null;
  for (const node of textNodes(root)) {
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      const ch = data.charAt(i);
      if (/\s/.test(ch)) {
        if (text.length) pendingSpace ??= { node, offset: i };
        continue;
      }
      if (pendingSpace) {
        text += " ";
        points.push(pendingSpace);
        pendingSpace = null;
      }
      text += ch;
      points.push({ node, offset: i });
    }
  }
  return { text, points };
}

/** Where `range` starts and ends inside `root`'s normalised text. */
function rangeOffsets(root: Node, range: Range): { start: number; end: number } | null {
  const { points } = indexText(root);
  let start = -1;
  let end = -1;
  points.forEach((p, i) => {
    // A character is selected when its start point is in [range.start, range.end).
    const atEnd = p.node === range.endContainer && p.offset >= range.endOffset;
    if (range.comparePoint(p.node, p.offset) !== 0 || atEnd) return;
    if (start < 0) start = i;
    end = i + 1;
  });
  return start < 0 ? null : { start, end };
}

/**
 * Describe a selected range as a core `TextQuote` (exact text plus up to 32
 * characters of context on each side) relative to `root`.
 */
export function quoteFromRange(root: Node, range: Range): TextQuote | null {
  const selected = normalizeText(range.toString());
  if (!selected) return null;
  const offsets = rangeOffsets(root, range);
  if (!offsets) return createTextQuote(selected, { maxLength: 1000 });
  const { text } = indexText(root);
  // Use the indexed text so the quote matches what rangeFromQuote searches.
  const exact = text.slice(offsets.start, offsets.end);
  return createTextQuote(exact, {
    prefix: text.slice(Math.max(0, offsets.start - CONTEXT), offsets.start),
    suffix: text.slice(offsets.end, offsets.end + CONTEXT),
    maxLength: 1000,
  });
}

/**
 * Find a quote inside `root` again and return it as a DOM Range. Among several
 * matches, the one whose surrounding text best matches prefix and suffix wins.
 */
export function rangeFromQuote(
  root: Node,
  quote: Pick<TextQuote, "exact" | "prefix" | "suffix">,
): Range | null {
  const { text, points } = indexText(root);
  const truncated = quote.exact.endsWith("…");
  const needle = truncated ? quote.exact.slice(0, -1) : quote.exact;
  if (!needle) return null;
  let best = -1;
  let bestScore = -1;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    let score = 0;
    if (quote.prefix && text.slice(0, at).endsWith(quote.prefix)) score += 2;
    else if (quote.prefix && text.slice(0, at).trimEnd().endsWith(quote.prefix.trim())) score += 1;
    if (quote.suffix && text.slice(at + needle.length).startsWith(quote.suffix)) score += 2;
    else if (
      quote.suffix &&
      text
        .slice(at + needle.length)
        .trimStart()
        .startsWith(quote.suffix.trim())
    )
      score += 1;
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  if (best < 0) return null;
  const first = points[best];
  const last = points[best + needle.length - 1];
  if (!first || !last) return null;
  const doc = root.ownerDocument ?? (root as Document);
  const range = doc.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}
