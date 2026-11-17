import type { Doc, Heads } from '@automerge/automerge';
import type { Automerge } from './model/automerge';

/** The parts used, so the parent page's Automerge fits whichever version it is. */
type History = Pick<Automerge, 'getHeads' | 'hasHeads' | 'merge' | 'clone' | 'getChangesMetaSince'>;

/**
 * Where two versions of a document forked: the heads of the changes they
 * share, in both histories. Either version's own heads when it is an
 * ancestor of the other. Otherwise the heads may name changes that are
 * ancestors of other ones in the list, which `view` and `diff` accept.
 *
 * `A` is passed in, so the parent page and the iframe can each use theirs.
 */
export function commonAncestor(A: History, ours: Doc<unknown>, theirs: Doc<unknown>): Heads {
  const oursHeads = A.getHeads(ours);
  const theirsHeads = A.getHeads(theirs);
  if (A.hasHeads(ours, theirsHeads)) return theirsHeads;
  if (A.hasHeads(theirs, oursHeads)) return oursHeads;
  // Every change of theirs that ours lacks, and the shared ones they build on.
  const merged = A.merge(A.clone(theirs), ours);
  const theirsOnly = A.getChangesMetaSince(merged, oursHeads);
  const only = new Set(theirsOnly.map(change => change.hash));
  const base = new Set(theirsHeads);
  for (const change of theirsOnly) for (const dep of change.deps) base.add(dep);
  return [...base].filter(hash => !only.has(hash)).sort();
}

/**
 * Whether the ancestor worked out when ours was at `since` still holds:
 * ours only gained changes theirs doesn't have, and none that came from it.
 */
export function ancestorHolds(A: History, ours: Doc<unknown>, theirs: Doc<unknown>, since: Heads): boolean {
  if (!A.hasHeads(ours, since)) return false;
  return !A.getChangesMetaSince(ours, since).some(change => A.hasHeads(theirs, [change.hash]));
}
