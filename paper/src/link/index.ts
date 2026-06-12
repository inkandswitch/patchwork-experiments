import type { Extension } from "@codemirror/state";

// A CodeMirror extension, loaded into any text editor via the
// `codemirror:extension` registry. It lets the user link a text selection to
// shapes on a paper surface: clicking a link's icon arms it, and the paper's
// arrow layer (registered below) draws arrows from the link to its targets
// and to the mouse, snapping to shapes; clicking a shape adds it to the link.
export const plugins = [
  {
    type: "codemirror:extension",
    id: "paper-doc-links",
    name: "Paper Document Links",
    supportedDatatypes: ["essay", "markdown"],
    async load(): Promise<Extension> {
      const { paperDocLinks } = await import("./extension");
      return paperDocLinks();
    },
  },
  {
    type: "patchwork:tool",
    id: "link-arrow-layer",
    name: "Link Arrows",
    icon: "Spline",
    supportedDatatypes: ["shape-layer"],
    async load() {
      const { LinkArrowLayerTool } = await import("./LinkArrowLayerTool");
      return LinkArrowLayerTool;
    },
  },
];
