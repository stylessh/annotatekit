import type { Breakpoint } from "./types.js";

export interface BreakpointPreset {
  system: string;
  /** Breakpoint names mapped to their min-width in CSS pixels. */
  breakpoints: Record<string, number>;
}

export const tailwindBreakpoints: BreakpointPreset = {
  system: "tailwind",
  breakpoints: { base: 0, sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 },
};

export const bootstrapBreakpoints: BreakpointPreset = {
  system: "bootstrap",
  breakpoints: { xs: 0, sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1400 },
};

/**
 * Find the breakpoint that a viewport width falls into. Breakpoints are
 * min-width based (mobile first), like Tailwind and Bootstrap.
 */
export function resolveBreakpoint(
  width: number,
  preset: BreakpointPreset = tailwindBreakpoints,
): Breakpoint {
  const sorted = Object.entries(preset.breakpoints).sort((a, b) => a[1] - b[1]);
  const first = sorted[0];
  if (!first) throw new RangeError("Breakpoint preset has no breakpoints");

  let index = 0;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    if (entry && width >= entry[1]) index = i;
  }
  const [name, minWidth] = sorted[index] ?? first;
  const next = sorted[index + 1];
  const breakpoint: Breakpoint = { name, minWidth, system: preset.system };
  if (next) breakpoint.maxWidth = next[1];
  return breakpoint;
}
