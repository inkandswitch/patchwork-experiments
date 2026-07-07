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
    // The context sidebar entry. The frame's context sidebar renders every
    // `patchwork:component` tagged `context-tool` (like drafts and comments)
    // as a bare component with no document; this one docks a single
    // per-browser context canvas whose url lives in localStorage (see
    // ContextCanvasComponent). The canvas itself is shared with the toolbar
    // keeper below through a lease, so it keeps running while the sidebar is
    // closed as long as the keeper holds it.
    type: "patchwork:component",
    id: "context-canvas",
    tags: ["context-tool"],
    name: "Context",
    icon: "Globe",
    async load() {
      const { ContextCanvasComponent } = await import("./canvas");
      return ContextCanvasComponent;
    },
  },
  {
    // The always-on keeper: add it to the frame's toolbar lane (via the frame
    // configurator) and it holds a lease on the context canvas host, keeping
    // the cards running while the sidebar is closed. Renders nothing and
    // ignores the doc it's pointed at.
    type: "patchwork:tool",
    id: "context-canvas-keeper",
    tags: ["titlebar-tool"],
    name: "Context canvas",
    icon: "Globe",
    supportedDatatypes: "*",
    unlisted: true,
    async load() {
      const { ContextCanvasKeeperTool } = await import("./canvas");
      return ContextCanvasKeeperTool;
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
