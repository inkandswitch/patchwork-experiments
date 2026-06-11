import type { LoggedSet } from "./types";

export function setRowId(setId: string): string {
  return `strength-set-${setId}`;
}

/**
 * The next incomplete set in execution order — optionally the one after
 * `afterId` (so "Next" can step past the set just completed).
 */
export function findNextIncompleteSet(
  sets: LoggedSet[],
  afterId?: string | null,
): LoggedSet | null {
  const incomplete = sets.filter((set) => !set.completed);
  if (!incomplete.length) return null;
  if (!afterId) return incomplete[0];

  const currentIndex = incomplete.findIndex((set) => set.id === afterId);
  if (currentIndex < 0) return incomplete[0];
  return incomplete[currentIndex + 1] ?? null;
}

export function restSecondsForSet(
  set: LoggedSet,
  sessionDefault = 90,
): number {
  const value = set.restSeconds ?? sessionDefault;
  return value > 0 ? value : 90;
}
