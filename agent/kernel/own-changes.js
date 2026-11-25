/**
 * Which changes a session made: the change hashes its tools' writes produced.
 *
 * Every write a session's tools make goes through its guarded repo
 * (kernel/kernel-repo.js), which notes the heads the write added here. A watch
 * (tools/watch.js) compares the heads a change event adds with this set: all
 * of them the session's own, and the session is hearing about itself; any
 * other, and someone else wrote — a person in this same tab, a daemon, another
 * session. Change hashes name changes everywhere, so this needs no actor ids
 * and no guess about who was busy when.
 *
 * In memory, per page, on globalThis (as runners/registry.js keeps its runners), so a
 * newer version of this code loaded in place still knows what the older one
 * wrote. A reload forgets; what is lost is only that, not the edits.
 */

/** Most hashes kept per session; the oldest go first. */
export const OWN_KEPT = 5000

const sessions = (globalThis.__patchworkAgentOwnChanges ??= new Map()) // sessionUrl -> Set, oldest first

export function rememberOwn(sessionUrl, hashes) {
  if (!sessionUrl || !hashes?.length) return
  let own = sessions.get(sessionUrl)
  if (!own) sessions.set(sessionUrl, (own = new Set()))
  for (const hash of hashes) own.add(hash)
  for (const hash of own) {
    if (own.size <= OWN_KEPT) break
    own.delete(hash)
  }
}

export function isOwn(sessionUrl, hash) {
  return !!sessions.get(sessionUrl)?.has(hash)
}

/** The heads `after` has that `before` did not: the changes one mutation added. */
export function addedHeads(beforeHeads, afterHeads) {
  const was = new Set(beforeHeads ?? [])
  return (afterHeads ?? []).filter((h) => !was.has(h))
}
