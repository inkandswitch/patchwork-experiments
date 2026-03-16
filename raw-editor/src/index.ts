import type {
  LoadablePlugin,
  ToolDescription,
  ToolImplementation,
} from "@inkandswitch/patchwork-plugins";

export const plugins: LoadablePlugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "raw2",
    name: "Raw2",
    supportedDatatypes: "*",
    async load() {
      console.log("Loading Raw v2 29");
      const { TinyTool } = await import("./components/RawEditor");
      return TinyTool;
    },
  } satisfies LoadablePlugin<ToolDescription, ToolImplementation>,
];
