import { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "patchwork-frame-dockview",
    tags: ["frame-tool"],
    name: "Patchwork Frame (Dockview)",
    icon: "Window",
    supportedDatatypes: ["account"],
    async load() {
      const { renderPatchworkFrame } = await import("./PatchworkFrame");
      return renderPatchworkFrame;
    },
  },
];
