import type { Plugin } from "@inkandswitch/patchwork-plugins";

export {
  resolveInspectTarget,
  type InspectTarget,
  type InspectDoc,
} from "./resolve-target";

// A tabbed inspector pinned onto an embed via `toolId: "inspect"`. It renders
// the package that paints the inspected embed (its source folder doc) and, when
// the embed shows a document, that document. The package + document urls are
// resolved at inspect time (see `resolveInspectTarget`) and stored on the minted
// inspect doc this tool reads.
//
// `inspect-spec` is a private companion: a codemirror editor that gives the
// package's `spec.md` (a `file` document) the full markdown face. It declares no
// datatypes so it never surfaces in pickers or fallbacks — the inspector pins it
// explicitly by `tool-id` (in the Spec tab and the source browser).
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "inspect",
    name: "Inspect",
    icon: "Search",
    supportedDatatypes: ["inspect"],
    unlisted: true,
    async load() {
      const { InspectTool } = await import("./InspectTool");
      return InspectTool;
    },
  },
  {
    type: "patchwork:tool",
    id: "inspect-spec",
    name: "Spec",
    icon: "FileText",
    supportedDatatypes: [],
    unlisted: true,
    async load() {
      const { SpecTool } = await import("./SpecTool");
      return SpecTool;
    },
  },
];
