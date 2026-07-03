import type { Plugin } from "@inkandswitch/patchwork-plugins";

export * from "./channels";

// Registers context visualizers for the search channels (loaded lazily by the
// context viewer). See @embark/context's `embark:context-visualizer` type.
export const plugins: Plugin<any>[] = [
  {
    type: "embark:context-visualizer",
    id: "search-context-visualizer",
    name: "Search context visualizer",
    channels: ["search:queries", "search:results"],
    async load() {
      const { searchVisualizer } = await import("./visualizer");
      return searchVisualizer;
    },
  },
];
