import { createRoot } from "react-dom/client";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { datatype as datatype, type TLDrawDoc } from "./datatype.ts";
import { RepoContext } from "@automerge/react";
import "./main.css";
import { DocHandle } from "@automerge/automerge-repo";

function addStyles(textContent: string, element: HTMLElement = document.head) {
  const id = "tldraw-styles";
  const el = element.querySelector(`#${id}`) ?? document.createElement("style");
  Object.assign(el, { textContent, id });
  element.append(el);
}

async function loadStyles() {
  const url = new URL("./main.css", import.meta.url);
  return (await fetch(url)).text();
}

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
      const styles = await loadStyles();
      return (handle: DocHandle<TLDrawDoc>, element: HTMLElement) => {
        const root = createRoot(element);
        addStyles(styles);
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
