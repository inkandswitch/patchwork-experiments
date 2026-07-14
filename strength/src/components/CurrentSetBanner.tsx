import type { AutomergeUrl } from "@automerge/automerge-repo";
import { CurrentSet } from "./CurrentSet";

/**
 * Labeled banner card showing only the session's current set (via the
 * `strength-set` tool at `sets/{"completed":false}`). Used on the gym
 * home page and at the top of an active workout session.
 */
export function CurrentSetBanner({
  sessionUrl,
  label = "Up next",
}: {
  sessionUrl: AutomergeUrl;
  label?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-emerald-200 bg-white">
      <div className="border-b border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
        {label}
      </div>
      <div className="p-3">
        <CurrentSet sessionUrl={sessionUrl} />
      </div>
    </div>
  );
}
