/**
 * Asking for a session's work: one task, one burst (kernel/burst.js), under
 * the key `agent:<session>` on the asker's own queue. Not yet used: today's
 * runners still run sessions.
 *
 * The task client is the task system's (host/task-client.js, a kit copy):
 * `doWork(repo, request)`, `watchWork(repo, key, onChange)`, `stopWork(repo,
 * key)`, and `ownQueue(repo)` for the queue whose url goes in the input's
 * `sensitiveDocs`. A caller may hand in another as `client` (the tests'
 * stand-ins). What is asked for is this package's own runners/session-task.js,
 * at the version the asker loaded (`inSamePackage`), unless `importUrl` names
 * another.
 *
 * The one rule (`shouldAsk`). askWork asks iff all of these hold:
 *   - the copy needs work a run can do: needsWork, its debris judged against
 *     the run `burst` names, with worker calls only (a call that needs a page
 *     is the page's: runners/page.js);
 *   - `burst` is null or names a run the watch of the key lists; a run it
 *     does not list, or a page's claim, is someone else's, and the asker
 *     stands back;
 *   - the last task under the key has ended (none, or one that has, but not
 *     one still under way, which reads the session at each of its turns);
 *   - the copy's heads differ from that task's: its result's `heads`, or the
 *     heads it was asked at when it has no result or its result's heads are
 *     null (it ended with work left: kernel/burst.js). Equal, nothing new; the
 *     copy behind them, it waits (at most HEADS_WAIT_MS) to have them;
 *   - it has asked fewer than twice at these heads. Then only a change or
 *     the network coming back (`online`) asks again.
 *
 * Why it never loops: every ask needs heads no ended task saw, or is one of
 * at most two at one copy's heads. A burst's code returns for everything it
 * can record, so a task that ended at the heads asked at asks nothing more.
 *
 * Besides asking when called, it judges once more when the watch sees the
 * task it followed end, for what was written while it ran and it did not
 * see; and it feeds the hashes a run reports as its own (`own`, in its
 * progress and its result) to rememberOwn, so a watch restored in this page
 * still ignores the agent's own edits.
 *
 * The session never names the task, and keys travel only in the input.
 */

import { needsWork } from "../kernel/runner.js"
import { HEADS_WAIT_MS } from "../kernel/burst.js"
import { rememberOwn } from "../kernel/own-changes.js"
import { hasDebris, stopSession } from "../session/recovery.js"
import { STOP } from "../session/status.js"
import { WHERE } from "../session/schema.js"
import { onOnline } from "../net/network.js"
import { Automerge, AutomergeRepo } from "../host/modules.js"
import { doWork, watchWork, stopWork, ownQueue, inSamePackage } from "../host/task-client.js"

/** The task system's own client, which asks the person's own queue. */
export const TASK_CLIENT = Object.freeze({ doWork, watchWork, stopWork, ownQueue })

/** The asker's own loaded session task, in its package and at its heads; null outside a package (tests). */
export const SESSION_TASK = inSamePackage(import.meta.url, "runners/session-task.js")

const clientOf = (opts) => opts?.client ?? TASK_CLIENT

/** The most asks at one copy's heads. */
export const MAX_ASKS = 2

/** A url without its heads. */
const bare = (url) => String(url).split("#")[0]

/** The key a session's work is asked under. */
export const workKey = (sessionUrl) => `agent:${bare(sessionUrl)}`

const FINISHED = new Set(["succeeded", "failed", "cancelled"])

/**
 * The rule, on what it reads off the copy and the watch:
 *
 *   work    needsWork, as above
 *   burst   "none", "own" (a run the watch lists), "foreign" (anything else:
 *           another person's run, a page's claim, a run nobody hears)
 *   last    "none", "running", or for an ended task the copy's heads against
 *           its: "equal", "behind" (the copy lacks them), "ahead"
 *   asked   asks so far at the copy's heads
 *
 * @returns {{ ask: boolean, why: string }}
 */
