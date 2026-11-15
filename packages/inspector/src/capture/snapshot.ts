import {
  type BreakpointPreset,
  type CaptureContext,
  type PageContext,
  tailwindBreakpoints,
} from "@annotatekit/core";
import type { CssDetail, CssSystemName, ElementSnapshot } from "../types.js";
import { type BreakpointState, detectBreakpoint } from "./breakpoint.js";
import {
  buildStyleIndex,
  cssDetailFor,
  detectPageCssSystems,
  type StyleIndex,
} from "./css-system.js";
import { anchorFor, DEFAULT_IDENTIFYING_ATTRIBUTES, isFixed } from "./selector.js";

export const CAPTURED_STYLES = [
  "display",
  "position",
  "box-sizing",
  "width",
  "height",
  "margin",
  "padding",
  "gap",
  "flex-direction",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "color",
  "background-color",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "z-index",
  "overflow",
] as const;

export interface CaptureOptions {
  /** Breakpoint preset used to name the current breakpoint. Defaults to Tailwind's. */
  breakpoints?: BreakpointPreset;
  /** Attributes that identify elements, preferred in selectors. */
  identifyingAttributes?: readonly string[];
  /** Computed style properties recorded on each anchor. */
  styles?: readonly string[];
}

/**
 * Captures element snapshots and page context. Holds a stylesheet index that
 * is built lazily; call {@link Capturer.invalidate} after styles change.
 */
export class Capturer {
  readonly preset: BreakpointPreset;
  private index: StyleIndex | null = null;
  private pageSystems: CssSystemName[] | null = null;
  private readonly identifying: readonly string[];
  private readonly styles: readonly string[];

  constructor(
    private readonly doc: Document = document,
    opts: CaptureOptions = {},
  ) {
    this.preset = opts.breakpoints ?? tailwindBreakpoints;
    this.identifying = opts.identifyingAttributes ?? DEFAULT_IDENTIFYING_ATTRIBUTES;
    this.styles = opts.styles ?? CAPTURED_STYLES;
  }

  invalidate(): void {
    this.index = null;
    this.pageSystems = null;
  }

  private ensure(): { index: StyleIndex; pageSystems: CssSystemName[] } {
    this.index ??= buildStyleIndex(this.doc);
    this.pageSystems ??= detectPageCssSystems(this.doc, this.index);
    return { index: this.index, pageSystems: this.pageSystems };
  }

  breakpoint(): BreakpointState {
    return detectBreakpoint(this.preset, this.doc.defaultView ?? window);
  }

  element(el: Element): ElementSnapshot {
    const { index, pageSystems } = this.ensure();
    return {
      anchor: anchorFor(el, {
        identifyingAttributes: this.identifying,
        styles: this.styles,
        root: this.doc,
      }),
      fixed: isFixed(el, this.doc),
      css: cssDetailFor(el, {
        index,
        breakpoints: this.preset.breakpoints,
        media: this.breakpoint().media,
        pageSystems,
      }),
    };
  }

  page(): PageContext {
    const loc = (this.doc.defaultView ?? window).location;
    const page: PageContext = { url: loc.href, origin: loc.origin, pathname: loc.pathname };
    if (this.doc.title) page.title = this.doc.title;
    return page;
  }

  /** Core's `CaptureContext` for an annotation on `primary`, with everything else in `extra`. */
  context(primary: ElementSnapshot | undefined, targets: ElementSnapshot[] = []): CaptureContext {
    const { pageSystems } = this.ensure();
    const state = this.breakpoint();
    const win = this.doc.defaultView ?? window;
    const detail: CssDetail | undefined = primary?.css;
    const systems = mergeSystems(detail?.systems ?? [], pageSystems);
    const ctx: CaptureContext = {
      viewport: state.viewport,
      breakpoint: state.breakpoint,
      cssSystem: { systems },
      colorScheme: state.media.colorScheme,
      userAgent: win.navigator.userAgent,
      extra: {
        inspector: {
          media: state.media,
          scroll: { x: win.scrollX, y: win.scrollY },
          pageCssSystems: pageSystems,
          tailwind: detail?.tailwind,
          variables: detail?.variables,
          targetCount: targets.length,
        },
      },
    };
    if (ctx.cssSystem && detail) {
      const utilities = detail.tailwind
        ? Object.values(detail.tailwind.byVariant).flat()
        : undefined;
      if (utilities?.length) ctx.cssSystem.utilityClasses = utilities;
      if (detail.variables.length) {
        ctx.cssSystem.variables = Object.fromEntries(
          detail.variables.map((v) => [v.name, v.value]),
        );
      }
    }
    return ctx;
  }
}

function mergeSystems(element: CssSystemName[], page: CssSystemName[]): CssSystemName[] {
  const out = [...element, ...page].filter((s, i, a) => a.indexOf(s) === i);
  return out.length > 1 ? out.filter((s) => s !== "plain") : out;
}
