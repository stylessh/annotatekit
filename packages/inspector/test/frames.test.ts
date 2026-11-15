// @vitest-environment happy-dom
// happy-dom doesn't set `window.frameElement`, so crossing *out* of a frame
// (selector generation) is covered by the Chromium e2e test instead.
import { afterEach, describe, expect, it } from "vitest";
import { frameDocuments, hostOf } from "../src/capture/scope.js";
import { queryDeep, resolveAnchor, uniqueSelector } from "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount() {
  document.body.innerHTML = `<main><iframe id="embed"></iframe></main>`;
  const frame = document.getElementById("embed") as HTMLIFrameElement;
  const inner = frame.contentDocument as Document;
  inner.body.innerHTML = `<section><button data-testid="pay">Pay</button></section>`;
  return { inner, button: inner.querySelector("button") as Element };
}

describe("same-origin iframes", () => {
  it("follows >>> into a frame's document", () => {
    const { button } = mount();
    const selector = '#embed >>> button[data-testid="pay"]';
    expect(queryDeep(document, selector)).toBe(button);
    expect(resolveAnchor(document, { selector })).toBe(button);
    expect(queryDeep(document, "#embed >>> .missing")).toBeNull();
  });

  it("lists framed documents", () => {
    const { inner } = mount();
    expect(frameDocuments(document)).toEqual([inner]);
  });

  it("stays inside the frame without a root document", () => {
    const { button } = mount();
    expect(hostOf(button)).toBeNull();
    expect(uniqueSelector(button)).toBe('button[data-testid="pay"]');
  });
});
