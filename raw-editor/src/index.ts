import type { LoadablePlugin } from "@patchwork/sdk";

export const plugins: LoadablePlugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "raw",
    name: "Raw",
    supportedDataTypes: "*",
    async load() {
      const { TinyTool } = await import("./components/RawEditor");
      return TinyTool;
    },
  },
];
