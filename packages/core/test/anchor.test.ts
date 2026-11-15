import { describe, expect, it } from "vitest";
import {
  bootstrapBreakpoints,
  createTextQuote,
  fingerprintText,
  normalizeText,
  resolveBreakpoint,
} from "../src/index.js";

describe("text fingerprint", () => {
  it("normalises whitespace before hashing", () => {
    expect(normalizeText("  Buy\n   now  ")).toBe("Buy now");
    expect(fingerprintText("Buy now")).toBe(fingerprintText("  Buy\n\tnow "));
    expect(fingerprintText("Buy now")).not.toBe(fingerprintText("Buy later"));
    expect(fingerprintText("Buy now")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("builds a trimmed quote with context", () => {
    const quote = createTextQuote("x".repeat(400), {
      prefix: `${"p".repeat(50)} before`,
      suffix: "after  everything else that follows",
      maxLength: 10,
      contextLength: 8,
    });
    expect(quote.exact).toBe(`${"x".repeat(9)}…`);
    expect(quote.prefix).toBe("p before");
    expect(quote.suffix).toBe("after ev");
    expect(quote.fingerprint).toBe(fingerprintText(quote.exact));
    expect(createTextQuote("hi")).not.toHaveProperty("prefix");
  });
});

describe("resolveBreakpoint", () => {
  it("uses Tailwind breakpoints by default", () => {
    expect(resolveBreakpoint(375)).toEqual({
      name: "base",
      minWidth: 0,
      maxWidth: 640,
      system: "tailwind",
    });
    expect(resolveBreakpoint(768)).toMatchObject({ name: "md", minWidth: 768, maxWidth: 1024 });
    expect(resolveBreakpoint(1919)).toEqual({ name: "2xl", minWidth: 1536, system: "tailwind" });
  });

  it("supports other presets", () => {
    expect(resolveBreakpoint(1000, bootstrapBreakpoints)).toMatchObject({
      name: "lg",
      system: "bootstrap",
    });
    expect(() => resolveBreakpoint(100, { system: "x", breakpoints: {} })).toThrow(RangeError);
  });
});
