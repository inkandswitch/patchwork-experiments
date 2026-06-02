import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";

import "./main.css";

function addStyles(textContent: string, element: HTMLElement = document.head) {
  const id = "propagator-styles";
  const el = element.querySelector(`#${id}`) ?? document.createElement("style");
  Object.assign(el, { textContent, id });
  element.append(el);
}

async function loadStyles() {
  const url = new URL("./main.css", import.meta.url);
  return (await fetch(url)).text();
}

export const plugins = [
  // Keep the existing `tldraw4` datatype registered (identical impl) so this
  // module can open — and create — the same tldraw documents as the vanilla
  // tool. Registration is last-wins by id, and this datatype is unchanged.
  {
    type: "patchwork:datatype",
    id: "tldraw4",
    name: "tldraw",
    icon: "PenLine",
    async load() {
      return (await import("./datatype.ts")).datatype;
    },
  },
  // Register under a NEW tool id so we don't overwrite the vanilla `tldraw4`
  // tool. Both tools show up for `tldraw4` documents.
  {
    type: "patchwork:tool",
    id: "propagator",
    name: "Propagator",
    icon: "Workflow",
    supportedDatatypes: ["tldraw4"],
    async load(): Promise<ToolImplementation> {
      const { render } = await import("./tool.tsx");
      const styles = await loadStyles();
      return (handle, element) => {
        addStyles(styles);
        return render(handle, element);
      };
    },
  },
];
