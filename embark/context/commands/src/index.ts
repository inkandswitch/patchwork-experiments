import type { Extension } from "@codemirror/state";
import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The command channels, the suggestion shape, and the shared place/route
// resolution helpers (used by the weather and route cards) that were absorbed
// from the old @embark/core "kitchen sink".
export * from "./channels";
export * from "./suggestion";
export * from "./place-resolve";
export * from "./fuzzy";
export * from "./route-provider";

export const plugins: Plugin<any>[] = [
  {
    type: "codemirror:extension",
    id: "embark-commands",
    name: "Embark /-command suggestions",
    supportedDatatypes: ["markdown", "essay"],
    async load(): Promise<Extension> {
      const { slashCommands } = await import("./extension");
      return slashCommands();
    },
  },
];
