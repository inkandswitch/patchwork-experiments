import type {
  LoadablePlugin,
  ToolDescription,
  ToolImplementation,
} from "@inkandswitch/patchwork-plugins";

export const plugins: LoadablePlugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "raw",
    name: "Raw",
    supportedDatatypes: "*",
    async load() {
      const { TinyTool } = await import("./components/RawEditor");
      console.log("RAW SOLID 4");
      return TinyTool;
    },
  } satisfies LoadablePlugin<ToolDescription, ToolImplementation>,
];
