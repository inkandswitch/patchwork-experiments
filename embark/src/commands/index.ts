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
  {
    type: "patchwork:datatype",
    id: "commands",
    name: "Commands",
    icon: "Command",
    async load() {
      const { CommandsDatatype } = await import("./datatype");
      return CommandsDatatype;
    },
  },
];
