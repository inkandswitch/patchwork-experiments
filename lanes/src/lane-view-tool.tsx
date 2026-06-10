import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { LaneViewEditor } from "./components/LaneView";

export const LaneViewTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <LaneViewEditor docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
