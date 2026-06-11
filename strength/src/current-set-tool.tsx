import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { CurrentSet } from "./components/CurrentSet";

/**
 * Minimal "what do I do right now?" view of a workout session: just the
 * next incomplete set. Open it on a session URL — completing the set
 * advances to the next one automatically.
 */
function CurrentSetView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <div className="strength h-full overflow-y-auto bg-slate-50 p-4">
      <Suspense
        fallback={
          <p className="text-center text-xs text-slate-400">Loading…</p>
        }
      >
        <div className="mx-auto max-w-xl">
          <CurrentSet sessionUrl={docUrl} />
        </div>
      </Suspense>
    </div>
  );
}

export const CurrentSetTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <CurrentSetView docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
