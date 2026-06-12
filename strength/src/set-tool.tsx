import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Suspense } from "react";
import { SingleSet } from "./components/SingleSet";
import { makeTool } from "./make-tool";

/**
 * The app-wide set renderer, as a tool. Open it on a URL like:
 *
 *   automerge:<sessionDocId>/sets/{"id":"<setId>"}     — pin one set
 *   automerge:<sessionDocId>/sets/{"completed":false}  — live current set
 *
 * Chrome is deliberately minimal: this tool is embedded per-row inside
 * the exercise logger and the current-set banner, so the embedding
 * context owns spacing and headers.
 */
function SetView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <div className="strength p-1">
      <Suspense
        fallback={
          <p className="text-center text-xs text-slate-400">Loading…</p>
        }
      >
        <SingleSet setUrl={docUrl} />
      </Suspense>
    </div>
  );
}

export const SetTool = makeTool(SetView);
