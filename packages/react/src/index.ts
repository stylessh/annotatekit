import {
  type BindServiceOptions,
  type BindStorageOptions,
  bindService,
  bindStorage,
  createInspector,
  type Inspector,
  type InspectorOptions,
  type RenderableAnnotation,
} from "@annotatekit/inspector";
import { type RefObject, useEffect, useRef, useState } from "react";

export type {
  AnnotationDraft,
  BindServiceOptions,
  BindStorageOptions,
  ElementSnapshot,
  Inspector,
  InspectorOptions,
  RenderableAnnotation,
} from "@annotatekit/inspector";

export interface UseInspectorProps
  extends Omit<InspectorOptions, "annotations" | "active" | "mode" | "container" | "doc"> {
  /** Controlled active state. Leave undefined to let the toolbar and shortcut drive it. */
  active?: boolean;
  mode?: InspectorOptions["mode"];
  /** Pins to draw. Ignored when `storage` or `service` is set, since they supply them. */
  annotations?: RenderableAnnotation[];
  focusedId?: string | null;
  /** Persist to and render from a core storage adapter. Read on mount. */
  storage?: BindStorageOptions;
  /** Persist to and render from any AnnotateKit service, e.g. a remote one. Read on mount. */
  service?: BindServiceOptions;
}

/**
 * Mounts the inspector overlay for the component's lifetime. Callbacks are read
 * through a ref, so inline functions don't remount it. Structural options
 * (shortcut, theme, toolbar, breakpoints, storage) are read on mount only.
 */
export function useInspector(props: UseInspectorProps = {}): RefObject<Inspector | null> {
  const ref = useRef<Inspector | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // Mount-only by design: see above.
  useEffect(() => {
    const {
      active,
      mode,
      annotations,
      focusedId: _focusedId,
      storage,
      service,
      onCreate: _onCreate,
      onSelect: _onSelect,
      onActiveChange: _onActiveChange,
      ...rest
    } = latest.current;
    const options: InspectorOptions = {
      ...rest,
      onCreate: (d) => latest.current.onCreate?.(d),
      onSelect: (id) => latest.current.onSelect?.(id),
      onActiveChange: (a) => latest.current.onActiveChange?.(a),
    };
    if (active !== undefined) options.active = active;
    if (mode) options.mode = mode;
    if (annotations && !storage && !service) options.annotations = annotations;
    const inspector = createInspector(options);
    const binding = service
      ? bindService(inspector, service)
      : storage
        ? bindStorage(inspector, storage)
        : null;
    ref.current = inspector;
    return () => {
      binding?.unbind();
      inspector.destroy();
      ref.current = null;
    };
  }, []);

  useEffect(() => {
    const i = ref.current;
    if (!i || props.active === undefined) return;
    if (props.active) i.activate();
    else i.deactivate();
  }, [props.active]);
  useEffect(() => {
    if (props.mode) ref.current?.setMode(props.mode);
  }, [props.mode]);
  useEffect(() => {
    const bound = latest.current.storage || latest.current.service;
    if (props.annotations && !bound) ref.current?.setAnnotations(props.annotations);
  }, [props.annotations]);
  useEffect(() => {
    if (props.focusedId !== undefined) ref.current?.focusAnnotation(props.focusedId);
  }, [props.focusedId]);

  return ref;
}

/** Drop-in component: `<AnnotateKitInspector onCreate={save} annotations={pins} />`. Renders nothing. */
export function AnnotateKitInspector(props: UseInspectorProps): null {
  useInspector(props);
  return null;
}

/** Tracks whether the inspector is active, for custom toolbars. */
export function useInspectorActive(ref: RefObject<Inspector | null>): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const i = ref.current;
    if (!i) return;
    setActive(i.active);
    return i.on("activechange", setActive);
  }, [ref]);
  return active;
}
