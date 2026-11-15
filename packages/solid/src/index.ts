import {
  type BindServiceOptions,
  type BindStorageOptions,
  bindService,
  bindStorage,
  createInspector,
  type Inspector,
  type InspectorOptions,
  type RenderableAnnotation,
  type ServiceBinding,
} from "@annotatekit/inspector";
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";

export type {
  AnnotationDraft,
  BindServiceOptions,
  BindStorageOptions,
  ElementSnapshot,
  Inspector,
  InspectorOptions,
  RenderableAnnotation,
} from "@annotatekit/inspector";

export interface InspectorProps
  extends Omit<InspectorOptions, "annotations" | "container" | "doc"> {
  /** Pins to draw. Ignored when `storage` or `service` is set, since they supply them. */
  annotations?: RenderableAnnotation[];
  /** Outline this annotation's region and targets, or `null` to clear. */
  focusedId?: string | null;
  /** Persist to and render from a core storage adapter. Read on mount. */
  storage?: BindStorageOptions;
  /** Persist to and render from any AnnotateKit service, e.g. a remote one. Read on mount. */
  service?: BindServiceOptions;
}

/**
 * Mounts the inspector overlay for the owner's lifetime. Pass Solid props
 * straight through: `active`, `mode`, `annotations` and `focusedId` are
 * tracked, callbacks are read when they fire, and structural options
 * (shortcut, theme, toolbar, breakpoints, storage, service) on mount.
 */
export function useInspector(props: InspectorProps = {}): Accessor<Inspector | null> {
  const [inspector, setInspector] = createSignal<Inspector | null>(null);
  let binding: ServiceBinding | null = null;
  const bound = () => !!(props.storage || props.service);

  onMount(() => {
    const {
      active,
      mode,
      annotations,
      focusedId,
      storage,
      service,
      onCreate: _onCreate,
      onSelect: _onSelect,
      onActiveChange: _onActiveChange,
      ...rest
    } = untrack(() => ({ ...props }));
    const opts: InspectorOptions = {
      ...rest,
      onCreate: (d) => props.onCreate?.(d),
      onSelect: (id) => props.onSelect?.(id),
      onActiveChange: (a) => props.onActiveChange?.(a),
    };
    if (active !== undefined) opts.active = active;
    if (mode) opts.mode = mode;
    if (annotations && !storage && !service) opts.annotations = annotations;
    const instance = createInspector(opts);
    binding = service
      ? bindService(instance, service)
      : storage
        ? bindStorage(instance, storage)
        : null;
    if (focusedId !== undefined) instance.focusAnnotation(focusedId);
    setInspector(() => instance);
  });
  onCleanup(() => {
    binding?.unbind();
    inspector()?.destroy();
    setInspector(null);
  });

  createEffect(() => {
    const i = inspector();
    const a = props.active;
    if (!i || a === undefined || a === i.active) return;
    if (a) i.activate();
    else i.deactivate();
  });
  createEffect(() => {
    const m = props.mode;
    if (m) inspector()?.setMode(m);
  });
  createEffect(() => {
    const list = props.annotations;
    if (list && !bound()) inspector()?.setAnnotations(list);
  });
  createEffect(() => {
    const id = props.focusedId;
    if (id !== undefined) inspector()?.focusAnnotation(id);
  });
  return inspector;
}

/** Drop-in component: `<AnnotateKitInspector annotations={pins()} onCreate={save} />`. Renders nothing. */
export function AnnotateKitInspector(props: InspectorProps): JSX.Element {
  useInspector(props);
  return null;
}

/** Tracks whether the inspector is on, for custom toolbars. */
export function createInspectorActive(inspector: Accessor<Inspector | null>): Accessor<boolean> {
  const [active, setActive] = createSignal(false);
  createEffect(() => {
    const i = inspector();
    if (!i) return;
    setActive(i.active);
    onCleanup(i.on("activechange", setActive));
  });
  return active;
}