export function shouldAsk({ work, burst, last, asked }) {
  if (!work) return { ask: false, why: "no work" }
  if (burst === "foreign") return { ask: false, why: "someone else's work is under way" }
  if (last === "running") return { ask: false, why: "under way" }
  if (last === "equal") return { ask: false, why: "nothing new since the last task" }
  if (last === "behind") return { ask: false, why: "waiting for the last task's writes" }
  if (asked >= MAX_ASKS) return { ask: false, why: "asked twice at these heads" }
  return { ask: true, why: last === "none" ? "work, and no task" : "work the last task did not see" }
}

/** Per session: what the watch last said, and the asks at the copy's heads. */
const sessions = new Map() // bare url -> entry

/**
 * Ask for a session's work, if the rule says to.
 *
 * Resolves `{ asked: false, why }` at once, or `{ asked: true, outcome }`
 * when the task ends (its result's outcome). It passes doWork no signal: a
 * view that closes must not stop a burst. A rejection is worded without
 * urls, since a queue's leads to every key on it.
 *
 * @param {object} repo  the page's Repo
 * @param {string} sessionUrl
 * @param {object} opts
 * @param {{ doWork: Function, watchWork: Function, stopWork: Function, ownQueue?: Function }} [opts.client]  default TASK_CLIENT
 * @param {string} [opts.importUrl]  default SESSION_TASK, the asker's loaded module: a burst runs the version the asker runs
 * @param {{ rootFolderUrl: string|null, sensitiveDocs: string[] }} [opts.account]
 * @param {{ tools: object[], skills: object[] }} [opts.catalogue]
 * @param {{ model: string|null, search: string|null, relay: object|null }} [opts.keys]
 * @param {()=>number} [opts.now]
 * @param {Function} [opts.setTimeout]
 * @param {Function} [opts.clearTimeout]
 * @param {(fn:Function)=>Function} [opts.onOnline]
 */
export async function askWork(repo, sessionUrl, opts = {}) {
  const entry = entryFor(repo, sessionUrl, opts)
  entry.opts = opts
  const handle = await repo.find(bare(sessionUrl))
  const doc = handle.doc()
  const heads = [...(handle.heads?.() ?? [])]
  const facts = factsOf(entry, doc, heads)
  const decision = shouldAsk(facts)
  if (!decision.ask) return { asked: false, why: decision.why }

  const at = headsKey(heads)
  entry.asked = { at, count: (entry.asked.at === at ? entry.asked.count : 0) + 1 }
  const client = clientOf(opts)
  // In this order: what the queue browser shows first is the session and its
  // heads, and the keys last.
  const input = {
    session: bare(sessionUrl),
    heads,
    account: await withOwnQueue(repo, client, opts.account ?? { rootFolderUrl: null, sensitiveDocs: [] }),
    catalogue: opts.catalogue ?? { tools: [], skills: [] },
    keys: opts.keys ?? { model: null, search: null, relay: null },
  }
  try {
    const result = await client.doWork(repo, { importUrl: opts.importUrl ?? SESSION_TASK, key: workKey(sessionUrl), input })
    return { asked: true, outcome: result?.outcome ?? null }
  } catch (err) {
    throw new Error(withoutUrls(String(err?.message ?? err)))
  }
}

/**
 * Take over: `burst` cleared, whoever it named, then asked. What the run it
 * named left becomes debris, settled by the next burst (session/recovery.js
 * settleDebris). For a mark nobody will release: a page that died mid-call,
 * a run nobody hears.
 */
export async function takeOver(repo, sessionUrl, opts = {}) {
  const handle = await repo.find(bare(sessionUrl))
  handle.change((d) => {
    if (d.burst != null) d.burst = null
  })
  return askWork(repo, sessionUrl, opts)
}

/**
 * A person's Stop: the notice written into the session, which holds wherever
 * it runs, then the task under the key stopped on the stopper's own queue,
 * which only makes it quicker. Resolves what stopWork says (false when there
 * was nothing of theirs to stop).
 */
export async function stop(repo, sessionUrl, { client = TASK_CLIENT, author = null } = {}) {
  const handle = await repo.find(bare(sessionUrl))
  handle.change((d) => stopSession(d, STOP.stopped, null, author))
  return Promise.resolve()
    .then(() => client.stopWork(repo, workKey(sessionUrl)))
    .catch(() => false)
}

