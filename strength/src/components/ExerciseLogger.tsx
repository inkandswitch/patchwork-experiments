import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { assignAutomergeFields } from "../automerge-fields";
import type {
  LoggedExercise,
  LoggedSet,
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
import { LoggedSetRow } from "./SetRow";

/**
 * Set-logging panel for one exercise of a session. Sets live flat on the
 * session doc (execution order), so the logger binds to the session and
 * filters by exercise id; each row's writes go through a path-addressed
 * sub-handle straight to its set:
 *
 *   automerge:<sessionDocId>/sets/{"id":"…"}
 */
export function ExerciseLogger({
  sessionUrl,
  exerciseId,
  executing,
  fallbackUnit = "kg",
  currentSetId,
  onSetToggled,
}: {
  sessionUrl: AutomergeUrl;
  exerciseId: string;
  executing?: boolean;
  /** Unit to display when the exercise doesn't carry its own. */
  fallbackUnit?: WeightUnit;
  /** Id of the "current" set to highlight, if any. */
  currentSetId?: string | null;
  /** Notifies the host when a set is (un)completed, e.g. to run a rest timer. */
  onSetToggled?: (set: LoggedSet, completed: boolean) => void;
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

  const setSub = (setId: string) =>
    sessionHandle.sub("sets", { id: setId }) as DocHandle<LoggedSet>;

  const toggleSet = (set: LoggedSet) => {
    const willComplete = !set.completed;
    setSub(set.id).change((s) => {
      s.completed = willComplete;
    });
    onSetToggled?.(set, willComplete);
  };

  return (
    <div className="space-y-1">
      {executing ? (
        <div className="mb-1 flex justify-end">
          <div className="flex overflow-hidden rounded-md border border-slate-200 text-xs">
            {(["kg", "lb"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() =>
                  (
                    sessionHandle.sub("exercises", {
                      id: exerciseId,
                    }) as DocHandle<LoggedExercise>
                  ).change((ex) => {
                    ex.unit = u;
                  })
                }
                className={`px-2.5 py-1 ${
                  unit === u
                    ? "bg-emerald-600 font-medium text-white"
                    : "bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[2rem_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-slate-400">
          <span>✓</span>
          <span>Reps</span>
          <span>Weight ({unit})</span>
          <span>RPE</span>
          <span>#</span>
        </div>
      )}
      {sets.map((set, setIndex) => (
        <LoggedSetRow
          key={set.id}
          rowId={setRowId(set.id)}
          isCurrent={currentSetId === set.id}
          set={set}
          index={setIndex}
          unit={unit}
          executing={executing}
          onChange={(patch) =>
            setSub(set.id).change((s) => {
              assignAutomergeFields(s, patch);
            })
          }
          onToggleComplete={() => toggleSet(set)}
        />
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
