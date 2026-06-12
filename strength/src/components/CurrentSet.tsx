import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { LoggedSet, WorkoutSessionDoc } from "../types";

/**
 * Shows only the *current* set (next incomplete) of a workout session.
 * With the flat sets array this is a pure path address — one live-query
 * pattern segment:
 *
 *   automerge:<sessionDocId>/sets/{"completed":false}
 *
 * It re-resolves on every doc change, so completing the set advances the
 * panel automatically. The same address doubles as the "any sets left?"
 * check: when nothing matches, the doc at that URL is `undefined`.
 *
 * Rendering is delegated to the `strength-set` tool via `patchwork-view`,
 * so this wrapper only decides *which* address to show (and the
 * session-level empty states).
 */
export function CurrentSet({ sessionUrl }: { sessionUrl: AutomergeUrl }) {
  const sessionHandle = useDocHandle<WorkoutSessionDoc>(sessionUrl, {
    suspense: true,
  });
  const [session] = useDocument<WorkoutSessionDoc>(sessionUrl, {
    suspense: true,
  });

  const currentSetUrl = sessionHandle.sub("sets", { completed: false }).url;
  const [currentSet] = useDocument<LoggedSet>(currentSetUrl, {
    suspense: false,
  });

  if (!session) return null;

  if (!currentSet) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {session.status === "completed"
          ? "Workout complete."
          : "All sets done — time to finish your workout!"}
      </div>
    );
  }

  // The set tool renders just the row; context (which exercise, how far
  // along) is the wrapper's job.
  const exercise = session.exercises.find(
    (ex) => ex.id === currentSet.exerciseId,
  );
  const exerciseSets = (session.sets ?? []).filter(
    (s) => s.exerciseId === currentSet.exerciseId,
  );
  const setNumber = exerciseSets.findIndex((s) => s.id === currentSet.id);

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
      <patchwork-view
        key={currentSetUrl}
        doc-url={currentSetUrl}
        tool-id="strength-set"
        class="block"
      />
    </div>
  );
}
