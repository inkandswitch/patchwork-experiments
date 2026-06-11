import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { assignAutomergeFields } from "../automerge-fields";
import { findNextIncompleteSet } from "../workout-flow";
import {
  exerciseById,
  sessionSets,
  useFlatSessionMigration,
} from "../session-model";
import type { LoggedSet, WeightUnit, WorkoutSessionDoc } from "../types";
import { LoggedSetRow } from "./SetRow";

/**
 * Shows only the *current* set (next incomplete) of a workout session.
 * With the flat sets array this is a pure path address — one live-query
 * pattern segment:
 *
 *   automerge:<sessionDocId>/sets/{"completed":false}
 *
 * It re-resolves on every doc change, so completing the set advances the
 * panel automatically.
 */
export function CurrentSet({ sessionUrl }: { sessionUrl: AutomergeUrl }) {
  const sessionHandle = useDocHandle<WorkoutSessionDoc>(sessionUrl, {
    suspense: true,
  });
  const [session] = useDocument<WorkoutSessionDoc>(sessionUrl, {
    suspense: true,
  });

  useFlatSessionMigration(sessionHandle, session);

  if (!session) return null;

  const next = findNextIncompleteSet(sessionSets(session));
  if (!next) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {session.status === "completed"
          ? "Workout complete."
          : "All sets done — time to finish your workout!"}
      </div>
    );
  }

  const exercise = exerciseById(session, next.exerciseId);
  if (!exercise) return null;

  const exerciseSets = sessionSets(session).filter(
    (set) => set.exerciseId === next.exerciseId,
  );
  const setNumber = exerciseSets.findIndex((set) => set.id === next.id);
  const unit: WeightUnit =
    exercise.unit ?? session.weightUnit ?? "kg";

  const setHandle = sessionHandle.sub("sets", {
    completed: false,
  }) as DocHandle<LoggedSet>;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-900">
          {exercise.exerciseName}
        </span>
        <span className="shrink-0 text-xs text-slate-500">
          Set {setNumber + 1} of {exerciseSets.length}
        </span>
      </div>
      <LoggedSetRow
        set={next}
        index={setNumber}
        unit={unit}
        executing
        isCurrent
        onChange={(patch) =>
          setHandle.change((s) => assignAutomergeFields(s, patch))
        }
        onToggleComplete={() =>
          setHandle.change((s) => {
            s.completed = !s.completed;
          })
        }
      />
    </div>
  );
}
