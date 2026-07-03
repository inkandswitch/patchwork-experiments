import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The selection/highlight focus channels. Shared token UI (EmbedToken, chips,
// hover->highlight wiring) ships from the `./tokens` subpath so packages that
// only need the channel definitions don't pull in Solid or the token CSS.
export * from "./channels";

// Registers a context visualizer for the `selection` and `highlight` channels
// (loaded lazily by the context viewer). See @embark/context's
// `embark:context-visualizer` plugin type.
export const plugins: Plugin<any>[] = [
  {
    type: "embark:context-visualizer",
    id: "selection-context-visualizer",
    name: "Selection context visualizer",
    channels: ["selection", "highlight"],
    async load() {
      const { selectionVisualizer } = await import("./visualizer");
      return selectionVisualizer;
    },
  },
];
