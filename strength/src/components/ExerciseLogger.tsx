import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type {
  LoggedExercise,
  WeightUnit,
  WorkoutSessionDoc,
} from "../types";
import {
  exerciseById,
  newLoggedSet,
  pushSetForExercise,
  setsForExercise,
} from "../session-model";
import { setRowId } from "../workout-flow";
import { UnitToggle } from "./UnitToggle";

/**
 * Set-logging panel for one exercise of a session. Each row is the
 * `strength-set` tool embedded at that set's path address:
 *
 *   automerge:<sessionDocId>/sets/{"id":"…"}
 *
 * so the set renderer can be swapped app-wide by changing one tool. The
 * logger itself only owns exercise-level concerns: the unit toggle and
 * adding sets.
 */
export function ExerciseLogger({
  sessionUrl,
  exerciseId,
  executing,
  fallbackUnit = "kg",
}: {
  sessionUrl: AutomergeUrl;
  exerciseId: string;
  executing?: boolean;
  /** Unit to display when the exercise doesn't carry its own. */
  fallbackUnit?: WeightUnit;
}) {
  const sessionHandle = useDocHandle<WorkoutSessionDoc>(sessionUrl, {
    suspense: true,
  });
  const [session] = useDocument<WorkoutSessionDoc>(sessionUrl, {
    suspense: true,
  });

  const exercise = session ? exerciseById(session, exerciseId) : undefined;
  if (!session || !exercise) {
    return (
      <p className="text-center text-xs text-slate-400">
        This exercise is no longer part of the session.
      </p>
    );
  }

  const sets = setsForExercise(session, exerciseId);
  const unit: WeightUnit = exercise.unit ?? fallbackUnit;

  return (
    <div className="space-y-1">
      {executing ? (
        <div className="mb-1 flex justify-end">
          <UnitToggle
            value={unit}
            onChange={(u) =>
              (
                sessionHandle.sub("exercises", {
                  id: exerciseId,
                }) as DocHandle<LoggedExercise>
              ).change((ex) => {
                ex.unit = u;
              })
            }
          />
        </div>
      ) : null}
      {sets.map((set) => (
        <div key={set.id} id={setRowId(set.id)}>
          <patchwork-view
            doc-url={sessionHandle.sub("sets", { id: set.id }).url}
            tool-id="strength-set"
            class="block"
          />
        </div>
      ))}
      {executing ? (
        <button
          type="button"
          onClick={() =>
            sessionHandle.change((draft) => {
              pushSetForExercise(draft, exerciseId, newLoggedSet(exerciseId));
            })
          }
          className="text-xs text-emerald-700 hover:underline"
        >
          + Add set
        </button>
      ) : null}
    </div>
  );
}
