import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Suspense } from "react";
import { CurrentSet } from "./components/CurrentSet";
import { makeTool } from "./make-tool";

/**
 * Minimal "what do I do right now?" view of a workout session: just the
 * next incomplete set. Open it on a session URL — completing the set
 * advances to the next one automatically.
 */
function CurrentSetView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <div className="strength st-page">
      <Suspense
        fallback={
          <p className="st-loading">Loading…</p>
        }
      >
        <div className="st-column">
          <CurrentSet sessionUrl={docUrl} />
        </div>
      </Suspense>
    </div>
  );
}

export const CurrentSetTool = makeTool(CurrentSetView);
