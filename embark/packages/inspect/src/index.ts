import type { Plugin } from "@inkandswitch/patchwork-plugins";

export {
  resolveInspectTarget,
  type InspectTarget,
  type InspectDoc,
} from "./resolve-target";

// A two-pane inspector pinned onto an embed via `toolId: "inspect"`. It renders
// the package that paints the inspected embed (its source folder doc) and, when
// the embed shows a document, that document — each with a plain `<patchwork-view>`.
// The package + document urls are resolved at inspect time (see
// `resolveInspectTarget`) and stored on the minted inspect doc this tool reads.
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
];
