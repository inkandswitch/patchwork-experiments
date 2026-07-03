import type { Repo } from "@automerge/automerge-repo";
import { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as partsBinPlugins } from "./parts-bin";
import { plugins as deckPlugins } from "./deck";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "embark-canvas",
    name: "Embark Canvas",
    icon: "LayoutGrid",
    supportedDatatypes: ["embark-canvas"],
    async load() {
      const { EmbarkCanvasTool } = await import("./canvas");
      return EmbarkCanvasTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "embark-canvas",
    name: "Embark Canvas",
    icon: "LayoutGrid",
    async load() {
      const { EmbarkCanvasDatatype } = await import("./datatype");
      return EmbarkCanvasDatatype;
    },
  },
  {
    // A context sidebar tool (the `context-tool` tag surfaces it in the frame's
    // context sidebar / configurator, like drafts and comments). It is handed
    // the account doc — which it ignores — and instead hosts a single per-browser
    // context canvas whose url lives in localStorage (see ContextCanvasTool).
    type: "patchwork:tool",
    id: "context-canvas",
    tags: ["context-tool"],
    name: "Context",
    icon: "Globe",
    supportedDatatypes: ["account"],
    async load() {
      const { ContextCanvasTool } = await import("./canvas");
      return ContextCanvasTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "context-canvas",
    name: "Context",
    icon: "Globe",
    // Created programmatically by the context tool, never from the "new document"
    // menu, so keep it out of the datatype picker.
    unlisted: true,
    async load() {
      const { ContextCanvasDatatype } = await import("./datatype");
      return ContextCanvasDatatype;
    },
  },
  ...partsBinPlugins,
  ...deckPlugins,
];

// Keep the context canvas alive even while the sidebar is closed: mount it
// hidden on document.body as soon as this bundle loads, so its cards
// (mentions, command providers, sticker sources, …) are always active. The
// sidebar tool adopts this same live host when opened (see ContextCanvasTool).
// window.repo is set by the bootloader before plugin modules load.
if (typeof window !== "undefined") {
  void import("./canvas").then(({ ensureContextCanvasHost }) =>
    ensureContextCanvasHost((window as { repo?: Repo }).repo),
  );
}
