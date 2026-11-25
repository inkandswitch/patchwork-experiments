/**
 * Runners outlive the views that started them.
 *
 * The obvious way to write this — create a runner in the render function, stop
 * it in the cleanup function — quietly makes navigation destructive: moving to
 * another document unmounts the tool, cleanup aborts the turn, and work stops
 * for no reason anyone asked for. The page is still open. The repo is still
 * there. The session document is still there. Only the *view* went away.
 *
 * So runners live here, keyed by session, and views attach to and detach from
 * them. A view closing detaches; it does not stop anything. The runner keeps
 * its lease, keeps writing to the document, and any view that opens that
 * session later — in this tab or another — picks up the work in progress,
 * because the transcript was never in the view to begin with.
 *
 * What this does NOT solve: closing the last tab. Nothing in a page survives
 * that. A SharedWorker survives navigation but dies with its last client too;
 * only a runner outside the browser is genuinely durable.
 */

/**
 * Which build of this code made a runner: its module URL, which changes with
 * every version Patchwork loads.
 */
export const CODE_VERSION = import.meta.url

/**
 * sessionUrl -> { runner, ctx, viewers:Set, listeners:Set, idleSince, version }
 *
 * Kept on globalThis, not in this module. Patchwork reloads a package in place
 * when a new version arrives, and a reloaded module starts with nothing: its
 * own view came up with the new code while the old runner, with the old code,
 * went on running the session unseen — and sent the model a message without
 * the image attached to it, because the old code did not know attachments.
 * Here, the new code finds the old runner and takes over from it (ensureRunner).
 */
const live = (globalThis.__patchworkAgentRunners ??= new Map())

/** How long a runner with no viewers and nothing to do is kept before reaping. */
export const IDLE_GRACE_MS = 5 * 60 * 1000

/** Most sessions to keep running at once. */
export const MAX_LIVE_RUNNERS = 8

export function getEntry(sessionUrl) {
  return live.get(sessionUrl) ?? null
}

export function liveCount() {
  return live.size
}

/** How many of this page's runners are mid-run, other than the one asking. */
export function busyCount(except = null) {
  let n = 0
  for (const entry of live.values()) if (entry.runner && entry.runner !== except && entry.runner.running) n++
  return n
}

/**
 * Register a runner for a session, or return the one already running it.
 *
 * `create` is only called when there is no runner yet, and is awaited under a
 * lock so two views opening at once cannot start two runners for one session.
 */
export async function ensureRunner(sessionUrl, create) {
  const found = live.get(sessionUrl)
  // A runner from another version of this code: it finishes the turn it is
  // in and stops, and this version runs the session from here.
  if (found?.runner && found.version !== CODE_VERSION) {
    live.delete(sessionUrl)
    const old = found.runner
    if (typeof old.retire === "function") old.retire(() => found.dispose?.())
    else {
      old.stop?.()
      found.dispose?.()
    }
  }
  const existing = live.get(sessionUrl)
  if (existing?.runner) return existing
  if (existing?.creating) {
    await existing.creating
    return live.get(sessionUrl)
  }

  const entry = { runner: null, ctx: null, viewers: new Set(), listeners: new Set(), idleSince: null, version: CODE_VERSION }
  entry.creating = (async () => {
    const made = await create((event) => {
      // Fan an event out to every attached view.
      for (const listener of [...entry.listeners]) {
        try {
          listener(event)
        } catch {
          /* a broken view must not break the runner */
        }
      }
    })
    entry.runner = made?.runner ?? made
    entry.ctx = made?.ctx ?? null
    // Anything the runner owns for its whole life — notably its subscription to
    // the session document — is released here, not by whichever view happened
    // to create it.
    entry.dispose = made?.dispose ?? null
    entry.creating = null
    return entry
  })()

  live.set(sessionUrl, entry)
  await entry.creating
  reapIdle()
  return live.get(sessionUrl)
}

/**
 * Attach a view. Returns a detach function that leaves the runner alone.
 *
 * The element is handed over too, because host-tier tools need somewhere to
 * mount; when the last view detaches it is cleared, and those tools fall back
 * to the page.
 */
export function attachView(sessionUrl, { element = null, onEvent = null } = {}) {
  const entry = live.get(sessionUrl)
  if (!entry) return () => {}

  const token = Symbol("view")
  entry.viewers.add(token)
  entry.idleSince = null
  if (onEvent) entry.listeners.add(onEvent)
  if (element && entry.ctx) entry.ctx.element = element

  return () => {
    entry.viewers.delete(token)
    if (onEvent) entry.listeners.delete(onEvent)

    if (entry.viewers.size === 0) {
      // Nothing is watching. Keep working, but stop pointing host-tier tools at
      // an element that has been removed from the page.
      if (entry.ctx) entry.ctx.element = null
      entry.idleSince = Date.now()
    }
  }
}

/** Stop one runner and forget it. */
export function stopRunner(sessionUrl) {
  const entry = live.get(sessionUrl)
  if (!entry) return false
  try {
    entry.runner?.stop()
  } catch {
    /* already gone */
  }
  try {
    entry.dispose?.()
  } catch {
    /* already gone */
  }
  live.delete(sessionUrl)
  return true
}

/** A session a tool can still wake is listening, not idle (kernel/events.js). */
const listening = (entry) => entry.ctx?.events?.listening() > 0

/**
 * Reap runners nobody is watching and which have nothing left to do.
 *
 * A runner still working is never reaped, however long it has been unwatched —
 * that is the entire point of the module.
 */
export function reapIdle({ now = Date.now(), graceMs = IDLE_GRACE_MS } = {}) {
  const reaped = []

  for (const [url, entry] of live) {
    if (entry.viewers.size > 0) continue
    if (entry.runner?.running) continue
    if (listening(entry)) continue
    if (entry.idleSince && now - entry.idleSince > graceMs) reaped.push(url)
  }

  // Over the cap, drop the longest-unwatched idle runners first.
  if (live.size - reaped.length > MAX_LIVE_RUNNERS) {
    const candidates = [...live.entries()]
      .filter(
        ([url, e]) =>
          !reaped.includes(url) && e.viewers.size === 0 && !e.runner?.running && !listening(e)
      )
      .sort((a, b) => (a[1].idleSince ?? 0) - (b[1].idleSince ?? 0))
    while (live.size - reaped.length > MAX_LIVE_RUNNERS && candidates.length) {
      reaped.push(candidates.shift()[0])
    }
  }

  for (const url of reaped) stopRunner(url)
  return reaped
}

/**
 * The page is going away: give every session up, then stop. Giving up first
 * is what keeps the stop from writing (kernel/loop.js): a reply half-streamed stays
 * marked as such, and the next runner — this page reloaded, or another —
 * takes it out and asks again, at once if the release reached it and after
 * the lease goes stale if it did not.
 */
export function releaseAll() {
  for (const entry of live.values()) {
    try {
      entry.runner?.release?.()
    } catch {
      /* the document is gone; the lease goes stale instead */
    }
  }
  return stopAll()
}

/** Stop everything. */
export function stopAll() {
  const urls = [...live.keys()]
  for (const url of urls) stopRunner(url)
  return urls.length
}

/** Tests only. */
export function _reset() {
  live.clear()
}

// Release leases on the way out, so another runner does not have to wait out a
// staleness timeout to pick the session up.
if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("pagehide", () => releaseAll())
}
