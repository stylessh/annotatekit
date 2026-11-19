/**
 * The overlay's design tokens. Everything below is drawn from these, so a host
 * page can restyle the overlay by setting any `--ak-*` variable on the overlay
 * host element (`[data-annotatekit-overlay]`), or pass `accentColor`/`theme`.
 *
 * The look is flat: no shadows, no borders. Surfaces are solid; everything on
 * them (buttons, chips, inputs, messages) is a low-opacity fill of the
 * foreground color, so one accent and one surface color theme the whole UI.
 */
export const THEME_TOKENS = /* css */ `
:host {
  /* Brand */
  /* Neutral by default: near-black in light, near-white in dark. Pass
     accentColor (or set --ak-accent) for a brand color. */
  --ak-accent: #18181b;
  --ak-on-accent: #ffffff;

  /* Type */
  --ak-font: "AnnotateKit Instrument Sans", "Instrument Sans", ui-sans-serif, system-ui,
    -apple-system, "Segoe UI", Roboto, sans-serif;
  --ak-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --ak-text-xs: 11px;
  --ak-text-sm: 12.5px;
  --ak-text-md: 14px;
  --ak-text-lg: 16px;

  /* Shape and spacing */
  --ak-radius-pill: 999px;
  --ak-radius-lg: 24px;
  --ak-radius-md: 16px;
  --ak-radius-sm: 10px;
  --ak-space-1: 4px;
  --ak-space-2: 8px;
  --ak-space-3: 12px;
  --ak-space-4: 16px;
  --ak-panel-width: 380px;

  /* Motion: springs, so size and shape changes settle instead of snapping */
  --ak-ease-fluid: cubic-bezier(0.32, 0.72, 0, 1);
  --ak-ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  --ak-dur-morph: 520ms;
  --ak-dur-fast: 240ms;

  /* Light theme: plain grayscale */
  --ak-surface: #f4f4f5;
  --ak-fg: #18181b;
  --ak-fill-rgb: 24, 24, 27;

  /* Toolbar ("chrome"): near-black with translucent white icon buttons */
  --ak-chrome: #18181b;
  --ak-chrome-fg: #fafafa;
  --ak-chrome-fill: rgba(255, 255, 255, 0.14);
  --ak-chrome-fill-hover: rgba(255, 255, 255, 0.22);
  --ak-chrome-fill-active: rgba(255, 255, 255, 0.34);

  /* Status is shown by icon shape, so these stay neutral by default. Set
     them to colors if a host wants colored statuses. */
  --ak-status-open: var(--ak-fg);
  --ak-status-in-progress: var(--ak-fg);
  --ak-status-pending-review: var(--ak-fg);
  --ak-status-resolved: var(--ak-fg);
  --ak-status-dismissed: var(--ak-muted);
  --ak-danger: var(--ak-fg);
  --ak-resolved: #a1a1aa;

  /* Derived: every fill is the foreground at low opacity */
  --ak-fill-1: rgba(var(--ak-fill-rgb), 0.06);
  --ak-fill-2: rgba(var(--ak-fill-rgb), 0.1);
  --ak-fill-3: rgba(var(--ak-fill-rgb), 0.16);
  --ak-muted: color-mix(in srgb, var(--ak-fg) 58%, transparent);
  --ak-faint: color-mix(in srgb, var(--ak-fg) 38%, transparent);
  --ak-chip-mix: 14%;
  --ak-chip-text-mix: 72%;
}
`;

const DARK = /* css */ `
  --ak-accent: #fafafa;
  --ak-on-accent: #18181b;
  --ak-surface: #18181b;
  --ak-fg: #fafafa;
  --ak-fill-rgb: 255, 255, 255;
  --ak-chrome: #27272a;
  --ak-resolved: #52525b;
  --ak-chip-mix: 22%;
  --ak-chip-text-mix: 42%;
`;

/** The reference look: the whole UI on the saturated accent. */
const VIVID = /* css */ `
  --ak-surface: var(--ak-accent);
  --ak-fg: var(--ak-on-accent);
  --ak-chrome: color-mix(in srgb, var(--ak-accent) 82%, #000);
  --ak-fill-rgb: 255, 255, 255;
  --ak-fill-1: rgba(255, 255, 255, 0.1);
  --ak-fill-2: rgba(255, 255, 255, 0.16);
  --ak-fill-3: rgba(255, 255, 255, 0.24);
  --ak-chip-mix: 0%;
  --ak-chip-text-mix: 0%;
`;

