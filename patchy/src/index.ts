import type { Plugin } from "@inkandswitch/patchwork-plugins";
import type { Repo } from "@automerge/automerge-repo/slim";

export const plugins: Plugin<any>[] = [
  // Mounted by the frame around the document area (see threepane's
  // `document-provider` tag), inside the draft overlay.
  {
    type: "patchwork:component",
    id: "patchwork-patch-layers-provider",
    name: "Patch Layers Provider",
    tags: ["document-provider"],
    async load() {
      const { PatchLayersProvider } = await import("./provider.js");
      return PatchLayersProvider;
    },
  },
  {
    type: "patchwork:component",
    id: "patches",
    name: "Patches",
    icon: "Layers",
    tags: ["context-tool"],
    async load() {
      const { renderPatchesPanel } = await import("./main");
      return (element: HTMLElement & { repo: Repo }) =>
        renderPatchesPanel(element);
    },
  },
  // A vector layer editor for patternwitch: each layer is a patch on the
  // drawing, its shapes drawn into the patch as pixels.
  {
    type: "patchwork:tool",
    id: "pwp",
    name: "pwp",
    icon: "PenTool",
    supportedDatatypes: ["patternwitch"],
    async load() {
      const { renderPwp } = await import("./tools/pwp/main");
      return renderPwp;
    },
  },
  // Washes what laid patches change in codemirror-base editors, while the
  // panel's Highlight is on.
  {
    type: "codemirror:extension",
    id: "patchy-highlights",
    name: "Patch highlights",
    supportedDatatypes: "*",
    async load() {
      const { patchHighlightsExtension } = await import("./highlights.js");
      return patchHighlightsExtension();
    },
  },
  {
    type: "patchwork:datatype",
    id: "patch",
    name: "Patch",
    icon: "Layers",
    unlisted: true,
    async load() {
      const { PatchDatatype } = await import("./datatype.js");
      return PatchDatatype;
    },
  },
];
