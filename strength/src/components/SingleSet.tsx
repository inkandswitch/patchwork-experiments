import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { assignAutomergeFields } from "../automerge-fields";
import { rootDocUrl } from "../workout-flow";
import type {
  LoggedExercise,
  LoggedSet,
  WeightUnit,
  WorkoutSessionDoc,
} from "../types";
import { LoggedSetRow } from "./SetRow";

/**
 * Renders exactly one logged set, addressed by a path URL into a session:
 *
 *   automerge:<docId>/sets/{"id":"<setId>"}        — a pinned set
 *   automerge:<docId>/sets/{"completed":false}     — live query: current set
 *
 * The set itself is the only thing this component is "about" — the
 * exercise name and unit come from a *synthesized sibling sub-handle*
 * (`exercises/{"id":<set.exerciseId>}`), and set numbering from the
 * `sets` array sub-handle, rather than loading and scanning the whole
 * session document.
 */
export function SingleSet({
  setUrl,
  onToggled,
}: {
  setUrl: AutomergeUrl;
  onToggled?: (set: LoggedSet, completed: boolean) => void;
}) {
  const setHandle = useDocHandle<LoggedSet>(setUrl, { suspense: true });
  const [set] = useDocument<LoggedSet>(setUrl, { suspense: true });

  // Root handle is used only to synthesize sibling sub-handles.
  const rootHandle = useDocHandle<WorkoutSessionDoc>(rootDocUrl(setUrl), {
    suspense: true,
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

  const exerciseSets = (allSets ?? []).filter(
    (s) => s.exerciseId === set.exerciseId,
  );
  const setNumber = exerciseSets.findIndex((s) => s.id === set.id);
  const unit: WeightUnit = exercise?.unit ?? "kg";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-900">
          {exercise?.exerciseName ?? "Unknown exercise"}
        </span>
        {setNumber >= 0 ? (
          <span className="shrink-0 text-xs text-slate-500">
            Set {setNumber + 1} of {exerciseSets.length}
          </span>
        ) : null}
      </div>
      <LoggedSetRow
        set={set}
        index={Math.max(0, setNumber)}
        unit={unit}
        executing
        isCurrent
        onChange={(patch) =>
          setHandle.change((s) => assignAutomergeFields(s, patch))
        }
        onToggleComplete={() => {
          const completed = !set.completed;
          setHandle.change((s) => {
            s.completed = completed;
          });
          onToggled?.(set, completed);
        }}
      />
    </div>
  );
}
