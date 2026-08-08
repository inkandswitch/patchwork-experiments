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
      <p className="st-loading">
        This exercise is no longer part of the session.
      </p>
    );
  }

  return (
    <div className="st-column">
      <div className="st-row">
        <h2 className="st-heading">
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
    <div className="strength st-page">
      <Suspense
        fallback={
          <p className="st-loading">Loading…</p>
        }
      >
        <FocusedExercise docUrl={docUrl} />
      </Suspense>
    </div>
  );
}

export const ExerciseLoggerTool = makeTool(ExerciseLoggerView);
