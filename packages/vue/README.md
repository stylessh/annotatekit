# @annotatekit/vue

Vue 3 bindings for [`@annotatekit/inspector`](../inspector).

```vue
<script setup lang="ts">
import { createLocalStorageAdapter } from "@annotatekit/core";
import { AnnotateKitInspector } from "@annotatekit/vue";
import { ref } from "vue";

const storage = createLocalStorageAdapter({ key: "annotatekit:my-app" });
const active = ref(false);
</script>

<template>
  <YourApp />
  <AnnotateKitInspector
    v-model:active="active"
    :options="{ storage: { storage, projectId: 'my-app', actor: currentUser } }"
    @select="openThread"
  />
</template>
```

Without `storage`, pass `annotations` and listen to `@create`. `active`, `mode`,
`annotations` and `focusedId` are reactive props; everything in `options` is
read once on mount.

The `useInspector(options)` composable accepts refs or getters for the reactive
options and returns a `shallowRef` to the `Inspector`.
