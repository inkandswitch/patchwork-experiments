import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Suspense } from "react";
import { ExerciseInfoButton } from "./components/ExerciseInfoButton";
import { ExerciseLogger } from "./components/ExerciseLogger";
import { makeTool } from "./make-tool";
import { rootDocUrl } from "./workout-flow";
import type { LoggedExercise } from "./types";

/**
 * Standalone tool for a path-addressed exercise sub-document. Open it on a
 * URL like:
 *
 *   automerge:<sessionDocId>/exercises/{"id":"<exerciseId>"}
 *
 * The sub-document carries the exercise *metadata* (sets live flat on the
 * session), so the path identifies which exercise to focus and the logger
 * binds back to the root session document for the sets.
 */

function FocusedExercise({ docUrl }: { docUrl: AutomergeUrl }) {
  const [exercise] = useDocument<LoggedExercise>(docUrl, { suspense: true });

  if (!exercise) {
    return (
      <p className="text-center text-xs text-slate-400">
        This exercise is no longer part of the session.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          {exercise.exerciseName}
        </h2>
        <ExerciseInfoButton
          exerciseUrl={exercise.exerciseUrl}
          exerciseName={exercise.exerciseName}
        />
      </div>
      <ExerciseLogger
        sessionUrl={rootDocUrl(docUrl)}
        exerciseId={exercise.id}
        executing
      />
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

export const ExerciseLoggerTool = makeTool(ExerciseLoggerView);
