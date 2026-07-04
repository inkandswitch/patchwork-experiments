import { Plugin, ToolImplementation } from "@inkandswitch/patchwork-plugins";
import type { AccountDoc } from "./types";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "quiet-frame",
    tags: ["frame-tool"],
    name: "Quiet Frame",
    icon: "Window",
    supportedDatatypes: ["account"],
    async load(): Promise<ToolImplementation<AccountDoc>> {
      const { renderPatchworkFrame } = await import("./frame/PatchworkFrame");
      return renderPatchworkFrame;
    },
  },
];
