import { useDocument, RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl, UrlHeads } from "@automerge/automerge-repo";
import { useSubscribe } from "@inkandswitch/patchwork-providers-react";
import { createRoot } from "react-dom/client";
import React from "react";

import App from "./App";
import type { Doc } from "./datatype";
import "./styles.css";

// Diff baseline (fork-point heads) served by the draft overlay
// (`draft:baseline`). `heads` is null when there is no baseline (e.g. on
// "main") and no diff is rendered.
type Baseline = { heads: UrlHeads | null };

function MergecraftView({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: HTMLElement;
}) {
  const [doc] = useDocument<Doc>(docUrl);
  const baseline = useSubscribe<Baseline>(
    element,
    { type: "draft:baseline", url: docUrl },
    { heads: null }
  );

  if (!doc) {
    return null;
  }

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <App docUrl={docUrl} baselineHeads={baseline.heads ?? undefined} />
    </div>
  );
}

export const MergecraftTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <MergecraftView docUrl={handle.url} element={element} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
};
