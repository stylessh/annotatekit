export const OVERLAY_CSS = /* css */ `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483646;
  --ak-accent: #3b82f6;
  --ak-accent-fg: #fff;
  --ak-surface: #ffffff;
  --ak-fg: #0f172a;
  --ak-muted: #64748b;
  --ak-border: rgba(15, 23, 42, 0.12);
  --ak-shadow: 0 8px 28px rgba(15, 23, 42, 0.18), 0 1px 3px rgba(15, 23, 42, 0.12);
  --ak-resolved: #94a3b8;
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ak-fg);
}
@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])) {
    --ak-surface: #18181b;
    --ak-fg: #f4f4f5;
    --ak-muted: #a1a1aa;
    --ak-border: rgba(255, 255, 255, 0.12);
    --ak-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
  }
}
:host([data-theme="dark"]) {
  --ak-surface: #18181b;
  --ak-fg: #f4f4f5;
  --ak-muted: #a1a1aa;
  --ak-border: rgba(255, 255, 255, 0.12);
  --ak-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }

.hl, .sel, .drag, .region {
  position: fixed;
  pointer-events: none;
  border-radius: 2px;
}
.hl {
  outline: 2px solid var(--ak-accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--ak-accent) 10%, transparent);
  transition: top .06s, left .06s, width .06s, height .06s;
}
.sel {
  outline: 2px dashed var(--ak-accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--ak-accent) 14%, transparent);
}
.drag {
  border: 1.5px dashed var(--ak-accent);
  background: color-mix(in srgb, var(--ak-accent) 8%, transparent);
}
.region {
  border: 1.5px dashed var(--ak-accent);
  background: color-mix(in srgb, var(--ak-accent) 6%, transparent);
}
.label {
  position: fixed;
  pointer-events: none;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--ak-fg);
  color: var(--ak-surface);
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  max-width: min(480px, calc(100vw - 16px));
  overflow: hidden;
  text-overflow: ellipsis;
}
.label .dim { opacity: .65; }

.pin {
  position: fixed;
  pointer-events: auto;
  width: 24px;
  height: 24px;
  margin: -24px 0 0 -2px;
  border: 0;
  border-radius: 12px 12px 12px 2px;
  background: var(--ak-pin, var(--ak-accent));
  color: var(--ak-accent-fg);
  font: 600 11px/24px ui-sans-serif, system-ui, sans-serif;
  text-align: center;
  cursor: pointer;
  box-shadow: var(--ak-shadow);
  transition: transform .12s;
  padding: 0;
}
.pin:hover, .pin[aria-pressed="true"] { transform: scale(1.12); }
.pin[data-status="resolved"], .pin[data-status="dismissed"] { background: var(--ak-resolved); }
.pin[data-status="in_progress"] { box-shadow: var(--ak-shadow), 0 0 0 3px color-mix(in srgb, var(--ak-pin, var(--ak-accent)) 35%, transparent); }
.pin[data-status="pending_review"] { outline: 2px dashed var(--ak-pin, var(--ak-accent)); outline-offset: 2px; }
.pin[data-kind="region"] { border-radius: 4px; }
.pin[data-draft] { opacity: .85; }
.pin .count {
  position: absolute; top: -6px; right: -8px;
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--ak-surface); color: var(--ak-fg);
  font-size: 10px; line-height: 16px; box-shadow: 0 0 0 1px var(--ak-border);
}
.pin:focus-visible, button:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--ak-accent);
  outline-offset: 2px;
}

.composer {
  position: fixed;
  pointer-events: auto;
  width: 300px;
  padding: 10px;
  border-radius: 10px;
  background: var(--ak-surface);
  color: var(--ak-fg);
  border: 1px solid var(--ak-border);
  box-shadow: var(--ak-shadow);
}
.composer .meta {
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ak-muted);
  margin-bottom: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.composer textarea {
  display: block; width: 100%; min-height: 64px; resize: vertical;
  padding: 7px 8px; border-radius: 6px; border: 1px solid var(--ak-border);
  background: transparent; color: inherit; font: inherit;
}
.composer .row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; align-items: center; }
.composer .hint { margin-right: auto; color: var(--ak-muted); font-size: 11px; }

button.btn {
  pointer-events: auto;
  border: 1px solid var(--ak-border);
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
button.btn.primary { background: var(--ak-accent); color: var(--ak-accent-fg); border-color: transparent; }
button.btn[aria-pressed="true"] { background: color-mix(in srgb, var(--ak-accent) 16%, transparent); border-color: var(--ak-accent); }

.toolbar {
  position: fixed;
  right: 16px;
  bottom: 16px;
  pointer-events: auto;
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 4px;
  border-radius: 999px;
  background: var(--ak-surface);
  border: 1px solid var(--ak-border);
  box-shadow: var(--ak-shadow);
}
.toolbar button.btn { border-radius: 999px; border-color: transparent; padding: 6px 12px; }
.toolbar .bp {
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ak-muted); padding: 0 8px;
}
`;
