import type { Extension } from "@codemirror/state";

// A CodeMirror extension, loaded into any text editor via the
// `codemirror:extension` registry. It lets the user link a text selection to
// whatever shapes they have shift-selected on a paper surface, writing a
// `[text](automerge:url,automerge:url)` markdown link, and highlights those
// shapes again whenever the cursor lands inside such a link.
export const plugins = [
  {
    type: "codemirror:extension",
    id: "paper-doc-links",
    name: "Paper Document Links",
    supportedDatatypes: ["essay", "markdown"],
    async load(): Promise<Extension> {
      const { paperDocLinks } = await import("./extension");
      return paperDocLinks();
    },
  },
];
