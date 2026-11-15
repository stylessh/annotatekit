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
export {
  createInspector,
  draftToRenderable,
  type InspectMode,
  type Inspector,
  type InspectorEvents,
  type InspectorOptions,
} from "./overlay/inspector.js";
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
