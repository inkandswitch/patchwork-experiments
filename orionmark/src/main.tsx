import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import "./main.css";

function addStyles(element: HTMLElement, textContent: string) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(textContent);
  const rootNode = element.getRootNode();
  (rootNode as typeof document | ShadowRoot).adoptedStyleSheets ??= [];
  (rootNode as typeof document | ShadowRoot).adoptedStyleSheets.push(sheet);
}

async function loadStyles() {
  const url = new URL("./main.css", import.meta.url);
  return (await fetch(url)).text();
}

export const plugins = [
  {
    type: "patchwork:tool",
    id: "orion/markwhen",
    name: "Markwhen",
    supportedDatatypes: ["markdown"],
    async load(): Promise<ToolImplementation> {
      const { renderMarkdownTool } = await import("./tool.tsx");
      const styles = await loadStyles();
      return (handle, element) => {
        addStyles(element, styles);
        return renderMarkdownTool(handle, element);
      };
    },
  },
];
