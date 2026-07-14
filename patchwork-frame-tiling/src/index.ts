import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "patchwork-frame-tiling:layout",
    name: "Tiling Layout",
    icon: "LayoutGrid",
    unlisted: true,
    async load() {
      const { TilingLayoutDatatype } = await import("./datatype");
      return TilingLayoutDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "patchwork-frame-tiling",
    tags: ["frame-tool"],
    name: "Patchwork Frame (Tiling)",
    icon: "LayoutGrid",
    supportedDatatypes: ["account"],
    async load() {
      const { renderPatchworkFrame } = await import("./PatchworkFrame");
      return renderPatchworkFrame;
    },
  },
];
