import type { Extension } from "@codemirror/state";
import type { Plugin } from "@inkandswitch/patchwork-plugins";

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
