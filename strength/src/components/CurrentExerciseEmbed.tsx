import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { findNextIncompleteSet } from "../workout-flow";
import type { WorkoutSessionDoc } from "../types";

/**
 * Embeds the `strength-exercise-logger` tool (via `patchwork-view`) for the
 * exercise containing a session's next incomplete set. The embed is addressed
 * by a path URL into the session document, so it's a fully independent view —
 * edits made here merge with any other open view of the same session.
 */
export function CurrentExerciseEmbed({
  sessionUrl,
  label = "Up next",
}: {
  sessionUrl: AutomergeUrl;
  label?: string;
}) {
  const sessionHandle = useDocHandle<WorkoutSessionDoc>(sessionUrl, {
    suspense: true,
  });
  const [session] = useDocument<WorkoutSessionDoc>(sessionUrl, {
    suspense: true,
  });

  const next = session?.exercises
    ? findNextIncompleteSet(session.exercises)
    : null;
  if (!session || !next) return null;

  const subUrl = sessionHandle.sub("exercises", { id: next.exerciseId }).url;

  return (
    <div className="overflow-hidden rounded-lg border border-emerald-200 bg-white">
      <div className="border-b border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
        {label}
      </div>
      <patchwork-view
        key={subUrl}
        doc-url={subUrl}
        tool-id="strength-exercise-logger"
        class="block"
      />
    </div>
  );
}
