import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { SingleSet } from "./components/SingleSet";

/**
 * Standalone tool for a single path-addressed set. Open it on a URL like:
 *
 *   automerge:<sessionDocId>/sets/{"id":"<setId>"}     — pin one set
 *   automerge:<sessionDocId>/sets/{"completed":false}  — live current set
 *
 * The pinned form is stable across reorders (matched by id); the pattern
 * form re-resolves on every change, so it always shows the next thing to
 * do. Embed either flavor in other documents via patchwork-view.
 */
function SetView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <div className="strength h-full overflow-y-auto bg-slate-50 p-4">
      <Suspense
        fallback={
          <p className="text-center text-xs text-slate-400">Loading…</p>
        }
      >
        <div className="mx-auto max-w-xl">
          <SingleSet setUrl={docUrl} />
        </div>
      </Suspense>
    </div>
  );
}

export const SetTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <SetView docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
