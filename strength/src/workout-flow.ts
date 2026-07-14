import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { LoggedSet } from "./types";

export function setRowId(setId: string): string {
  return `strength-set-${setId}`;
}

/**
 * The next incomplete set in execution order — optionally the one after
 * `afterId` (so "Next" can step past the set just completed).
 */
export function findNextIncompleteSet(
  sets: readonly LoggedSet[],
  afterId?: string | null,
): LoggedSet | null {
  const incomplete = sets.filter((set) => !set.completed);
  if (!incomplete.length) return null;
  if (!afterId) return incomplete[0];

  const currentIndex = incomplete.findIndex((set) => set.id === afterId);
  if (currentIndex < 0) return incomplete[0];
  return incomplete[currentIndex + 1] ?? null;
}

/**
 * Rest after a set. `restSeconds: 0` is meaningful — it marks a superset
 * transition ("go straight to the partner exercise").
 */
export function restSecondsForSet(
  set: LoggedSet,
  sessionDefault = 90,
): number {
  return set.restSeconds ?? sessionDefault;
}

/** Root document URL for a (possibly) path-addressed automerge URL. */
export function rootDocUrl(url: AutomergeUrl): AutomergeUrl {
  return url.split("/")[0] as AutomergeUrl;
}

/**
 * Display labels (A, B, C…) for superset groups, in order of first
 * appearance. Works for both template and session exercise lists.
 */
export function supersetLabels(
  exercises: { supersetGroup?: string }[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const exercise of exercises) {
    const group = exercise.supersetGroup;
    if (group && !labels.has(group)) {
      labels.set(group, String.fromCharCode(65 + labels.size));
    }
  }
  return labels;
}
