import {
  type BindServiceOptions,
  type BindStorageOptions,
  bindService,
  bindStorage,
  createInspector,
  type Inspector,
  type InspectorOptions,
  type ServiceBinding,
} from "@annotatekit/inspector";

export type {
  AnnotationDraft,
  BindServiceOptions,
  BindStorageOptions,
  ElementSnapshot,
  Inspector,
  InspectorOptions,
  RenderableAnnotation,
} from "@annotatekit/inspector";

export interface AnnotateKitOptions extends Omit<InspectorOptions, "container" | "doc"> {
  /** Outline this annotation's region and targets, or `null` to clear. */
  focusedId?: string | null;
  /** Persist to and render from a core storage adapter. Read on mount. */
  storage?: BindStorageOptions;
  /** Persist to and render from any AnnotateKit service, e.g. a remote one. Read on mount. */
  service?: BindServiceOptions;
  /** Called with the inspector once it is mounted, e.g. to keep a handle. */
  onReady?: (inspector: Inspector) => void;
}

/** The object a Svelte action returns. Structurally matches `svelte/action`'s `ActionReturn`. */
export interface AnnotateKitActionReturn {
  update(options?: AnnotateKitOptions): void;
  destroy(): void;
}

/**
 * Svelte action that mounts the inspector overlay while the element exists:
 *
 * ```svelte
 * <svelte:body use:annotatekit={{ annotations, onCreate: save }} />
 * ```
 *
 * Structural options (shortcut, theme, toolbar, breakpoints, storage, service)
 * are read on mount; `active`, `mode`, `annotations`, `focusedId` and the
 * callbacks follow updates.
 */
export function annotatekit(
  _node: Element,
  options: AnnotateKitOptions = {},
): AnnotateKitActionReturn {
  let current = options;
  const { active, mode, annotations, focusedId, storage, service, onReady, ...rest } = options;
  const bound = !!(storage || service);
  const opts: InspectorOptions = {
    ...rest,
    onCreate: (d) => current.onCreate?.(d),
    onSelect: (id) => current.onSelect?.(id),
    onActiveChange: (a) => current.onActiveChange?.(a),
  };
  if (active !== undefined) opts.active = active;
  if (mode) opts.mode = mode;
  if (annotations && !bound) opts.annotations = annotations;
  const inspector = createInspector(opts);
  const binding: ServiceBinding | null = service
    ? bindService(inspector, service)
    : storage
      ? bindStorage(inspector, storage)
      : null;
  if (focusedId !== undefined) inspector.focusAnnotation(focusedId);
  onReady?.(inspector);

  return {
    update(next = {}) {
      const prev = current;
      current = next;
      if (next.active !== undefined && next.active !== inspector.active) {
        if (next.active) inspector.activate();
        else inspector.deactivate();
      }
      if (next.mode && next.mode !== prev.mode) inspector.setMode(next.mode);
      if (!bound && next.annotations && next.annotations !== prev.annotations) {
        inspector.setAnnotations(next.annotations);
      }
      if (next.focusedId !== undefined && next.focusedId !== prev.focusedId) {
        inspector.focusAnnotation(next.focusedId);
      }
    },
    destroy() {
      binding?.unbind();
      inspector.destroy();
    },
  };
}

/** A Svelte store (`$active`) that follows whether the inspector is on. */
export function activeStore(inspector: Inspector): {
  subscribe(run: (active: boolean) => void): () => void;
} {
  return {
    subscribe(run) {
      run(inspector.active);
      return inspector.on("activechange", run);
    },
  };
}
