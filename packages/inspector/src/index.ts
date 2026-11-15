export {
  type BreakpointState,
  detectBreakpoint,
  detectBreakpointsFromStylesheets,
} from "./capture/breakpoint.js";
export {
  buildStyleIndex,
  cssDetailFor,
  detectPageCssSystems,
  elementVariables,
  isTailwindUtility,
  parseDeclarations,
  type StyleIndex,
  splitVariants,
  tailwindInfo,
} from "./capture/css-system.js";
export { deepElementFromPoint, queryDeep, SCOPE_SEPARATOR } from "./capture/scope.js";
export {
  type AnchorOptions,
  anchorFor,
  DEFAULT_IDENTIFYING_ATTRIBUTES,
  documentRect,
  elementPath,
  isFixed,
  isUnstableClass,
  resolveAnchor,
  structuralSelector,
  uniqueSelector,
  xpathFor,
} from "./capture/selector.js";
export { CAPTURED_STYLES, type CaptureOptions, Capturer } from "./capture/snapshot.js";
export { quoteFromRange, rangeFromQuote } from "./capture/text-range.js";
export { loadOverlayFont, OVERLAY_FONT_FAMILY } from "./overlay/font.js";
export {
  createInspector,
  draftToRenderable,
  type InspectMode,
  type Inspector,
  type InspectorEvents,
  type InspectorOptions,
} from "./overlay/inspector.js";
export { createKeysPanel, type KeysPanel } from "./overlay/keys-panel.js";
export { OVERLAY_CSS, THEME_TOKENS } from "./overlay/styles.js";
export {
  bindFileField,
  createThreadsPanel,
  type ThreadAction,
  type ThreadSource,
  type ThreadsPanel,
  type ThreadsPanelOptions,
} from "./overlay/threads.js";
/** DOM builders for every overlay component, for custom UIs and the UI playground. */
export * as ui from "./overlay/ui.js";
export {
  type BindServiceOptions,
  type BindStorageOptions,
  bindService,
  bindStorage,
  type DraftToThreadOptions,
  draftToThreadInput,
  type InspectorAnnotationMetadata,
  type ServiceBinding,
  toRenderable,
} from "./storage.js";
export type * from "./types.js";
