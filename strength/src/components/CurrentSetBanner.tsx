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
    <div className="st-banner">
      <div className="st-banner__label">
        {label}
      </div>
      <div className="st-banner__body">
        <CurrentSet sessionUrl={sessionUrl} />
      </div>
    </div>
  );
}
