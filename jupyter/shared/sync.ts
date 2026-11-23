/**
 * Before notebook_run reads a notebook, make sure this realm has what the sync
 * server has of it. Without this a run can start on a notebook whose latest
 * changes (a just-added import) haven't arrived yet, and record an error run.
 *
 * What automerge-repo 2.6 (subduction) gives a page, all feature-detected here:
 *   repo.find(url)                         resolves with a ready handle (handle.whenReady
 *                                          is deprecated: handles are always ready), but
 *                                          "ready" means "has some version", not "the server's".
 *   repo.isSubductionConnected()           whether the sync server connection is up.
 *   repo.connectedSubductionPeerIds()      the server's peer ids, as StorageIds.
 *   handle.isCaughtUpWith(storageId)       true when we hold every commit the server last
 *                                          advertised for this document; undefined before the
 *                                          server has advertised anything.
 *   handle "remote-heads" / "heads-changed" events: the server advertised heads / we got commits.
 *   repo.resyncSubduction(documentId)      asks for a fresh sync round.
 *
 * Caught up is pull-completeness only (what the server has that we lack); that is the
 * direction a run needs. It never throws, and never waits past `timeoutMs`: a run on
 * what this device has is better than no run, and the result says which it was.
 */

export type SyncOutcome =
  | { status: "synced" }
  /** No server connection (offline, or a repo without one): the run uses what is here. */
  | { status: "unconnected" }
  /** The server hadn't caught us up within the time. */
  | { status: "timeout" }

type HandleLike = {
  documentId?: string
  isCaughtUpWith?(storageId: string): boolean | undefined
  whenReady?(): Promise<unknown>
  on?(event: string, listener: () => void): unknown
  off?(event: string, listener: () => void): unknown
}
type RepoLike = {
  isSubductionConnected?(): boolean
  connectedSubductionPeerIds?(): Promise<string[]>
  resyncSubduction?(documentId: string): void
}

export async function syncedWithServer(repo: RepoLike, handle: HandleLike, { timeoutMs = 4000 }: { timeoutMs?: number } = {}): Promise<SyncOutcome> {
  try {
    await handle.whenReady?.()
  } catch {
    // deprecated and, for a handle from find(), already satisfied
  }
  if (typeof handle.isCaughtUpWith !== "function" || typeof repo.connectedSubductionPeerIds !== "function") return { status: "unconnected" }
  if (repo.isSubductionConnected && !repo.isSubductionConnected()) return { status: "unconnected" }
  let peers: string[]
  try {
    peers = await repo.connectedSubductionPeerIds()
  } catch {
    return { status: "unconnected" }
  }
  if (!peers.length) return { status: "unconnected" }

  const caughtUp = () => peers.every(peer => handle.isCaughtUpWith!(peer) === true)
  if (caughtUp()) return { status: "synced" }

  // Not caught up, or the server hasn't said anything about this document yet: ask for a round, then wait for it.
  if (handle.documentId) {
    try {
      repo.resyncSubduction?.(handle.documentId)
    } catch {
      // best effort
    }
  }
  return new Promise<SyncOutcome>(resolve => {
    const done = (outcome: SyncOutcome) => {
      clearTimeout(timer)
      handle.off?.("remote-heads", check)
      handle.off?.("heads-changed", check)
      resolve(outcome)
    }
    const check = () => {
      if (caughtUp()) done({ status: "synced" })
    }
    const timer = setTimeout(() => done({ status: "timeout" }), timeoutMs)
    handle.on?.("remote-heads", check)
    handle.on?.("heads-changed", check)
  })
}

/** What to tell the agent when the run couldn't confirm it had the server's version. */
export function syncNote(outcome: SyncOutcome): string | null {
  if (outcome.status === "timeout") return "the notebook hadn't finished syncing with the server before the run started (waited a few seconds), so a change made elsewhere a moment ago may be missing; if an import is missing, rerun."
  if (outcome.status === "unconnected") return "this realm isn't connected to the sync server, so the notebook is as this device last had it."
  return null
}
