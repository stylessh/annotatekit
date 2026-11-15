// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { composedContains, composedParent, queryDeep } from "../src/capture/scope.js";
import { anchorFor, resolveAnchor, structuralSelector, uniqueSelector } from "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount() {
  document.body.innerHTML = `<main><x-card id="plan"></x-card><x-card></x-card></main>`;
  const cards = document.querySelectorAll("x-card");
  for (const card of Array.from(cards)) {
    const root = card.attachShadow({ mode: "open" });
    root.innerHTML = `<div class="body"><span>Price</span><button class="buy">Buy</button></div>`;
  }
  const second = cards[1] as Element;
  const button = second.shadowRoot?.querySelector("button") as Element;
  return { first: cards[0] as Element, second, button };
}

describe("shadow roots", () => {
  it("writes selectors that enter the shadow root with >>>", () => {
    const { button } = mount();
    const sel = uniqueSelector(button);
    expect(sel).toBe("x-card:nth-of-type(2) >>> button.buy");
    expect(queryDeep(document, sel)).toBe(button);
    expect(queryDeep(document, structuralSelector(button))).toBe(button);
  });

  it("uses the host's id when it has one", () => {
    const { first } = mount();
    const inner = first.shadowRoot?.querySelector("span") as Element;
    expect(uniqueSelector(inner)).toBe("#plan >>> span");
  });

  it("anchors without an xpath and resolves again", () => {
    const { button } = mount();
    const anchor = anchorFor(button);
    expect(anchor.xpath).toBeUndefined();
    expect(anchor.selector).toContain(" >>> ");
    expect(resolveAnchor(document, anchor)).toBe(button);
  });

  it("walks out through the host", () => {
    const { second, button } = mount();
    const body = composedParent(button);
    expect(body?.className).toBe("body");
    expect(composedParent(body as Element)).toBe(second);
    expect(composedContains(document.querySelector("main") as Element, button)).toBe(true);
  });

  it("returns null for missing or invalid parts", () => {
    mount();
    expect(queryDeep(document, "main >>> button")).toBeNull();
    expect(queryDeep(document, "#plan >>> [[")).toBeNull();
  });
});
