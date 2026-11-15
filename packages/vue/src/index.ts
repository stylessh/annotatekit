import {
  type AnnotationDraft,
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
  defineComponent,
  type MaybeRefOrGetter,
  onBeforeUnmount,
  onMounted,
  type PropType,
  type ShallowRef,
  shallowRef,
  toValue,
  watch,
} from "vue";

export type {
  AnnotationDraft,
  BindServiceOptions,
  BindStorageOptions,
  ElementSnapshot,
  Inspector,
  InspectorOptions,
  RenderableAnnotation,
} from "@annotatekit/inspector";

export interface UseInspectorOptions
  extends Omit<InspectorOptions, "annotations" | "active" | "mode" | "container" | "doc"> {
  active?: MaybeRefOrGetter<boolean | undefined>;
  mode?: MaybeRefOrGetter<InspectorOptions["mode"] | undefined>;
  /** Pins to draw. Ignored when `storage` or `service` is set, since they supply them. */
  annotations?: MaybeRefOrGetter<RenderableAnnotation[] | undefined>;
  focusedId?: MaybeRefOrGetter<string | null | undefined>;
  /** Persist to and render from a core storage adapter. Read on mount. */
  storage?: BindStorageOptions;
  /** Persist to and render from any AnnotateKit service, e.g. a remote one. Read on mount. */
  service?: BindServiceOptions;
}

/** Composable: mounts the overlay when the component mounts and removes it on unmount. */
export function useInspector(options: UseInspectorOptions = {}): ShallowRef<Inspector | null> {
  const inspector = shallowRef<Inspector | null>(null);
  const { active, mode, annotations, focusedId, storage, service, ...rest } = options;
  const bound = !!(storage || service);
  let binding: ServiceBinding | null = null;

  onMounted(() => {
    const opts: InspectorOptions = { ...rest };
    const a = toValue(active);
    const m = toValue(mode);
    const list = toValue(annotations);
    if (a !== undefined) opts.active = a;
    if (m) opts.mode = m;
    if (list && !bound) opts.annotations = list;
    const instance = createInspector(opts);
    if (service) binding = bindService(instance, service);
    else if (storage) binding = bindStorage(instance, storage);
    inspector.value = instance;
  });
  onBeforeUnmount(() => {
    binding?.unbind();
    inspector.value?.destroy();
    inspector.value = null;
  });

  watch(
    () => toValue(active),
    (a) => {
      if (a === undefined || !inspector.value) return;
      if (a) inspector.value.activate();
      else inspector.value.deactivate();
    },
  );
  watch(
    () => toValue(mode),
    (m) => {
      if (m) inspector.value?.setMode(m);
    },
  );
  watch(
    () => toValue(annotations),
    (list) => {
      if (list && !bound) inspector.value?.setAnnotations(list);
    },
  );
  watch(
    () => toValue(focusedId),
    (id) => {
      if (id !== undefined) inspector.value?.focusAnnotation(id);
    },
  );

  return inspector;
}

/**
 * `<AnnotateKitInspector :annotations="pins" @create="save" />`. Supports
 * `v-model:active`. Pass structural options through `options`. Renders nothing.
 */
export const AnnotateKitInspector = defineComponent({
  name: "AnnotateKitInspector",
  props: {
    active: { type: Boolean, default: undefined },
    mode: { type: String as PropType<InspectorOptions["mode"]>, default: undefined },
    annotations: { type: Array as PropType<RenderableAnnotation[]>, default: undefined },
    focusedId: { type: String as PropType<string | null>, default: undefined },
    options: { type: Object as PropType<UseInspectorOptions>, default: () => ({}) },
  },
  emits: {
    create: (_draft: AnnotationDraft) => true,
    select: (_id: string) => true,
    "update:active": (_active: boolean) => true,
  },
  setup(props, { emit, expose }) {
    const inspector = useInspector({
      ...props.options,
      active: () => props.active,
      mode: () => props.mode,
      annotations: () => props.annotations,
      focusedId: () => props.focusedId,
      onCreate: (d) => {
        props.options.onCreate?.(d);
        emit("create", d);
      },
      onSelect: (id) => {
        props.options.onSelect?.(id);
        emit("select", id);
      },
      onActiveChange: (a) => {
        props.options.onActiveChange?.(a);
        emit("update:active", a);
      },
    });
    expose({ inspector });
    return () => null;
  },
});
