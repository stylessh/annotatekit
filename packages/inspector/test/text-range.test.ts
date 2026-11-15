// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { quoteFromRange, rangeFromQuote } from "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function select(root: Element, needle: string, nth = 0): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    let at = text.data.indexOf(needle);
    while (at >= 0) {
      if (seen++ === nth) {
        const r = document.createRange();
        r.setStart(text, at);
        r.setEnd(text, at + needle.length);
        return r;
      }
      at = text.data.indexOf(needle, at + 1);
    }
  }
  throw new Error(`not found: ${needle}`);
}

describe("text quotes", () => {
  it("captures exact text with context and finds it again", () => {
    document.body.innerHTML = `<p id="p">The quick   brown <b>fox</b> jumps over the lazy dog.</p>`;
    const p = document.getElementById("p") as Element;
    const range = document.createRange();
    const b = p.querySelector("b") as Element;
    range.setStart(p.firstChild as Text, 4);
    range.setEnd(b.firstChild as Text, 3);
    const quote = quoteFromRange(p, range);
    expect(quote).toMatchObject({ exact: "quick brown fox", prefix: "The" });
    expect(quote?.suffix.startsWith("jumps")).toBe(true);

    const found = rangeFromQuote(p, quote as NonNullable<typeof quote>);
    expect(found?.toString().replace(/\s+/g, " ")).toBe("quick brown fox");
  });

  it("uses prefix and suffix to pick among repeated matches", () => {
    document.body.innerHTML = `<p id="p">alpha beta gamma. delta beta epsilon.</p>`;
    const p = document.getElementById("p") as Element;
    const quote = quoteFromRange(p, select(p, "beta", 1));
    expect(quote?.prefix.endsWith("delta")).toBe(true);
    const found = rangeFromQuote(p, quote as NonNullable<typeof quote>);
    expect(found?.startOffset).toBe("alpha beta gamma. delta ".length);
  });

  it("returns null when the text is gone", () => {
    document.body.innerHTML = `<p id="p">nothing here</p>`;
    const p = document.getElementById("p") as Element;
    expect(rangeFromQuote(p, { exact: "missing", prefix: "", suffix: "" })).toBeNull();
  });
});
