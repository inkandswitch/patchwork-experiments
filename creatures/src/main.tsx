import { createRoot } from "react-dom/client";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";

import { RepoContext } from "@automerge/react";
import "./main.css";

function addStyles(textContent: string, element: HTMLElement = document.head) {
  const id = "creature-sketch-styles";
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
    id: "creature-sketch",
    name: "Creature Sketch",
    icon: "PenLine",
    async load() {
      return (await import("./datatype.ts")).datatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "creature-sketch",
    name: "Creature Sketch",
    supportedDatatypes: ["creature-sketch"],
    async load(): Promise<ToolImplementation> {
      const { CreatureSketchTool } = await import("./tool.tsx");
      const styles = await loadStyles();
      return (handle, element) => {
        const root = createRoot(element);
        addStyles(styles);
        root.render(
          <RepoContext.Provider value={element.repo}>
            <CreatureSketchTool docUrl={handle.url} />
          </RepoContext.Provider>
        );
        return () => root.unmount();
      };
    },
  },
];
