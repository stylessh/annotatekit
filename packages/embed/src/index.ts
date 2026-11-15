import { createAnnotateKitClient } from "@annotatekit/client";
import {
  type Actor,
  type AnnotateKitService,
  createAnnotateKitService,
  createLocalStorageAdapter,
} from "@annotatekit/core";
import {
  bindService,
  createInspector,
  type Inspector,
  type InspectorOptions,
  type ServiceBinding,
} from "@annotatekit/inspector";

export interface EmbedOptions {
  /** Project the threads belong to. Defaults to the page's hostname. */
  project?: string;
  /**
   * An AnnotateKit server's API root, e.g. `https://feedback.example.com/v1`.
   * Without one, threads are kept in this browser's localStorage.
   */
  server?: string;
  /** Bearer token for the server, such as a host token from `@annotatekit/auth`. */
  token?: string;
  /** Who is annotating. Defaults to an anonymous visitor with an id kept in localStorage. */
  user?: { id?: string; name?: string; email?: string };
  /** Keyboard shortcut that toggles the inspector, or `false`. Defaults to `Alt+KeyA`. */
  shortcut?: InspectorOptions["shortcut"];
  theme?: InspectorOptions["theme"];
  /** Accent color for pins and highlights, any CSS color. */
  accentColor?: string;
  /** Start with the inspector on. */
  active?: boolean;
  /** CSS selector for page UI the inspector should leave alone. */
  ignore?: string;
  /** Show the floating toolbar. Defaults to true. */
  toolbar?: boolean;
}

export interface EmbedInstance {
  inspector: Inspector;
  service: AnnotateKitService;
  binding: ServiceBinding;
  /** Where threads are saved: `"server"` or `"local"`. */
  backend: "server" | "local";
  destroy(): void;
}

const VISITOR_KEY = "annotatekit:visitor";

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, 16);
  return Math.random().toString(36).slice(2, 18);
}

/** The anonymous visitor's id, stable across visits in this browser. */
function visitorId(): string {
  const store = safeStorage();
  const existing = store?.getItem(VISITOR_KEY);
  if (existing) return existing;
  const id = `vis_${randomId()}`;
  store?.setItem(VISITOR_KEY, id);
  return id;
}

function actorFrom(user: EmbedOptions["user"]): Actor {
  const actor: Actor = {
    kind: "human",
    id: user?.id ?? visitorId(),
    name: user?.name ?? "Visitor",
  };
  if (user?.email) actor.email = user.email;
  return actor;
}

/** Add the inspector to the current page. Returns handles to everything it set up. */
export function init(options: EmbedOptions = {}): EmbedInstance {
  const project = options.project ?? location.hostname ?? "default";
  const backend = options.server ? "server" : "local";
  const service: AnnotateKitService = options.server
    ? createAnnotateKitClient({
        baseUrl: options.server,
        ...(options.token ? { token: options.token } : {}),
      })
    : createAnnotateKitService({
        storage: createLocalStorageAdapter({ key: `annotatekit:${project}` }),
      });

  const inspectorOptions: InspectorOptions = {};
  if (options.shortcut !== undefined) inspectorOptions.shortcut = options.shortcut;
  if (options.theme) inspectorOptions.theme = options.theme;
  if (options.accentColor) inspectorOptions.accentColor = options.accentColor;
  if (options.active) inspectorOptions.active = true;
  if (options.ignore) inspectorOptions.ignore = options.ignore;
  if (options.toolbar === false) inspectorOptions.toolbar = false;
  const inspector = createInspector(inspectorOptions);
  const actor = actorFrom(options.user);
  const binding = bindService(inspector, { service, projectId: project, actor });

  return {
    inspector,
    service,
    binding,
    backend,
    destroy() {
      binding.unbind();
      inspector.destroy();
    },
  };
}

const truthy = (v: string | undefined) => v !== undefined && v !== "false" && v !== "0";

/**
 * Read options from a script tag's data attributes:
 * `data-project`, `data-server`, `data-token`, `data-user-id`, `data-user-name`,
 * `data-user-email`, `data-shortcut` (`"false"` turns it off), `data-theme`,
 * `data-accent`, `data-active`, `data-ignore` and `data-toolbar="false"`.
 */
export function optionsFromScript(script: HTMLOrSVGScriptElement): EmbedOptions {
  const d = (script as HTMLElement).dataset;
  const opts: EmbedOptions = {};
  if (d.project) opts.project = d.project;
  if (d.server) opts.server = d.server;
  if (d.token) opts.token = d.token;
  if (d.userId || d.userName || d.userEmail) {
    const user: NonNullable<EmbedOptions["user"]> = {};
    if (d.userId) user.id = d.userId;
    if (d.userName) user.name = d.userName;
    if (d.userEmail) user.email = d.userEmail;
    opts.user = user;
  }
  if (d.shortcut) opts.shortcut = d.shortcut === "false" ? false : d.shortcut;
  if (d.theme === "light" || d.theme === "dark" || d.theme === "auto") opts.theme = d.theme;
  if (d.accent) opts.accentColor = d.accent;
  if (truthy(d.active)) opts.active = true;
  if (d.ignore) opts.ignore = d.ignore;
  if (d.toolbar === "false") opts.toolbar = false;
  return opts;
}
