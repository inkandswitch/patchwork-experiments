/** The lease: which runner may drive a session, and when another may take over. */

/**
 * A lease is live if its heartbeat is recent enough — by the reader's clock
 * against the writer's. Good enough for display and for one machine; across
 * machines whose clocks disagree it is wrong, and a runner deciding whether
 * it may take a session over asks a LeaseWatch instead.
 */
export function leaseIsLive(lease, { now = Date.now(), staleAfterMs = 15000 } = {}) {
  if (!lease || !lease.at) return false
  return now - lease.at < staleAfterMs
}

/** How long ago, by its own stamp, a lease seen for the first time must be to count as dead on sight. */
export const DEAD_ON_SIGHT_MS = 10 * 60 * 1000

/**
 * Is a lease live, as one observer sees it — without trusting anyone's clock?
 *
 * A heartbeat stamps the lease with the holder's clock, and comparing that
 * with ours is only right when the two clocks agree. Two browsers on two
 * machines need not: one running a minute fast sees every lease the other
 * holds as stale, takes the session over, and both run it.
 *
 * So liveness is judged by change, on the observer's own clock: a lease is
 * live until its value — holder, generation and stamp — has gone unchanged
 * for `staleAfterMs` of OUR time. A holder heartbeating every few seconds
 * keeps changing it, whatever its clock says; a dead one stops.
 *
 * One exception, so that a session whose runner died long ago resumes the
 * moment it is opened rather than after a wait: the first value this watch
 * ever sees, if its own stamp is DEAD_ON_SIGHT_MS old by our clock, is dead.
 * That trusts clocks to agree to within ten minutes, and only for leases
 * nobody has been seen renewing. Once the watch has seen a lease change, it
 * goes by change alone.
 *
 * Sample it often (every change and every heartbeat); a watch sampled late
 * errs towards live, which delays a takeover and never doubles one.
 */
export class LeaseWatch {
  constructor({ now = () => Date.now(), staleAfterMs = 15000, deadOnSightMs = DEAD_ON_SIGHT_MS } = {}) {
    this.now = now
    this.staleAfterMs = staleAfterMs
    this.deadOnSightMs = deadOnSightMs
    this.key = null
    this.since = 0
    this.first = true
  }

  live(lease) {
    if (!lease) return false
    const t = this.now()
    const key = `${lease.runner}\u0000${lease.generation}\u0000${lease.at}`
    if (key !== this.key) {
      if (this.key !== null) this.first = false
      this.key = key
      this.since = t
    }
    if (t - this.since >= this.staleAfterMs) return false
    if (this.first && typeof lease.at === "number" && t - lease.at >= this.deadOnSightMs) return false
    return true
  }
}

/** The liveness test `opts` asks for: a watch's, or the clock-comparing one. */
export function livenessOf(opts = {}) {
  if (typeof opts.live === "function") return opts.live
  return (lease) => leaseIsLive(lease, opts)
}

/**
 * May `runnerUrl` claim this session?
 *
 * Yes when there is no lease, when the lease is already ours, or when the
 * current holder has gone quiet. Takeover bumps the generation, which is how a
 * stale runner discovers it has been displaced (see `holdsLease`).
 */
export function canClaim(doc, runnerUrl, opts = {}) {
  const lease = doc.lease
  if (!lease) return true
  if (lease.runner === runnerUrl) return true
  return !livenessOf(opts)(lease)
}

/**
 * Claim the session for `runnerUrl`, inside a change.
 *
 * Every claim that is not a renewal gets a generation never used in this
 * session before, counted in `lastGeneration`, which outlives the lease.
 * Counting from the lease alone would start again at 1 after a release: a
 * runner that lost a session mid-reply and took it up again once it had been
 * released would have its old generation back, and its own dead reply and
 * cut-off calls would look like live work it was doing.
 */
export function claimLease(doc, runnerUrl, now = Date.now()) {
  const prev = doc.lease
  const generation = prev && prev.runner === runnerUrl ? prev.generation : Math.max(prev?.generation ?? 0, doc.lastGeneration ?? 0) + 1
  doc.lease = { runner: runnerUrl, at: now, generation }
  if ((doc.lastGeneration ?? 0) < generation) doc.lastGeneration = generation
  return doc.lease
}

/**
 * Does this runner still hold the lease at this generation?
 *
 * Called before every write that has side effects. A runner that lost a race
 * sees a bumped generation and stands down rather than double-executing.
 */
export function holdsLease(doc, runnerUrl, generation) {
  const lease = doc.lease
  return !!lease && lease.runner === runnerUrl && lease.generation === generation
}
