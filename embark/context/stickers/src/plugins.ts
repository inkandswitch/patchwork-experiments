import type { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as timerPlugins } from "./timer";

// The worker-safe plugin entry, served to Patchwork's module loader via the
// `patchwork` export condition. Plugin discovery imports this module inside a
// Web Worker, which has no importmap — so this file must contain only plugin
// metadata and lazy `load()`s: no runtime import of any bare specifier (and
// none of the library re-exports in ./index — the renderer and source-lib pull
// in codemirror and automerge-repo at the top level). ./timer is safe: its
// index is metadata-only with lazy loads of the same shape.
export const plugins: Plugin<any>[] = [
  ...timerPlugins,
  {
    type: "embark:context-view",
    id: "sticker-context-view",
    name: "Sticker context view",
    supports: ["sticker"],
    async load() {
      const { stickerView } = await import("./views");
      return stickerView;
    },
  },
];
