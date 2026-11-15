/**
 * The `<script>` tag entry. Reads options from the tag's data attributes and
 * starts the inspector once the page has parsed, unless `data-manual` is set:
 * then call `AnnotateKit.init({...})` yourself.
 */
import { type EmbedInstance, type EmbedOptions, init, optionsFromScript } from "./index.js";

interface AnnotateKitGlobal {
  init(options?: EmbedOptions): EmbedInstance;
  /** The running instance, once started. */
  instance: EmbedInstance | null;
}

declare global {
  interface Window {
    AnnotateKit?: AnnotateKitGlobal;
  }
}

const script = document.currentScript;

if (!window.AnnotateKit) {
  const api: AnnotateKitGlobal = {
    instance: null,
    init(options = {}) {
      api.instance?.destroy();
      api.instance = init(options);
      return api.instance;
    },
  };
  window.AnnotateKit = api;

  if (script && !(script as HTMLElement).hasAttribute("data-manual")) {
    const options = optionsFromScript(script);
    const start = () => api.init(options);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else start();
  }
}
