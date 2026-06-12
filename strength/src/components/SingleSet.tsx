import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { assignAutomergeFields } from "../automerge-fields";
import { findNextIncompleteSet, rootDocUrl } from "../workout-flow";
import type {
  LoggedExercise,
  LoggedSet,
  WeightUnit,
  WorkoutSessionDoc,
} from "../types";
import { LoggedSetRow } from "./SetRow";

/**
 * THE set renderer for the whole app — every set the user can interact
 * with is this component, rendered via the `strength-set` tool. Swap the
 * implementation here to experiment with alternative set UIs everywhere
 * at once.
 *
 * Addressed by a path URL into a session:
 *
 *   automerge:<docId>/sets/{"id":"<setId>"}        — a pinned set
 *   automerge:<docId>/sets/{"completed":false}     — live query: current set
 *
 * Renders just the row — no exercise-name header; the embedding context
 * provides that. Everything else is derived from the document:
 * - unit: sibling exercise sub-handle (`exercises/{"id":…}`)
 * - set number: position within the exercise's sets
 * - editability: session status (in-progress vs completed)
 * - highlight: whether this is the next incomplete set
 */
export function SingleSet({ setUrl }: { setUrl: AutomergeUrl }) {
  const setHandle = useDocHandle<LoggedSet>(setUrl, { suspense: true });
  const [set] = useDocument<LoggedSet>(setUrl, { suspense: true });

  // Root handle synthesizes sibling sub-handles; the root doc supplies
  // session-level facts (status, fallback unit).
  const rootUrl = rootDocUrl(setUrl);
  const rootHandle = useDocHandle<WorkoutSessionDoc>(rootUrl, {
    suspense: true,
  });
  const [session] = useDocument<WorkoutSessionDoc>(rootUrl, {
    suspense: false,
  });

  const exerciseUrl = set
    ? (
        rootHandle.sub("exercises", {
          id: set.exerciseId,
        }) as DocHandle<LoggedExercise>
      ).url
    : undefined;
  const [exercise] = useDocument<LoggedExercise>(exerciseUrl, {
    suspense: false,
  });

  const setsUrl = (rootHandle.sub("sets") as DocHandle<LoggedSet[]>).url;
  const [allSets] = useDocument<LoggedSet[]>(setsUrl, { suspense: false });

  if (!set) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
        No set at this address — it may be done or removed.
      </div>
    );
  }

  const sets = allSets ?? [];
  const exerciseSets = sets.filter((s) => s.exerciseId === set.exerciseId);
  const setNumber = exerciseSets.findIndex((s) => s.id === set.id);
  const unit: WeightUnit = exercise?.unit ?? session?.weightUnit ?? "kg";
  const executing = session?.status === "in_progress";
  const isCurrent = executing && findNextIncompleteSet(sets)?.id === set.id;

  return (
    <LoggedSetRow
      set={set}
      index={Math.max(0, setNumber)}
      unit={unit}
      executing={executing}
      isCurrent={isCurrent}
      onChange={(patch) =>
        setHandle.change((s) => assignAutomergeFields(s, patch))
      }
      onToggleComplete={() =>
        setHandle.change((s) => {
          s.completed = !s.completed;
        })
      }
    />
  );
}
