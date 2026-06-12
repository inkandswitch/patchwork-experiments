import {
  useDocHandle,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { LoggedSet, WorkoutSessionDoc } from "../types";
import { SingleSet } from "./SingleSet";

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

  return <SingleSet setUrl={currentSetUrl} />;
}
