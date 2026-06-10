import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { ExerciseLogger } from "./components/ExerciseLogger";
import type { LoggedExercise } from "./types";

/**
 * Experimental standalone tool for a path-addressed exercise sub-document.
 * Open it on a URL like:
 *
 *   automerge:<sessionDocId>/exercises/{"id":"<exerciseId>"}
 *
 * and it renders a focused, editable logger for just that exercise — useful
 * as a mobile "focus mode" or as an embed inside other tools.
 */
function FocusedExercise({ docUrl }: { docUrl: AutomergeUrl }) {
  const [exercise] = useDocument<LoggedExercise>(docUrl, { suspense: true });

  return (
    <div className="mx-auto max-w-xl space-y-3">
      {exercise ? (
        <h2 className="text-lg font-semibold text-slate-900">
          {exercise.exerciseName}
        </h2>
      ) : null}
      <ExerciseLogger exerciseUrl={docUrl} executing />
    </div>
  );
}

function ExerciseLoggerView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <div className="strength h-full overflow-y-auto bg-slate-50 p-4">
      <Suspense
        fallback={
          <p className="text-center text-xs text-slate-400">Loading…</p>
        }
      >
        <FocusedExercise docUrl={docUrl} />
      </Suspense>
    </div>
  );
}

export const ExerciseLoggerTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <ExerciseLoggerView docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
