import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { CardEditor, CompactCardEditor } from "./components/CardTool";

export const CardTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <CardEditor docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

export const CompactCardTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <CompactCardEditor docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