/** Stop following a session: its watch, its timers, what it remembered. */
export function forget(sessionUrl) {
  const entry = sessions.get(bare(sessionUrl))
  if (!entry) return
  sessions.delete(bare(sessionUrl))
  entry.unwatch?.()
  entry.unlisten?.()
  if (entry.timer != null) entry.clearTimer(entry.timer)
}

function entryFor(repo, sessionUrl, opts) {
  const url = bare(sessionUrl)
  let entry = sessions.get(url)
  if (entry) return entry
  entry = {
    url,
    repo,
    opts,
    view: null,
    asked: { at: null, count: 0 },
    behind: null, // { at, since }: the last task's heads the copy has waited for
    timer: null,
    now: opts.now ?? (() => Date.now()),
    setTimer: opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: opts.clearTimeout ?? ((t) => clearTimeout(t)),
  }
  sessions.set(url, entry)
  const again = () => askWork(entry.repo, entry.url, entry.opts).catch(() => {})
  entry.again = again
  entry.unwatch = clientOf(opts).watchWork(repo, workKey(url), (view) => {
    const was = entry.view
    entry.view = view
    rememberOwn(url, view?.progress?.own)
    rememberOwn(url, view?.result?.own)
    // The task it followed has ended: judge once more.
    if (was && !FINISHED.has(was.state) && was.state !== "missing" && FINISHED.has(view?.state)) again()
  })
  entry.unlisten = (opts.onOnline ?? onOnline)(() => {
    entry.asked = { at: null, count: 0 }
    again()
  })
  return entry
}

/**
 * The account as the input carries it, with the person's own queue among the
 * documents that always ask (its entries lead to tasks, whose inputs hold
 * keys), when the client can say which it is.
 */
async function withOwnQueue(repo, client, account) {
  const sensitiveDocs = [...(account.sensitiveDocs ?? [])]
  if (typeof client.ownQueue === "function") {
    const own = await Promise.resolve()
      .then(() => client.ownQueue(repo))
      .catch(() => null)
    if (typeof own === "string" && !sensitiveDocs.includes(own)) sensitiveDocs.push(own)
  }
  return { ...account, sensitiveDocs }
}

/** What the rule reads, off the copy and the watch's view. */
function factsOf(entry, doc, heads) {
  const view = entry.view
  const runs = new Set((view?.runs ?? []).map((run) => run?.id))
  const named = doc?.burst?.run ?? null
  const burst = named == null ? "none" : runs.has(named) ? "own" : "foreign"
  const work = needsWork(doc, (where) => where === WHERE.worker, null, (d) => hasDebris(d, named))
  const at = headsKey(heads)
  const asked = entry.asked.at === at ? entry.asked.count : 0
  return { work, burst, last: lastOf(entry, view, doc, heads), asked }
}

/** The last task under the key, against the copy's heads. */
function lastOf(entry, view, doc, heads) {
  const state = view?.state ?? "missing"
  if (state === "missing") return "none"
  if (!FINISHED.has(state)) return "running"
  const theirs = Array.isArray(view?.result?.heads) ? view.result.heads : Array.isArray(view?.input?.heads) ? view.input.heads : null
  if (!theirs) return "none"
  if (headsKey(theirs) === headsKey(heads)) return "equal"
  if (has(doc, theirs)) return "ahead"
  // The copy lacks the task's writes: wait for them, at most HEADS_WAIT_MS,
  // then judge it ahead (a burst waits for its input's heads as long).
  const at = headsKey(theirs)
  if (entry.behind?.at !== at) {
    entry.behind = { at, since: entry.now() }
    if (entry.timer != null) entry.clearTimer(entry.timer)
    entry.timer = entry.setTimer(() => {
      entry.timer = null
      entry.again()
    }, HEADS_WAIT_MS)
  }
  return entry.now() - entry.behind.since >= HEADS_WAIT_MS ? "ahead" : "behind"
}

const headsKey = (heads) => [...(heads ?? [])].sort().join(",")

function has(doc, heads) {
  try {
    return Automerge.hasHeads(doc, AutomergeRepo.decodeHeads(heads))
  } catch {
    return false
  }
}

/** A message with every document url taken out. */
function withoutUrls(text) {
  return text.replace(/automerge:[1-9A-HJ-NP-Za-km-z]+(?:#[^\s'"`)]*)?/g, "a document")
}
