import { useDocument, RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createRoot } from "react-dom/client";
import React from "react";

import App from "./App";
import type { Doc } from "./datatype";
import "./styles.css";

function MergecraftView({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc] = useDocument<Doc>(docUrl);

  if (!doc) {
    return null;
  }

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <App docUrl={docUrl} />
    </div>
  );
}

export const MergecraftTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <MergecraftView docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
};