export const OVERLAY_CSS = /* css */ `
${THEME_TOKENS}
@media (prefers-color-scheme: dark) {
  :host(:not([data-theme])), :host([data-theme="auto"]) {${DARK}}
}
:host([data-theme="dark"]) {${DARK}}
:host([data-theme="vivid"]) {${VIVID}}

:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483646;
  font: 400 var(--ak-text-md)/1.45 var(--ak-font);
  color: var(--ak-fg);
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "ss01";
}
/* Gallery mode: components flow in the page instead of floating over it. */
:host([data-static]) {
  position: relative;
  inset: auto;
  display: block;
  z-index: auto;
  pointer-events: auto;
}
:host([data-static]) :is(.toolbar, .panel, .composer, .label, .pin) {
  position: relative;
  inset: auto;
  margin: 0;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input, textarea, select { font: inherit; color: inherit; letter-spacing: inherit; }

/* ---- Page marks ------------------------------------------------------- */
.hl, .sel, .drag, .region {
  position: fixed;
  pointer-events: none;
  border-radius: 6px;
}
.hl {
  outline: 1.5px solid var(--ak-accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--ak-accent) 10%, transparent);
  transition: top .06s, left .06s, width .06s, height .06s;
}
.sel {
  outline: 1.5px dashed var(--ak-accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--ak-accent) 14%, transparent);
}
.drag, .region {
  outline: 1.5px dashed var(--ak-accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--ak-accent) 8%, transparent);
}
.mark {
  position: fixed;
  pointer-events: none;
  background: color-mix(in srgb, var(--ak-accent) 18%, transparent);
  border-bottom: 2px solid var(--ak-accent);
}
.mark[data-focused] { background: color-mix(in srgb, var(--ak-accent) 32%, transparent); }
.mark[data-closed] { background: transparent; border-bottom-color: var(--ak-resolved); }
.label {
  position: fixed;
  pointer-events: none;
  padding: 4px 10px;
  border-radius: var(--ak-radius-pill);
  background: var(--ak-accent);
  color: var(--ak-on-accent);
  font: 500 var(--ak-text-xs)/1.4 var(--ak-font-mono);
  white-space: nowrap;
  max-width: min(480px, calc(100vw - 16px));
  overflow: hidden;
  text-overflow: ellipsis;
}
.label .dim { opacity: .6; }

/* ---- Pins ------------------------------------------------------------- */
.pin {
  position: fixed;
  pointer-events: auto;
  width: 26px;
  height: 26px;
  margin: -26px 0 0 -2px;
  padding: 0;
  border: 0;
  border-radius: 13px 13px 13px 3px;
  background: var(--ak-pin, var(--ak-accent));
  color: var(--ak-on-accent);
  font: 600 var(--ak-text-xs)/26px var(--ak-font);
  text-align: center;
  cursor: pointer;
  transition: transform .12s, opacity .12s;
}
.pin:hover, .pin[aria-pressed="true"] { transform: scale(1.12); }
.pin[aria-pressed="true"] { outline: 3px solid color-mix(in srgb, var(--ak-pin, var(--ak-accent)) 30%, transparent); outline-offset: 2px; }
.pin[data-status="resolved"], .pin[data-status="dismissed"] { background: var(--ak-resolved); opacity: .75; }
.pin[data-status="in_progress"] { outline: 3px solid color-mix(in srgb, var(--ak-pin, var(--ak-accent)) 30%, transparent); outline-offset: 2px; }
.pin[data-status="pending_review"] { outline: 1.5px dashed var(--ak-pin, var(--ak-accent)); outline-offset: 3px; }
.pin[data-kind="region"] { border-radius: 7px; }
.pin[data-draft] { opacity: .7; }
.pin .count {
  position: absolute; top: -7px; right: -9px;
  min-width: 17px; height: 17px; padding: 0 4px;
  border-radius: var(--ak-radius-pill);
  background: var(--ak-surface); color: var(--ak-fg);
  font-size: 10px; line-height: 17px;
}
:is(.pin, button, a, [tabindex]):focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid var(--ak-accent);
  outline-offset: 2px;
}

/* ---- Buttons ---------------------------------------------------------- */
button.btn {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 14px;
  border: 0;
  border-radius: var(--ak-radius-pill);
  background: var(--ak-fill-2);
  color: var(--ak-fg);
  font: 500 var(--ak-text-sm)/1.2 var(--ak-font);
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s, opacity .12s;
}
button.btn:hover { background: var(--ak-fill-3); }
button.btn:disabled { opacity: .45; cursor: default; }
button.btn.ghost { background: transparent; }
button.btn.ghost:hover { background: var(--ak-fill-1); }
button.btn.primary { background: var(--ak-accent); color: var(--ak-on-accent); }
button.btn.primary:hover { background: color-mix(in srgb, var(--ak-accent) 86%, var(--ak-fg)); }
:host([data-theme="vivid"]) button.btn.primary { background: var(--ak-on-accent); color: var(--ak-accent); }
button.btn.danger { background: color-mix(in srgb, var(--ak-danger) 16%, transparent); color: var(--ak-danger); }
button.btn[aria-pressed="true"] { background: var(--ak-fill-3); }
button.btn.icon { width: 32px; padding: 0; font-size: 18px; line-height: 1; }
button.btn.icon svg { width: 16px; height: 16px; }

/* ---- Toolbar ----------------------------------------------------------
 * One pill that morphs: groups expand from zero width on a spring, icons
 * cross-fade through a blur, the mode highlight slides between buttons.
 */
.toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: var(--ak-radius-pill);
  background: var(--ak-chrome);
  color: var(--ak-chrome-fg);
  transition: transform var(--ak-dur-fast) var(--ak-ease-fluid);
}
.toolbar:active:not(:has(.bp:active)) { transform: scale(0.985); }
.toolbar button.btn.icon {
  position: relative;
  flex: none;
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ak-chrome-fg);
  transition: background var(--ak-dur-fast) var(--ak-ease-fluid);
}
.toolbar button.btn.icon + :is(button, .collapse, .bp) { margin-left: 2px; }
.toolbar svg {
  width: 16px;
  height: 16px;
  transition: transform var(--ak-dur-fast) var(--ak-ease-spring);
}
.toolbar button.btn:hover { background: var(--ak-chrome-fill); }
.toolbar button.btn:active svg { transform: scale(0.86); }
.toolbar button.btn[aria-pressed="true"] { background: var(--ak-chrome-fill-active); }

/* Annotate ⇄ done: both icons are stacked and morph into each other. */
.toolbar .swap { display: grid; place-items: center; }
.toolbar .swap > svg {
  grid-area: 1 / 1;
  transition:
    opacity var(--ak-dur-fast) var(--ak-ease-fluid),
    filter var(--ak-dur-fast) var(--ak-ease-fluid),
    transform var(--ak-dur-morph) var(--ak-ease-spring);
}
.toolbar [data-state="off"] .on,
.toolbar [data-state="on"] .off {
  opacity: 0;
  filter: blur(3px);
  transform: scale(0.4) rotate(-60deg);
}
.toolbar button.btn.icon[data-action="toggle"][aria-pressed="true"] {
  background: var(--ak-chrome-fg);
  color: var(--ak-chrome);
}

/* Expanding groups: a grid track animates from 0fr to 1fr, so the pill
   follows the content's real width with no measuring. */
.toolbar .collapse {
  display: grid;
  grid-template-columns: 0fr;
  opacity: 0;
  filter: blur(4px);
  transition:
    grid-template-columns var(--ak-dur-morph) var(--ak-ease-fluid),
    opacity var(--ak-dur-fast) var(--ak-ease-fluid),
    filter var(--ak-dur-fast) var(--ak-ease-fluid),
    margin var(--ak-dur-morph) var(--ak-ease-fluid);
}
.toolbar .collapse > * { min-width: 0; overflow: hidden; }
.toolbar .modes-wrap { margin: 0; }
.toolbar .modes-wrap[data-open] {
  grid-template-columns: 1fr;
  opacity: 1;
  filter: none;
  margin: 0 3px;
}
.toolbar .modes {
  position: relative;
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--ak-radius-pill);
  background: var(--ak-chrome-fill);
}
.toolbar .modes button.btn.icon { width: 24px; height: 24px; min-height: 24px; background: transparent; }
.toolbar .modes button.btn.icon:hover { background: transparent; opacity: 1; }
.toolbar .modes button.btn.icon:not([aria-pressed="true"]) { opacity: 0.6; }
.toolbar .modes button.btn.icon svg { width: 15px; height: 15px; }
.toolbar .modes button:focus-visible { outline-offset: -2px; }
.toolbar .indicator {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--ak-chrome-fill-active);
  transform: translateX(calc(var(--i, 0) * 26px));
  transition: transform var(--ak-dur-morph) var(--ak-ease-spring);
}

/* Threads: a count that pops in and out. */
.toolbar .badge {
  position: absolute;
  top: -1px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border-radius: var(--ak-radius-pill);
  background: var(--ak-chrome-fg);
  color: var(--ak-chrome);
  font: 600 9px/14px var(--ak-font);
  text-align: center;
  transform: scale(0);
  opacity: 0;
  transition:
    transform var(--ak-dur-morph) var(--ak-ease-spring),
    opacity var(--ak-dur-fast) var(--ak-ease-fluid);
}
.toolbar .badge[data-show] { transform: none; opacity: 1; }

/* Breakpoint: a device icon; the label slides out of it on hover or focus. */
.toolbar .bp {
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
  cursor: default;
  outline: 0;
}
.toolbar .bp .divider {
  width: 1px;
  height: 14px;
  margin: 0 3px 0 1px;
  background: currentColor;
  opacity: 0.2;
}
.toolbar .bp .pill {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 6px;
  border-radius: var(--ak-radius-pill);
  opacity: 0.55;
  transition:
    opacity var(--ak-dur-fast) var(--ak-ease-fluid),
    background var(--ak-dur-fast) var(--ak-ease-fluid);
}
.toolbar .bp .device { display: grid; place-items: center; }
.toolbar .bp:hover .pill, .toolbar .bp:focus-visible .pill { opacity: 1; background: var(--ak-chrome-fill); }
.toolbar .bp:focus-visible .pill { outline: 2px solid var(--ak-chrome-fg); outline-offset: -2px; }
.toolbar .bp:hover .bp-wrap, .toolbar .bp:focus-visible .bp-wrap {
  grid-template-columns: 1fr;
  opacity: 1;
  filter: none;
}
.toolbar .bp-text {
  display: block;
  padding-left: 6px;
  font: 500 var(--ak-text-xs)/1 var(--ak-font);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Panels and composers rise out of the toolbar instead of popping in. */
@keyframes ak-rise {
  from { opacity: 0; transform: translateY(10px) scale(0.96); filter: blur(6px); }
}
.panel:not([hidden]), .composer:not([hidden]) {
  transform-origin: 100% 100%;
  animation: ak-rise var(--ak-dur-morph) var(--ak-ease-fluid) both;
}
.composer:not([hidden]) { transform-origin: 0 0; animation-duration: 380ms; }
@media (prefers-reduced-motion: reduce) {
  .toolbar *, .toolbar, .panel, .composer { transition-duration: 0s !important; animation: none !important; }
}

/* ---- Chips ------------------------------------------------------------ */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 10px;
  border-radius: var(--ak-radius-pill);
  background: var(--ak-fill-2);
  color: var(--ak-fg);
  font: 500 var(--ak-text-xs)/1.5 var(--ak-font);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip.mono { font-family: var(--ak-font-mono); font-weight: 400; }
.chip.status { padding-left: 7px; color: color-mix(in srgb, var(--ak-status-open) 100%, transparent); }
.chip svg, .status-icon svg, .stat svg, .meta-item svg, .event-mark svg { flex: none; }
.chip.status svg { width: 13px; height: 13px; }
.chip.status[data-status="in_progress"] { color: var(--ak-status-in-progress); }
.chip.status[data-status="pending_review"] { color: var(--ak-status-pending-review); }
.chip.status[data-status="resolved"] { color: var(--ak-status-resolved); }
.chip.status[data-status="dismissed"] { color: var(--ak-status-dismissed); }
.status-icon { display: inline-grid; place-items: center; flex: none; color: var(--ak-status-open); }
.status-icon svg { width: 16px; height: 16px; }
.status-icon[data-status="in_progress"] { color: var(--ak-status-in-progress); }
.status-icon[data-status="pending_review"] { color: var(--ak-status-pending-review); }
.status-icon[data-status="resolved"] { color: var(--ak-status-resolved); }
.status-icon[data-status="dismissed"] { color: var(--ak-status-dismissed); }

/* ---- Panels -----------------------------------------------------------
 * Panels grow out of the toolbar. Height changes are animated by the panel
 * script (a FLIP on height), so switching views or adding a reply morphs the
 * panel instead of snapping it.
 */
.panel {
  position: fixed;
  right: 16px;
  bottom: 58px;
  width: min(var(--ak-panel-width), calc(100vw - 32px));
  max-height: min(560px, calc(100vh - 96px));
  overflow: auto;
  overscroll-behavior: contain;
  pointer-events: auto;
  padding: 6px;
  border-radius: 20px;
  background: var(--ak-surface);
  color: var(--ak-fg);
  transform-origin: 100% 100%;
}
.panel.threads { display: flex; flex-direction: column; overflow: hidden; }
.panel-head {
  display: flex; align-items: center; gap: 4px;
  min-height: 32px; padding: 0 0 0 10px;
  flex: none;
}
.panel-head strong { margin-right: auto; font-weight: 600; font-size: var(--ak-text-md); }
.panel-head .title {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 6px;
  font-weight: 600; font-size: var(--ak-text-sm);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.panel-head span.title { display: block; }
.panel-head .count {
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: var(--ak-radius-pill);
  background: var(--ak-fill-2); color: var(--ak-muted);
  font: 600 10px/18px var(--ak-font); text-align: center;
}
.panel-head button.btn.icon, .head-actions button.btn.icon { width: 28px; min-height: 28px; height: 28px; }
.panel-head button.btn.icon svg { width: 15px; height: 15px; }
.panel-head [data-action="back"] { margin-left: -8px; }
.panel.thread .panel-head { padding-left: 2px; }
.panel.thread .panel-head .status-icon { margin: 0 2px 0 -2px; }
.head-actions { display: flex; gap: 2px; flex: none; }
.head-actions button.btn.primary { background: var(--ak-accent); color: var(--ak-on-accent); }
.panel-head .all { color: var(--ak-muted); font-size: var(--ak-text-sm); }
.panel .dim { color: var(--ak-muted); font-size: var(--ak-text-sm); }
.panel code { font: var(--ak-text-sm)/1.4 var(--ak-font-mono); }
.panel .empty, .state { color: var(--ak-muted); margin: 4px 0 8px; }
.panel .error { color: var(--ak-danger); margin: 0 0 8px; }
.panel:not(.threads) .panel-head { margin-bottom: 6px; }

/* Where the note was left: quiet, one line, icons instead of labels. */
.thread-meta {
  display: flex; gap: 10px; align-items: center;
  min-width: 0; flex: none;
  padding: 0 10px 6px 12px;
  color: var(--ak-muted); font-size: var(--ak-text-xs);
}
.meta-item { display: inline-flex; align-items: center; gap: 4px; min-width: 0; white-space: nowrap; }
.meta-item svg { width: 12px; height: 12px; opacity: .8; }
.meta-item.mono { flex: 0 1 auto; font-family: var(--ak-font-mono); }
.meta-item.mono span { overflow: hidden; text-overflow: ellipsis; }
.meta-item:not(.mono) { flex: none; font-variant-numeric: tabular-nums; }
.thread-body {
  flex: 1 1 auto; min-height: 0;
  overflow: auto; overscroll-behavior: contain;
  padding: 4px 6px 4px;
  border-radius: 14px;
}
/* Scrolled content fades out at the edges instead of being cut. */
.thread-body[data-more-above] { -webkit-mask-image: linear-gradient(transparent, #000 20px); mask-image: linear-gradient(transparent, #000 20px); }
.thread-body[data-more-below] { -webkit-mask-image: linear-gradient(#000 calc(100% - 28px), transparent); mask-image: linear-gradient(#000 calc(100% - 28px), transparent); }
.thread-body[data-more-above][data-more-below] {
  -webkit-mask-image: linear-gradient(transparent, #000 20px, #000 calc(100% - 28px), transparent);
  mask-image: linear-gradient(transparent, #000 20px, #000 calc(100% - 28px), transparent);
}
.thread-foot { flex: none; padding: 4px 0 0; }

/* ---- Thread list ------------------------------------------------------ */
.thread-list {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 1px;
  overflow: auto; overscroll-behavior: contain; min-height: 0;
}
.thread-list button.item {
  all: unset;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  gap: 0 10px;
  align-items: center;
  width: 100%;
  padding: 7px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: background var(--ak-dur-fast) var(--ak-ease-fluid);
}
.thread-list button.item:hover { background: var(--ak-fill-1); }
.thread-list button.item:active { background: var(--ak-fill-2); }
.thread-list button.item:focus-visible { outline: 2px solid var(--ak-accent); outline-offset: -2px; }
.thread-list .num {
  grid-row: span 2; align-self: start; margin-top: 1px;
  width: 20px; height: 20px;
  border-radius: 10px 10px 10px 3px;
  background: var(--ak-accent); color: var(--ak-on-accent);
  font-size: 10px; font-weight: 600; line-height: 20px; text-align: center;
}
:host([data-theme="vivid"]) .thread-list .num { background: var(--ak-fill-3); }
.thread-list [data-closed] .num { background: var(--ak-fill-3); color: var(--ak-muted); }
.thread-list [data-closed] .item-title { color: var(--ak-muted); }
.thread-list .item-title { font-size: var(--ak-text-sm); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-list .item-side { display: inline-flex; align-items: center; gap: 8px; color: var(--ak-muted); }
.thread-list .item-side .status-icon svg { width: 15px; height: 15px; }
.stat { display: inline-flex; align-items: center; gap: 3px; font-size: var(--ak-text-xs); font-variant-numeric: tabular-nums; }
.stat svg { width: 13px; height: 13px; }
.thread-list .item-sub {
  grid-column: 2 / 4;
  display: flex; gap: 6px; min-width: 0;
  color: var(--ak-faint); font-size: var(--ak-text-xs);
}
.thread-list .item-sub .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-list .item-sub .who::after { content: "·"; margin-left: 6px; }

/* ---- Messages ---------------------------------------------------------
 * A feedback thread, not a chat: the note first, then replies and status
 * changes hang off one vertical line. No bubbles, small avatars.
 */
.messages { list-style: none; margin: 0; padding: 0; display: grid; }
.msg, .event { position: relative; display: grid; grid-template-columns: 20px minmax(0, 1fr); column-gap: 8px; }
.msg { row-gap: 2px; padding: 6px 4px 8px; }
.msg .avatar { grid-row: 1; align-self: center; }
.msg-head { grid-column: 2; display: flex; align-items: baseline; gap: 6px; min-width: 0; line-height: 20px; }
.msg-head .name { font-weight: 600; font-size: var(--ak-text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg-head time { color: var(--ak-faint); font-size: var(--ak-text-xs); white-space: nowrap; font-variant-numeric: tabular-nums; }
.agent-tag { display: inline-grid; place-items: center; align-self: center; color: var(--ak-muted); }
.agent-tag svg { width: 12px; height: 12px; }
.msg-body { grid-column: 2; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--ak-text-sm); line-height: 1.5; }
.msg.note .msg-body { font-size: var(--ak-text-md); line-height: 1.45; }
.msg-body:empty { display: none; }
.msg .attachments { grid-column: 2; margin-top: 4px; }
/* The note is set apart from the replies by a hairline. */
.msg.note { padding-bottom: 12px; margin-bottom: 4px; }
.msg.note:not(:last-child)::after {
  content: ""; position: absolute; left: 4px; right: 4px; bottom: 0;
  height: 1px; background: var(--ak-fill-2);
}
/* The timeline: one rail runs through the replies' avatars and event marks. */
.messages > :is(.reply, .event)::before {
  content: ""; position: absolute; left: 13.5px; top: 0; bottom: 0;
  width: 1px; background: var(--ak-fill-2);
}
.messages > .note + :is(.reply, .event)::before { top: 14px; }
.messages > :is(.reply, .event):last-child::before { bottom: calc(100% - 14px); }
.messages > .note + :is(.reply, .event):last-child::before { display: none; }
.msg .avatar, .event-mark { position: relative; z-index: 1; }
.event { align-items: center; padding: 4px 4px; color: var(--ak-muted); font-size: var(--ak-text-xs); }
.event-mark { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--ak-surface); }
.event-mark svg { width: 13px; height: 13px; }
.event-text { display: flex; gap: 6px; min-width: 0; }
.event { grid-template-columns: 20px minmax(0, 1fr) auto; }
.event time { color: var(--ak-faint); white-space: nowrap; padding-left: 8px; }
.msg-head time::before { content: "·"; margin-right: 6px; }

.avatar {
  position: relative;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: var(--ak-fill-2);
  color: var(--ak-fg);
  font-size: 8.5px; font-weight: 600; line-height: 20px; text-align: center; letter-spacing: .02em;
  flex: none;
}
/* Solid, so the timeline rail passes behind it. */
.avatar { background: color-mix(in srgb, var(--ak-fg) 10%, var(--ak-surface)); }
.avatar[data-kind="agent"] { border-radius: 6px; background: color-mix(in srgb, var(--ak-fg) 18%, var(--ak-surface)); }
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: inherit; }

/* New entries settle in instead of appearing. */
@keyframes ak-enter {
  from { opacity: 0; transform: translateY(6px); filter: blur(4px); }
}
.messages > [data-new] { animation: ak-enter var(--ak-dur-morph) var(--ak-ease-fluid) both; }

/* ---- Attachments ------------------------------------------------------ */
.attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.attachment {
  position: relative;
  display: inline-flex; align-items: center; gap: 8px;
  max-width: 100%;
  border-radius: var(--ak-radius-sm);
  background: var(--ak-fill-2);
  color: inherit; text-decoration: none;
  font-size: var(--ak-text-xs);
  overflow: hidden;
}
a.attachment:hover { background: var(--ak-fill-3); }
.attachment.image { width: 104px; height: 78px; padding: 0; }
.attachment.image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.attachments.single .attachment.image { width: auto; max-width: 100%; height: auto; max-height: 168px; }
.attachments.single .attachment.image img { width: auto; max-width: 100%; height: auto; max-height: 168px; }
.attachment.file { padding: 6px 10px 6px 6px; min-height: 40px; }
.attachment .file-icon {
  width: 28px; height: 28px; border-radius: 8px; flex: none;
  background: var(--ak-fill-2);
  display: grid; place-items: center;
  font: 600 9px/1 var(--ak-font); letter-spacing: .02em; text-transform: uppercase;
}
.attachment .file-text { display: grid; min-width: 0; }
.attachment .file-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.attachment .file-size { color: var(--ak-muted); }
.attachment .remove {
  position: absolute; top: 4px; right: 4px;
  width: 20px; height: 20px; min-height: 0; padding: 0;
  border: 0; border-radius: 50%;
  background: rgba(0, 0, 0, .55); color: #fff;
  font-size: 13px; line-height: 20px; cursor: pointer;
}
.attachment.file .remove { position: static; margin-left: 2px; background: var(--ak-fill-2); color: var(--ak-fg); }
.attachment[data-uploading]::after {
  content: ""; position: absolute; inset: 0;
  background: color-mix(in srgb, var(--ak-surface) 55%, transparent);
  animation: ak-pulse 1.2s ease-in-out infinite;
}

/* ---- Composers -------------------------------------------------------- */
.composer {
  position: fixed;
  pointer-events: auto;
  width: 320px;
  padding: var(--ak-space-3);
  border-radius: var(--ak-radius-lg);
  background: var(--ak-surface);
  color: var(--ak-fg);
  display: grid;
  gap: var(--ak-space-2);
}
.composer .meta { display: flex; gap: 6px; min-width: 0; }
.field {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--ak-radius-md);
  background: var(--ak-fill-1);
}
.field:focus-within { background: var(--ak-fill-2); }
.field textarea {
  display: block; width: 100%; min-height: 56px; max-height: 200px; resize: none;
  padding: 0; border: 0; outline: 0; background: transparent;
  font-size: var(--ak-text-md); line-height: 1.45;
}
.field textarea::placeholder { color: var(--ak-faint); }
.field textarea:focus-visible { outline: 0; }
/* Reply: one pill; the text grows it, icon buttons sit inside on the right. */
form.reply .field {
  gap: 6px;
  padding: 4px 4px 4px 14px;
  border-radius: 18px;
}
form.reply .line { display: flex; align-items: flex-end; gap: 2px; }
form.reply .field textarea {
  flex: 1; min-height: 28px; max-height: 160px;
  padding: 4px 0; font-size: var(--ak-text-sm); line-height: 20px;
  transition: height var(--ak-dur-fast) var(--ak-ease-fluid);
}
form.reply button.btn.icon { width: 28px; height: 28px; min-height: 28px; flex: none; }
form.reply button.btn.icon svg { width: 15px; height: 15px; }
form.reply .send { transition: opacity var(--ak-dur-fast) var(--ak-ease-fluid), transform var(--ak-dur-fast) var(--ak-ease-spring); }
form.reply .send:disabled { opacity: .35; }
form.reply .tray { padding-top: 6px; }
form.reply .form-error { padding: 4px 14px 0; }
.row { display: flex; gap: 6px; align-items: center; }
.row .hint { margin-right: auto; color: var(--ak-faint); font-size: var(--ak-text-xs); }
.row .spacer { margin-right: auto; }
.row .slot { display: contents; }
.file-input { display: none; }
.drop-hint { color: var(--ak-muted); font-size: var(--ak-text-xs); }
.form-error { color: var(--ak-danger); font-size: var(--ak-text-xs); margin: 0; }
.form-error:empty { display: none; }

/* ---- States ----------------------------------------------------------- */
.state {
  display: grid; justify-items: center; gap: 8px;
  padding: 28px 16px; margin: 0;
  text-align: center;
}
.state .glyph {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--ak-fill-2);
  display: grid; place-items: center;
  color: var(--ak-fg);
}
.state .glyph svg { width: 20px; height: 20px; }
.state strong { color: var(--ak-fg); font-weight: 600; }
.state p { margin: 0; max-width: 260px; font-size: var(--ak-text-sm); }
.skeleton { display: grid; gap: var(--ak-space-2); }
.skeleton { padding: 4px 6px; }
.skeleton .bone {
  height: 44px; border-radius: 12px;
  background: var(--ak-fill-1);
  animation: ak-pulse 1.4s ease-in-out infinite;
}
.skeleton .bone.short { height: 28px; width: 72%; margin-left: 28px; }
.skeleton .bone.line { height: 14px; width: 45%; border-radius: var(--ak-radius-pill); }
@keyframes ak-pulse { 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) {
  .skeleton .bone, .attachment[data-uploading]::after { animation: none; }
  .pin, .hl { transition: none; }
}

/* ---- Agent keys panel --------------------------------------------------- */
.key-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.key-list li { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: var(--ak-radius-md); background: var(--ak-fill-1); }
.key-list li[data-inactive] { opacity: .55; }
.key-list .info { flex: 1; min-width: 0; }
.key-list .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.reveal {
  margin-bottom: 10px; padding: 12px; border-radius: var(--ak-radius-md);
  background: color-mix(in srgb, var(--ak-accent) 14%, transparent);
}
:host([data-theme="vivid"]) .reveal { background: var(--ak-fill-2); }
.reveal p { margin: 0 0 6px; }
.reveal .key { display: block; margin-bottom: 8px; word-break: break-all; user-select: all; }
.new-key { margin-top: 10px; display: grid; gap: 8px; }
.new-key input[type="text"], .new-key select {
  width: 100%; min-height: 36px; padding: 6px 12px;
  border: 0; border-radius: var(--ak-radius-pill);
  background: var(--ak-fill-1);
}
.new-key select { width: auto; flex: 1; }
.new-key select option { color: #14142b; }
.new-key .scopes { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: var(--ak-text-sm); }
.new-key .scopes input { accent-color: var(--ak-accent); }
.new-key .row { display: flex; gap: 8px; align-items: center; }
`;
