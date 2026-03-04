import type { Extension } from "@codemirror/state";

export const plugins = [
  {
    type: "codemirror:extension",
    id: "codemirror-latex",
    name: "LaTeX (math in markdown)",
    supportedDatatypes: ["essay", "markdown"],
    async load(): Promise<Extension> {
      const { latexExtensions } = await import("./extension.js");
      return latexExtensions();
    },
  },
];
