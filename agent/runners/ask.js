/**
 * Asking for a session's work: one task, one burst (kernel/burst.js), under
 * the key `agent:<session>` on the asker's own queue. Whoever writes work
 * asks (runners/page.js askFor, which fills in the input); a page showing or
 * driving the session also asks whenever its copy shows work.
 *
 * The task client is the Tasks package's, from the registry (host/import.js
 * `taskClient`): `doWork(repo, request)`, `watchWork(repo, key, onChange)`,
 * `stopWork(repo, key)`, `ownQueue(repo)` for the queue whose url goes in the
 * input's `sensitiveDocs`. A caller may hand in another as `client` (the
 * tests' stand-ins). What is asked for is this package's own
 * runners/session-task.js, at the version the asker loaded (the client's
 * `inSamePackage`), unless `importUrl` names another.
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
 * An ask that fails is said: followWork's listeners are told why, in words
 * without urls (document urls and web addresses alike), until the next ask
 * is made or the copy shows no work. doWork asks the person's own queue
 * whether or not any pool is heard, so it fails only for what no pool
 * changes: no account open, nowhere to keep the queues, the list of queues
 * not on this device within its bound, or a task that threw. A failed ask is
 * asked again as any ask is: on the next change (a message, a steer, an
 * answer, Take over), or when the network comes back, and by nothing else.
 *
 * A task that ended cancelled is not an ask that failed: someone stopped it
 * (a person's Stop, a workflow's halt, a cancel in the queue browser). It is
 * not said, the ask resolves `{ asked: true, outcome: "cancelled" }`, and the
 * next change asks as any change does.
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
import { HEADS_WAIT_MS, workKey } from "../kernel/burst.js"
import { rememberOwn } from "../kernel/own-changes.js"
import { stopSession } from "../session/recovery.js"
import { STOP } from "../session/status.js"
import { WHERE } from "../session/schema.js"
import { onOnline } from "../net/network.js"
import { Automerge, AutomergeRepo } from "../host/modules.js"
import { clientHere } from "../host/import.js"

const clientOf = (opts) => opts?.client ?? clientHere()

/** The most asks at one copy's heads. */
export const MAX_ASKS = 2

/** A url without its heads. */
const bare = (url) => String(url).split("#")[0]

export { workKey }

const FINISHED = new Set(["succeeded", "failed", "cancelled"])

/** Did the task this ask waited on end cancelled? What the client's doWork rejects with then is its CANCELLED. */
const wasCancelled = (err, client) => String(err?.message ?? err).replace(/[.\s]+$/, "") === client?.CANCELLED

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
 * urls, since a queue's leads to every key on it, and said (see the header).
 *
 * @param {object} repo  the page's Repo
 * @param {string} sessionUrl
 * @param {object} opts
 * @param {{ doWork: Function, watchWork: Function, stopWork: Function, ownQueue?: Function, inSamePackage: Function }} [opts.client]  default the task client
 * @param {string} [opts.importUrl]  default the asker's loaded session task, in its package and at its heads: a burst runs the version the asker runs
 * @param {{ rootFolderUrl: string|null, sensitiveDocs: string[] }} [opts.account]
 * @param {{ tools: object[], skills: object[] }} [opts.catalogue]
 * @param {{ model: string|null, search: string|null, relay: object|null }} [opts.keys]
 * @param {()=>number} [opts.now]
 * @param {Function} [opts.setTimeout]
 * @param {Function} [opts.clearTimeout]
 * @param {(fn:Function)=>Function} [opts.onOnline]
 * @param {()=>Promise<unknown>} [opts.reask]  how to judge and ask once more, when the
 *   followed task ends or the network comes back: the asker's own (runners/page.js
 *   askFor fills in the keys); default askWork with these options
 */
