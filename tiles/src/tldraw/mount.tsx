import { createRoot } from "react-dom/client";
import { RepoContext } from "@automerge/react";
import { TldrawTool } from "./tool.tsx";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import "./main.css";

const mount: ToolImplementation = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <TldrawTool docUrl={handle.url} element={element} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
};

export default mount;
