import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { assignAutomergeFields } from "../automerge-fields";
import type { LoggedExercise, LoggedSet, WeightUnit } from "../types";
import { LoggedSetRow } from "./SetRow";

/**
 * Experimental: a set-logging panel bound to a *path-addressed sub-document*
 * (e.g. `automerge:<docId>/exercises/{"id":"…"}`). All reads and writes go
 * through the sub-handle — the component needs no callbacks from the parent
 * to mutate its data, only optional orchestration hooks (rest timer, set
 * focus) which remain session-level concerns.
 *
 * The pattern segment (`{"id": …}`) addresses the exercise by its stable id,
 * so the binding survives concurrent reorders/deletes of sibling exercises.
 */
export function ExerciseLogger({
  exerciseUrl,
  executing,
  fallbackUnit = "kg",
  currentSetIndex,
  rowIdForSet,
  onSetToggled,
}: {
  /** Path-addressed sub-document URL pointing at one LoggedExercise. */
  exerciseUrl: AutomergeUrl;
  executing?: boolean;
  /** Unit to display when the exercise doesn't carry its own. */
  fallbackUnit?: WeightUnit;
  /** Index of the "current" set to highlight, if any. */
  currentSetIndex?: number | null;
  /** Stable DOM ids for scroll/focus targeting from the parent. */
  rowIdForSet?: (setIndex: number) => string;
  /** Notifies the host when a set is (un)completed, e.g. to run a rest timer. */
  onSetToggled?: (setIndex: number, completed: boolean, set: LoggedSet) => void;
}) {
  const handle = useDocHandle<LoggedExercise>(exerciseUrl, { suspense: true });
  const [exercise] = useDocument<LoggedExercise>(exerciseUrl, {
    suspense: true,
  });

  // The pattern no longer matches (exercise was removed from the session).
  if (!exercise) {
    return (
      <p className="text-center text-xs text-slate-400">
        This exercise is no longer part of the session.
      </p>
    );
  }

  const unit: WeightUnit = exercise.unit ?? fallbackUnit;

  const toggleSet = (setIndex: number) => {
    const set = exercise.sets[setIndex];
    if (!set) return;
    const willComplete = !set.completed;
    handle.change((ex) => {
      ex.sets[setIndex].completed = willComplete;
    });
    onSetToggled?.(setIndex, willComplete, set);
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
                  handle.change((ex) => {
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
      {exercise.sets.map((set, setIndex) => (
        <LoggedSetRow
          key={setIndex}
          rowId={rowIdForSet?.(setIndex)}
          isCurrent={currentSetIndex === setIndex}
          set={set}
          index={setIndex}
          unit={unit}
          executing={executing}
          onChange={(patch) =>
            handle.change((ex) => {
              assignAutomergeFields(ex.sets[setIndex], patch);
            })
          }
          onToggleComplete={() => toggleSet(setIndex)}
        />
      ))}
      {executing ? (
        <button
          type="button"
          onClick={() =>
            handle.change((ex) => {
              ex.sets.push({ completed: false });
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
