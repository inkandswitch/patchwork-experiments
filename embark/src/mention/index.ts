import type { Extension } from "@codemirror/state";

export const plugins = [
  {
    type: "codemirror:extension",
    id: "embark-mention",
    name: "Embark @-mention tokens",
    supportedDatatypes: ["markdown", "essay"],
    async load(): Promise<Extension> {
      const { mentionSearch } = await import("./extension");
      return mentionSearch();
    },
  },
];
