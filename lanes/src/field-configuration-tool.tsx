import { RepoContext, useDocHandle, useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import type { AnyDocumentId, AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { FieldConfigurationEditor } from "./components/FieldConfigurationTool";

export const FieldConfigurationToolRender: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <FieldConfigurationEditor docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
