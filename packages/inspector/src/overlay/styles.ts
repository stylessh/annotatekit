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

.panel {
  position: fixed;
  right: 16px;
  bottom: 64px;
  width: min(360px, calc(100vw - 32px));
  max-height: min(520px, calc(100vh - 96px));
  overflow: auto;
  pointer-events: auto;
  padding: 12px;
  border-radius: 12px;
  background: var(--ak-surface);
  color: var(--ak-fg);
  border: 1px solid var(--ak-border);
  box-shadow: var(--ak-shadow);
}
.panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.panel-head strong { margin-right: auto; }
.panel-head .all { color: var(--ak-muted); font-size: 12px; }
button.btn.icon { padding: 2px 8px; font-size: 16px; line-height: 1; }
button.btn.danger { background: #dc2626; color: #fff; border-color: transparent; }
.panel .dim { color: var(--ak-muted); font-size: 12px; }
.panel code { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
.key-list { list-style: none; margin: 0; padding: 0; }
.key-list li { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--ak-border); }
.key-list li:first-child { border-top: 0; }
.key-list li[data-inactive] { opacity: .6; }
.key-list .info { flex: 1; min-width: 0; }
.key-list .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel .empty { color: var(--ak-muted); margin: 4px 0 8px; }
.panel .error { color: #dc2626; margin: 0 0 8px; }
.reveal {
  margin-bottom: 10px; padding: 8px; border-radius: 8px;
  background: color-mix(in srgb, var(--ak-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--ak-accent) 40%, transparent);
}
.reveal p { margin: 0 0 6px; }
.reveal .key { display: block; margin-bottom: 6px; word-break: break-all; user-select: all; }
.new-key { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ak-border); display: grid; gap: 8px; }
.new-key input[type="text"], .new-key select {
  width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--ak-border);
  background: transparent; color: inherit; font: inherit;
}
.new-key select { width: auto; flex: 1; }
.new-key .scopes { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.new-key .row { display: flex; gap: 8px; align-items: center; }
.panel input:focus-visible, .panel select:focus-visible { outline: 2px solid var(--ak-accent); outline-offset: 1px; }
`;
