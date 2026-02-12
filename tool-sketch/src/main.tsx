import { DocHandle } from "@automerge/automerge-repo";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { datatype } from "./datatype.ts";
import "./main.css";

console.log("tool-sketch 0.3");

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "tool-sketch",
    name: "Tool Sketch",
    icon: "PenLine",
    async load() {
      return datatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "tool-sketch",
    name: "Tool Sketch",
    supportedDatatypes: ["tool-sketch"],
    async load(): Promise<ToolImplementation> {
      const { TldrawTool } = await import("./tool.tsx");
      return (handle: DocHandle<unknown>, element: HTMLElement) => {
        const root = createRoot(element);
        root.render(
          <RepoContext.Provider value={(element as any).repo}>
            <TldrawTool docUrl={handle.url} />
          </RepoContext.Provider>
        );
        return () => root.unmount();
      };
    },
  },
];
