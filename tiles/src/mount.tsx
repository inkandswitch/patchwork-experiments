import { createRoot } from "react-dom/client";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { RepoContext } from "@automerge/react";
import { TilesTool } from "./tool.tsx";
import "./main.css";

function addStyles(textContent: string, element: HTMLElement = document.head) {
  const id = "tiles-styles";
  const el =
    element.querySelector(`#${id}`) ?? document.createElement("style");
  Object.assign(el, { textContent, id });
  element.append(el);
}

async function loadStyles() {
  const url = new URL("./main.css", import.meta.url);
  return (await fetch(url)).text();
}

const mount: ToolImplementation = (handle, element) => {
  loadStyles().then(addStyles);
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <TilesTool docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

export default mount;