export async function askWork(repo, sessionUrl, opts = {}) {
  const entry = entryFor(repo, sessionUrl, opts)
  entry.opts = opts
  if (opts.reask) entry.reask = opts.reask
  let counted = false
  try {
    const handle = await repo.find(bare(sessionUrl))
    const doc = handle.doc()
    const heads = [...(handle.heads?.() ?? [])]
    const facts = factsOf(entry, doc, heads)
    const decision = shouldAsk(facts)
    if (!decision.ask) {
      if (!facts.work) said(entry, null)
      return { asked: false, why: decision.why }
    }

    const at = headsKey(heads)
    entry.asked = { at, count: (entry.asked.at === at ? entry.asked.count : 0) + 1 }
    counted = true
    said(entry, null)
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
    const importUrl = opts.importUrl ?? client.inSamePackage(import.meta.url, "runners/session-task.js")
    const result = await client.doWork(repo, { importUrl, key: workKey(sessionUrl), input })
    return { asked: true, outcome: result?.outcome ?? null }
  } catch (err) {
    // Stopped, not failed: nothing to say.
    if (counted && wasCancelled(err, clientOf(opts))) {
      said(entry, null)
      return { asked: true, outcome: "cancelled" }
    }
    const why = withoutUrls(String(err?.message ?? err))
    said(entry, why)
    throw new Error(why)
  }
}

/** Why the last ask of a session failed, worded without urls, or null. */
export const failedAskOf = (sessionUrl) => sessions.get(bare(sessionUrl))?.failed ?? null

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
 * was nothing of theirs to stop, or no task client here).
 */
export async function stop(repo, sessionUrl, { client = clientHere(), author = null } = {}) {
  const handle = await repo.find(bare(sessionUrl))
  handle.change((d) => stopSession(d, STOP.stopped, null, author))
  return Promise.resolve()
    .then(() => client.stopWork(repo, workKey(sessionUrl)))
    .catch(() => false)
}

/**
 * Follow a session's work for a view: `onView(view, failed)` is told what the
 * watch of its key says now (null until it has said anything) and why the
 * last ask failed (null when it did not), and again whenever either changes.
 * Returns how to stop. The view's line under the composer is read off them
 * (ui/session-value.js).
 */
export function followWork(repo, sessionUrl, onView, opts = {}) {
  const entry = entryFor(repo, sessionUrl, opts)
  if (opts.reask) entry.reask = opts.reask
  entry.listeners.add(onView)
  try {
    onView(entry.view, entry.failed)
  } catch {}
  return () => entry.listeners.delete(onView)
}

/** What the watch of a session's key last said, or null. */
export const workViewOf = (sessionUrl) => sessions.get(bare(sessionUrl))?.view ?? null

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
    failed: null, // why the last ask failed, or null
    listeners: new Set(),
    asked: { at: null, count: 0 },
    behind: null, // { at, since }: the last task's heads the copy has waited for
    timer: null,
    now: opts.now ?? (() => Date.now()),
    setTimer: opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: opts.clearTimeout ?? ((t) => clearTimeout(t)),
  }
  sessions.set(url, entry)
  const again = () => Promise.resolve(entry.reask ? entry.reask() : askWork(entry.repo, entry.url, entry.opts)).catch(() => {})
  entry.again = again
  entry.unwatch = clientOf(opts).watchWork(repo, workKey(url), (view) => {
    const was = entry.view
    entry.view = view
    rememberOwn(url, view?.progress?.own)
    rememberOwn(url, view?.result?.own)
    tell(entry)
    // The task it followed has ended: judge once more.
    if (was && !FINISHED.has(was.state) && was.state !== "missing" && FINISHED.has(view?.state)) again()
  })
  entry.unlisten = (opts.onOnline ?? onOnline)(() => {
    entry.asked = { at: null, count: 0 }
    again()
  })
  return entry
}

/** Tell the entry's listeners what the watch says and why the last ask failed. */
function tell(entry) {
  for (const listener of [...entry.listeners]) {
    try {
      listener(entry.view, entry.failed)
    } catch {}
  }
}

/** Say why the last ask failed (`why`), or that nothing has (null). */
function said(entry, why) {
  if (entry.failed === why) return
  entry.failed = why
  tell(entry)
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
  const work = needsWork(doc, (where) => where === WHERE.worker, named)
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

/** A message with every url taken out: a document's, and a web address; the sentence's own punctuation after either stays. */
function withoutUrls(text) {
  return text
    .replace(/automerge:[1-9A-HJ-NP-Za-km-z]+(?:#[^\s'"`)]*[^\s'"`).,;:])?/g, "a document")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]*[^\s'"`).,;:]/gi, "a web address")
}
