import type { Doc, Heads } from "@automerge/automerge"
import { automerge } from "../../../shared/automerge"

/**
 * Where two drafts of a notebook parted: the heads of what's in the history
 * of both `a` and `b`, which each draft's changes are shown against. Drafts
 * are clones of each other, so they share the history up to there. Not
 * always the fewest heads that will do: one may be in the history of
 * another, which reads the same. Both docs have all of them. Empty when they
 * share nothing. (As strand's file tool finds it, packages/file/src/components/ancestor.ts.)
 */
export function commonAncestor(a: Doc<unknown>, b: Doc<unknown>): Heads {
  const A = automerge()
  const aHeads = A.getHeads(a)
  const bHeads = A.getHeads(b)
  if (A.hasHeads(a, bHeads)) return bHeads
  if (A.hasHeads(b, aHeads)) return aHeads
  // Both, to tell what's only in b: what came after a's heads.
  const both = A.merge(A.clone(b), a)
  const onlyB = A.getChangesMetaSince(both, aHeads)
  const only = new Set(onlyB.map(change => change.hash))
  // What's shared ends where b's own changes start, or at b's heads.
  const heads = new Set(bHeads)
  for (const change of onlyB) for (const dep of change.deps) heads.add(dep)
  return [...heads].filter(hash => !only.has(hash))
}
