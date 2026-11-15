import type {
  AnnotationKind,
  CaptureContext,
  CssSystemName,
  ElementAnchor,
  PageContext,
  Point,
  Rect,
  ThreadStatus,
} from "@annotatekit/core";

export type { CssSystemName, ElementAnchor, Point, Rect };

/** A CSS custom property referenced by a rule that matches the element. */
export interface CssVariableUsage {
  name: string;
  /** Resolved value on the element. */
  value: string;
  /** The property that references the variable, when known. */
  property?: string;
}

/**
 * The inspector's detailed view of how an element is styled. It is richer than
 * core's `CssSystemInfo`; {@link toCaptureContext} folds it into that shape.
 */
export interface CssDetail {
  /** Systems detected on this element, most confident first. */
  systems: CssSystemName[];
  tailwind?: {
    /** Utility classes on the element, grouped by variant prefix ("" = base). */
    byVariant: Record<string, string[]>;
    /** Utilities whose variants apply right now (current breakpoint, color scheme). */
    active: string[];
  };
  variables: CssVariableUsage[];
}

/** An element plus the styling context that matters to someone fixing it. */
export interface ElementSnapshot {
  anchor: ElementAnchor;
  /** Whether the element (or an ancestor) is `position: fixed` or `sticky`. */
  fixed: boolean;
  css: CssDetail;
}

/** Media state at capture time, beyond what core's `Breakpoint` holds. */
export interface MediaState {
  /** Every named breakpoint whose min-width currently matches, ascending. */
  matched: string[];
  orientation: "portrait" | "landscape";
  colorScheme: "light" | "dark";
  reducedMotion: boolean;
  pointer: "fine" | "coarse" | "none";
}

/**
 * What the inspector emits when the user saves an annotation. It maps 1:1 onto
 * a core `Annotation` (minus ids and authorship) plus the first comment;
 * {@link draftToRecords} does that mapping.
 */
export interface AnnotationDraft {
  kind: AnnotationKind;
  comment: string;
  /** The element the annotation hangs off. For regions, the targets' closest common ancestor. */
  anchor: ElementAnchor;
  /** Pin location inside the anchor element, 0..1. */
  position?: Point;
  /** Region in document coordinates (or viewport coordinates when `fixed`). */
  region?: Rect;
  /** Everything picked: the pinned element, the elements inside a box, or a multi-selection. */
  targets: ElementSnapshot[];
  /** True when the anchor scrolls with the viewport rather than the document. */
  fixed: boolean;
  context: CaptureContext;
  page: PageContext;
}

/** What the overlay needs to draw an existing annotation as a pin. */
export interface RenderableAnnotation {
  /** Usually the thread id: it's what `select` events report back. */
  id: string;
  kind: AnnotationKind;
  anchor: Pick<ElementAnchor, "selector" | "rect"> &
    Partial<Pick<ElementAnchor, "fallbackSelectors" | "text" | "tagName" | "scroll">>;
  position?: Point;
  region?: Rect;
  /** Extra outlined elements (multi-selections), as selectors. */
  targets?: string[];
  fixed?: boolean;
  status?: ThreadStatus;
  /** Text inside the pin. Defaults to its 1-based index. */
  label?: string;
  /** Pins sharing a group id are tinted with `color`. */
  groupId?: string;
  color?: string;
}
