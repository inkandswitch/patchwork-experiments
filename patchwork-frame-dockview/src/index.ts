import { Plugin } from "@inkandswitch/patchwork-plugins";
import { toolify } from "@inkandswitch/patchwork-react";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "patchwork-frame-dockview",
    category: "frame",
    name: "Patchwork Frame (Dockview)",
    icon: "Window",
    supportedDatatypes: ["account"],
    async load() {
      const { PatchworkFrame } = await import("./PatchworkFrame");
      return toolify(PatchworkFrame);
    },
  },
];
