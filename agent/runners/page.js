/**
 * What a page does for the sessions it shows or drives. A burst of a session
 * always runs in a pool's worker (kernel/burst.js, runners/session-task.js);
 * a page asks for it, follows it, and runs the calls only a page can run.
 *
 *   follow(handle, { repo, element })  the one place a page keeps a session
 *       going, from when the page has the task client (host/import.js
 *       `taskClient`; nothing until the Tasks package is installed here):
 *       it asks for the session's work whenever its copy shows some
 *       (askFor), runs its parked calls (pageCalls), owns its events and
 *       opens its watches (restoreWatches, again whenever `watches` changes),
 *       and is told the hashes a run reports as its own (runners/ask.js).
 *       Counted: a session view holds it, a workflow driver holds it while
 *       the session is a running step's (workflow/driver.js), the plan's
 *       channel to its orchestrator holds that while it is open, and the
 *       last to let go ends it. The drivers its workflow tools started are
 *       let go once every holder but a channel has: a channel is a driver's,
 *       so it never keeps one going. A burst under way is the pool's, and
 *       goes on.
 *   askFor(repo, sessionUrl)  ask for a session's work with this page's
 *       keys, account and catalogue in the input (runners/ask.js askWork).
 *       Every write of work asks: a message, an approval, an answer, a
 *       lifted budget, a reopen, a parked call's result, a watch's wake.
 *   drivePlanHere(planUrl, { repo, holder })  drive a plan from this page
 *       for `holder` (a view), until it calls `letGo(holder)`: its running
 *       steps are asked for and followed here.
 *   tabFetch, accountContext, pageContext  what a page's tools are handed.
 *
 * On load it retires what earlier code left in this page: the runners an
 * older version kept on globalThis (each given up, so it writes nothing
 * more, then stopped), and the followers of another version of this module.
 *
 * Parked calls. A burst never runs a call that needs a page (`where:
 * "host"`): it parks, clears `burst` and ends. A page acts when its copy of
 * the session shows no stop, a null `burst`, no mark left (debris, which a
 * burst settles first), and a first runnable call that needs a page:
 *   1. it writes `burst` = a fresh id, only while `burst` is null and no stop
 *      is in force, and waits BEAT_MS;
 *   2. only if `burst` still names its id does it claim the call, and run it
 *      with the page's context and the toolset prepareRun builds; a stop
 *      coming into force aborts the tool's signal;
 *   3. in one change it writes the call's move, its result and `made`, and
 *      clears `burst` (only while the call still runs under its claim, and
 *      `burst` only while it names it);
 *   4. it takes the next such call the same way, never under a stop, and
 *      then asks for whatever work is left.
 * One register decides, so two pages in one crossing run the call once, and
 * the page that loses has written nothing on the call. A claim slower than a
 * beat may run it twice; the request sends one result (session/request.js).
 *
 * Mounts: a call naming a `mountId` is taken at once only by the page whose
 * mounts map has it. Another page waits one more beat first, then takes it
 * as above, and the tool answers that there is no such mount, as after a
 * reload.
 *
 * pagehide: a call this page claimed is abandoned INTERRUPTED and `burst`
 * cleared, in one change, and the page takes nothing more.
 */

import { handleStore, guardedStore } from "../kernel/store.js"
import { prepareRun, needsWork } from "../kernel/runner.js"
import { runTool } from "../kernel/tool.js"
import { storeRecall } from "../kernel/loop.js"
import { createEvents } from "../kernel/events.js"
import { stopOf } from "../session/status.js"
import { findCall, findResult, move, runnableCalls, results, callsAwaitingApproval, questionsAwaitingAnswer } from "../session/calls.js"
import { makeTurn, resultBlock } from "../session/blocks.js"
import { recordArtifact } from "../session/made.js"
import { INTERRUPTED, hasDebris } from "../session/recovery.js"
import { WHERE, unknownBlocks, versionStanding } from "../session/schema.js"
import { AGENT } from "../assembly/agent.js"
import { BUILTIN_TOOLS } from "../assembly/builtin.js"
import { loadPluginTools, pluginCatalogue } from "../assembly/plugins.js"
import { ensureDriver, getDriver, letGo, sessionHolder } from "../workflow/driver.js"
import { readKey, readRelay, SEARCH_KEY_ID } from "../providers/keys.js"
import { relayFetch } from "../net/relay.js"
import { guardedFetch, SYNC_SERVERS, pageOriginFetch } from "../net/guard.js"
import { hostImport, taskClient, clientHere, _holdClient } from "../host/import.js"
import { getMount } from "../tools/checking.js"
import { braveSearch } from "../tools/web.js"
import { restoreWatches } from "../tools/watch.js"
import { packageOfPlugin } from "../knowledge/guides.js"
import { askWork, forget, followWork, stop } from "./ask.js"

/** Which build of this code made a follower: its module url, which changes with every version Patchwork loads. */
export const CODE_VERSION = import.meta.url

/** A url without its heads. */
const bare = (url) => String(url).split("#")[0]

export { letGo }

// ---------------------------------------------------------------- retiring

/**
 * Retire what earlier code left in this page: every runner an older version
 * registered on globalThis (`__patchworkAgentRunners`: given up, then
 * stopped at once, so it does not work on a session beside the burst this
 * page is about to ask for; then the map deleted), and every follower of
 * another version of this module. An older view's own dispose closes the
 * shared worker connection it held.
 *
 * Given up first, as the old registry did on pagehide: a runner stopped
 * while it still holds its session finishes the reply it is streaming, cut
 * off and unmarked, which is no work for this code, and the person's message
 * is left half answered. Given up, it writes nothing more, and the reply
 * stays marked: debris, which the next burst settles and answers.
 *
 * The runners half is runtime code for an older version, kept on purpose
 * though the package carries no migrations: Patchwork loads a new version
 * into a page without a reload, so a page open since before bursts ran on
 * the task system still holds that version's runners. It can go once no
 * such page can be open: every page that loaded a version with
 * `__patchworkAgentRunners` has since loaded this one or been closed. The
 * followers half is not: it retires another version of this module itself.
 */
export function retireEarlier(scope = globalThis) {
  const runners = scope.__patchworkAgentRunners
  if (runners) {
    for (const entry of runners.values()) {
      try {
        entry?.runner?.release?.()
        entry?.runner?.stop?.()
        entry?.dispose?.()
      } catch {
        /* already gone */
      }
    }
    delete scope.__patchworkAgentRunners
  }
  const followers = scope.__patchworkAgentFollowers
  if (followers) {
    for (const [url, entry] of [...followers]) {
      if (entry.version === CODE_VERSION) continue
      followers.delete(url)
      try {
        entry.dispose()
      } catch {
        /* already gone */
      }
    }
  }
}

retireEarlier()

// ---------------------------------------------------------------- the page's context

/**
 * The fetch every tool in this page uses. It refuses this page's own origin —
 * which serves the person's documents to anyone asking by URL — the sync
 * servers, and every local or private address; see net/guard.js. With a
 * fetch relay set up, GET and HEAD go through it (net/relay.js), read
 * afresh for every request, so setting one up takes effect at once.
 */
export function tabFetch({ relay = () => readRelay() } = {}) {
  return guardedFetch({ fetch: relayFetch({ fetch: (url, init) => fetch(url, init), relay }), deny: [location.origin, ...SYNC_SERVERS] })
}

/**
 * What of the account a run's context carries: where its documents are
 * filed, and which of them always need an explicit yes, whatever touches
 * them. Plain data, so it travels in a task's input; the account's own
 * handle is not in it, and no tool is given one.
 */
export function accountContext(account = globalThis.accountDocHandle) {
  const doc = account?.doc?.() ?? null
  return {
    rootFolderUrl: doc?.rootFolderUrl ?? null,
    sensitiveDocs: [doc?.moduleSettingsUrl, account?.url].filter(Boolean),
  }
}

/**
 * The context a page's tools are handed for one session (TOOLS.md).
 *
 *   handle   the session's DocHandle
 *   repo     the page's Repo
 *   events   the session's events in this page (kernel/events.js)
 *   view     `{ element }`: where page tools mount, swapped as views come
 *            and go; read by a getter, so each call sees where it is now
 */
export async function pageContext(handle, { repo, events = null, view = { element: null } }) {
  const automerge = await hostImport("automerge").catch(() => null)
  // The registry module, for plugin tools as ctx.plugins.
  const plugins = await hostImport("plugins").catch(() => null)
  const fetchImpl = tabFetch()
  return {
    repo,
    get subject() {
      return handle.doc()?.subject ?? null
    },
    splice: automerge?.splice ?? null,
    // For plugin tools: the page's registry and its automerge, initialised.
    plugins,
    automerge,
    events,
    get element() {
      return view.element
    },
    ...accountContext(),
    get skillsFolderUrl() {
      return handle.doc()?.config?.skillsFolderUrl ?? null
    },
    // Skills installed packages contribute (knowledge/skills.js packageSkills).
    skillRegistry: plugins?.getRegistry?.("patchwork:skill") ?? null,
    // Which package a plugin came from, for usage guides (knowledge/guides.js):
    // `{ url, heads, name }` for the package folder behind a plugin id.
    packageOf: async (type, id) => packageOfPlugin((await hostImport("plugins")).getRegistry(type).all().find((p) => p.id === id)),
    // So view_screenshot can photograph a view that view_mount opened.
    getMount,
    fetchImpl,
    // With a relay a page reaches pages as a Node host does, so it keeps
    // them as one does: the PDF or the page itself, with its text beside it.
    get direct() {
      return !!readRelay()
    },
    // web_search: Brave with the account's key, read afresh so a key saved
    // in settings works at once. Tools get the search, never the key.
    search: braveSearch({ key: () => readKey(SEARCH_KEY_ID), fetchImpl }),
    // The page's own origin, for plugin_source alone (see pageOriginFetch).
    pageFetch: pageOriginFetch({ fetch: (url, init) => fetch(url, init), origin: location.origin }),
  }
}

// ---------------------------------------------------------------- asking

/** Is this session another version's, which no run of this one takes (kernel/burst.js `outdated`)? */
const outdated = (doc) => unknownBlocks(doc).length > 0 || versionStanding(doc) !== "current"

/** How this page asks: runners/ask.js askWork, unless a test hands in another (`_reset`). */
let asker = askWork

/**
 * Ask for a session's work, if askWork's rule says to, with what this page
 * puts in the input: the person's keys, the account context, and the
 * catalogue of installed packages' tools and skills. Nothing is asked
 * without the task client (the Tasks package not installed here), for a
 * session with no model key here ("Add an API key to start"), or of another
 * version. Resolves as askWork does; never throws.
 *
 * Beside it, what the views do with the same client: `followWorkFor` (what
 * the queue says of the session's task, runners/ask.js followWork),
 * `stopFor` (a person's Stop) and `takeOverFor` (Take over).
 */
export async function askFor(repo, sessionUrl, opts = {}) {
  try {
    if (!clientHere()) return { asked: false, why: "no Tasks package" }
    const doc = (await repo.find(bare(sessionUrl))).doc()
    if (!doc) return { asked: false, why: "no session" }
    if (outdated(doc)) return { asked: false, why: "another version's session" }
    // askWork's first rule, before the catalogue is read: most looks find nothing to do.
    if (!needsWork(doc, (where) => where === WHERE.worker, doc.burst?.run ?? null)) return { asked: false, why: "no work" }
    const model = readKey(doc.config?.providerId ?? "openrouter")
    if (!model) return { asked: false, why: "no key" }
    const catalogue = await pluginCatalogue().catch(() => ({ tools: [], skills: [] }))
    return await asker(repo, sessionUrl, {
      ...opts,
      // When the task it follows ends, or the network is back, it asks again this way: with the keys.
      reask: () => askFor(repo, sessionUrl),
      account: accountContext(),
      catalogue,
      keys: { model, search: readKey(SEARCH_KEY_ID) ?? null, relay: readRelay() },
    })
  } catch (err) {
    return { asked: false, why: String(err?.message ?? err), error: true }
  }
}

/** Follow what the queue says of a session's task (runners/ask.js followWork), once this page has the task client. Returns how to stop. */
export function followWorkFor(repo, sessionUrl, onView) {
  return followWork(repo, sessionUrl, onView, { reask: () => askFor(repo, sessionUrl) })
}

/** A person's Stop: the notice written into the session, then its task stopped on their queue (runners/ask.js stop). */
export function stopFor(repo, sessionUrl, { author = null } = {}) {
  return stop(repo, sessionUrl, { author })
}

/**
 * Take over: `burst` cleared, whoever it named, then the session's work
 * asked for with this page's keys. What the run it named left becomes
 * debris, settled by the next burst. For a mark nobody will release: a page
 * that died mid-call, a run nobody hears.
 */
export async function takeOverFor(repo, sessionUrl) {
  const handle = await repo.find(bare(sessionUrl))
  handle.change((d) => {
    if (d.burst != null) d.burst = null
  })
  return askFor(repo, sessionUrl)
}

// ---------------------------------------------------------------- following

/** How long a burst of changes is gathered before the ask it makes. */
export const ASK_SETTLE_MS = 200

/** sessionUrl -> follower. On globalThis, so a newer version of this module finds and retires an older one's. */
const followers = (globalThis.__patchworkAgentFollowers ??= new Map())

/** What the watches are, without how far each has looked: a change to these is a watch made or stopped. */
const watchKey = (doc) =>
  JSON.stringify(
    Object.entries(doc?.watches ?? {})
      .map(([id, w]) => [id, w?.url ?? null, [...(w?.path ?? [])], w?.match ?? null])
      .sort()
  )

/**
 * Keep a session going from this page, as the header says. Returns
 * `{ events, mount(element), running(), claim(), onRunning(fn), release() }`:
 * `running()` is the tool of the parked call this page runs now, or null;
 * `claim()` the id this page wrote into `burst` to take a parked call, from
 * that write (before its beat) until it lets go, or null. `onRunning` is told
 * whenever either changes.
 *
 * @param {object} handle  the session's DocHandle in the page's Repo
 * @param {object} opts
 * @param {object} opts.repo
 * @param {HTMLElement|null} [opts.element]  where page tools mount
 * @param {boolean} [opts.channel]  held for a driver's channel to the session, which does not hold the drivers its workflow tools started
 */
export function follow(handle, { repo, element = null, channel = false } = {}) {
  const url = bare(handle.url)
  let entry = followers.get(url)
  if (!entry || entry.disposed) {
    entry = startFollowing(handle, repo)
    followers.set(url, entry)
  }
  entry.holders++
  if (!channel) entry.toolHolders++
  if (element) entry.view.element = element
  let released = false
  return {
    events: entry.events,
    mount: (to) => {
      entry.view.element = to
    },
    running: () => entry.running,
    claim: () => entry.claim,
    onRunning: (fn) => {
      entry.watchers.add(fn)
      return () => entry.watchers.delete(fn)
    },
    ask: () => entry.ask(),
    release() {
      if (released) return
      released = true
      if (entry.view.element === element) entry.view.element = null
      entry.holders--
      // The drivers this session's workflow tools started here; a driver
      // stopping closes its channel, which may be the last holder.
      if (!channel && --entry.toolHolders === 0) letGo(sessionHolder(url))
      if (entry.holders > 0) return
      if (followers.get(url) === entry) followers.delete(url)
      entry.dispose()
    },
  }
}

/** The followers this page keeps, by session url. Tests. */
export const _followers = () => followers

/**
 * Tests: let go of every follower, and from now on ask with `ask` (default:
 * ask nothing, and say so) and hold `with` as the task client (default:
 * none, so nothing is followed).
 */
export function _reset(ask = async () => ({ asked: false, why: "a test asks nothing" }), { with: withClient = null } = {}) {
  for (const entry of followers.values()) entry.dispose()
  followers.clear()
  asker = ask
  _holdClient(withClient)
}

function startFollowing(handle, repo) {
  const url = bare(handle.url)
  const store = handleStore(handle)
  const view = { element: null }
  const ask = () => askFor(repo, url)
  // How tools wake this session after their calls are over (kernel/events.js):
  // a wake is a write of work, and asks.
  const events = createEvents(store, { onWake: ask })
  const entry = {
    version: CODE_VERSION,
    holders: 0,
    // Holders other than a driver's channel.
    toolHolders: 0,
    disposed: false,
    view,
    events,
    running: null,
    claim: null,
    watchers: new Set(),
    ask,
    dispose,
  }

  let calls = null
  let watchesAt = null
  let soon = null
  /** Tell the views what this page holds now (its claim, the tool it runs). */
  function tell() {
    for (const fn of [...entry.watchers]) {
      try {
        fn(entry.running)
      } catch {}
    }
  }
  // Nothing is followed until this page has the task client.
  const contextReady = taskClient()
    .then(() => {
      if (entry.disposed) return null
      handle.on("change", onChange)
      restore()
      askSoon()
      return pageContext(handle, { repo, events, view })
    })
    .then((context) => {
      if (entry.disposed || !context) return
      calls = pageCalls(handle, {
        context,
        builtins: AGENT.builtins,
        plugins: () => loadPluginTools(),
        afterCall: AGENT.afterCall,
        startSession: askOnly(repo),
        followSession: followFor(repo),
        ask,
        onRunning: (tool) => {
          entry.running = tool
          tell()
        },
        onClaim: (id) => {
          entry.claim = id
          tell()
        },
      })
      calls.tick().catch(() => {})
    }, () => {})

  /** Open the session's watches again whenever which watches it has changes. */
  function restore() {
    const doc = handle.doc()
    const key = watchKey(doc)
    if (key === watchesAt) return
    watchesAt = key
    restoreWatches({ repo, events, store }).catch(() => {})
  }

  /** Ask once the changes have settled, when this copy shows work a run can do. */
  function askSoon() {
    if (soon != null) return
    soon = setTimeout(() => {
      soon = null
      if (entry.disposed) return
      if (needsWork(handle.doc(), (where) => where === WHERE.worker)) ask().catch?.(() => {})
    }, ASK_SETTLE_MS)
  }

  const onChange = () => {
    if (entry.disposed) return
    restore()
    askSoon()
  }

  function dispose() {
    if (entry.disposed) return
    entry.disposed = true
    handle.off?.("change", onChange)
    if (soon != null) clearTimeout(soon)
    calls?.dispose()
    contextReady.then(() => calls?.dispose())
    events.stop()
    forget(url)
    // The drivers this session's workflow tools started here.
    letGo(sessionHolder(url))
  }
  return entry
}

/** How a driver asks for a step's work from this page. */
const askOnly = (repo) => (handle) => askFor(repo, handle.url)

/** How a driver holds a follow on a step's session in this page: returns how to let go. */
const followFor = (repo) => (handle) => {
  const held = follow(handle, { repo })
  return () => held.release()
}

/** Every tool this page has, as a driver reads them (workflow/step-tools.js). */
const pageTools = async () => ({ builtins: BUILTIN_TOOLS, plugins: await loadPluginTools().catch(() => []) })

/**
 * Drive a plan from this page for `holder` (a view), until it calls
 * `letGo(holder)`: its running steps are asked for and followed here, and
 * news goes to the orchestrating session through its events in this page,
 * which ask when they wake it; the orchestrator is followed here while that
 * channel is open, a follow that keeps no driver going (`follow` channel). The workflow tools start a driver themselves, with what
 * their page hands them (workflow/tools.js). `startSession` is for a caller
 * with its own way of running sessions.
 */
export async function drivePlanHere(planUrl, { repo, holder = null, events = null, startSession = null }) {
  // One already here is joined as it is.
  if (getDriver(planUrl)) return ensureDriver(planUrl, { repo, holder })
  let notify = events ? (url, title) => events.open(url, { label: `workflow: ${title}` }) : null
  if (!notify) {
    const sessionUrl = (await repo.find(planUrl)).doc()?.sessionUrl ?? null
    const orchestrator = sessionUrl ? await repo.find(sessionUrl) : null
    if (orchestrator) {
      notify = (url, title) => {
        const held = follow(orchestrator, { repo, channel: true })
        return held.events.forTool("workflow").open(url, { label: `workflow: ${title}`, onClose: () => held.release() })
      }
    }
  }
  return ensureDriver(planUrl, {
    repo,
    holder,
    startSession: startSession ?? askOnly(repo),
    follow: followFor(repo),
    tools: pageTools,
    notify,
  })
}

// ---------------------------------------------------------------- parked calls

/**
 * How long a page waits after writing `burst` before it believes it. The
 * task system's beat, mirrored and not imported: a run's `ctx.settled`
 * resolves only once its claim has been heard unopposed for one beat
 * (tasks/src/task-rules.js), which is what keeps two pools from both
 * running a task. Two pages are kept apart here the same way.
 */
export const BEAT_MS = 2000

/**
 * The call a page would take now: none under a stop or a `burst`, none while
 * a mark is left with `burst` null (debris, a burst's to settle first), none
 * while the session waits on a person (an approval or a question, as
 * needsWork says), and only when the first runnable call needs a page.
 */
export function pageCall(doc) {
  if (!doc || stopOf(doc) || doc.burst != null) return null
  // Debris first, as needsWork orders it: a burst settles it, then parks.
  if (hasDebris(doc, null)) return null
  if (callsAwaitingApproval(doc).length || questionsAwaitingAnswer(doc).length) return null
  const first = runnableCalls(doc)[0]
  return first && first.where === WHERE.host ? first : null
}

/** The mount a call acts on, if it names one. */
const mountOf = (call) => (typeof call?.input?.mountId === "string" ? call.input.mountId : null)

/**
 * Run a session's page calls from this page.
 *
 * @param {object} handle   the session's DocHandle in the page's Repo
 * @param {object} opts
 * @param {object} opts.context     the page's tool context (pageContext); its `repo` is the page's
 * @param {object[]} [opts.builtins]
 * @param {()=>Promise<object[]>} [opts.plugins]
 * @param {(doc:object)=>Promise<object>} [opts.buildToolset]
 * @param {Function[]} [opts.afterCall]  as the loop's (kernel/loop.js)
 * @param {Function} [opts.startSession] how this page asks for a step's work, for the workflow tools
 * @param {Function} [opts.followSession] how this page holds a follow on a step's session, for the workflow tools
 * @param {(mountId:string)=>boolean} [opts.hasMount]  default: the context's getMount
 * @param {()=>Promise<unknown>} [opts.ask]  asks for the session's work once this page has run its calls
 * @param {number} [opts.beatMs]
 * @param {(ms:number)=>Promise<void>} [opts.wait]  the clock
 * @param {()=>string} [opts.newId]
 * @param {Function} [opts.splice]
 * @param {EventTarget|null} [opts.target]  where `pagehide` is heard; default globalThis
 * @param {(tool:string|null)=>void} [opts.onRunning]  told the tool of the call it runs now, and null after
 * @param {(id:string|null)=>void} [opts.onClaim]  told the id it writes into `burst`, just before the write, and null once it lets go (or did not write)
 * @returns {{ tick: ()=>Promise<void>, pagehide: ()=>void, dispose: ()=>void }}
 */
export function pageCalls(handle, opts) {
  const context = opts.context ?? {}
  const beatMs = opts.beatMs ?? BEAT_MS
  const wait = opts.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const hasMount = opts.hasMount ?? ((id) => !!context.getMount?.(id))
  const store = handleStore(handle, opts.splice ?? null)
  const running = (tool) => {
    try {
      opts.onRunning?.(tool)
    } catch {}
  }
  const holding = (id) => {
    try {
      opts.onClaim?.(id)
    } catch {}
  }

  let busy = false
  let again = false
  let disposed = false // takes nothing more; a call under way still writes its result
  let gone = false // the page is going: pagehide has written what it leaves
  // What this page holds now: its id in `burst`, the call it claimed, and
  // the claim's signal.
  let held = null // { id, callId, controller }

  const onChange = () => {
    const doc = handle.doc()
    if (held?.controller && stopOf(doc)) held.controller.abort("stopped")
    tick().catch(() => {})
  }
  handle.on("change", onChange)
  const target = opts.target === undefined ? globalThis : opts.target
  const onPagehide = () => pagehide()
  if (typeof target?.addEventListener === "function") target.addEventListener("pagehide", onPagehide)

  /** Take every page call there is, one by one; then ask, if any ran. */
  async function tick() {
    if (disposed) return
    if (busy) {
      again = true
      return
    }
    busy = true
    let ran = 0
    try {
      do {
        again = false
        while (!disposed && (await takeOne())) ran++
      } while (again && !disposed)
    } finally {
      busy = false
    }
    if (ran && !gone) {
      try {
        await opts.ask?.()
      } catch {
        /* asking is the asker's to report; the calls ran */
      }
    }
  }

  /** Take one page call, as the header says. Whether it ran one. */
  async function takeOne() {
    let call = pageCall(handle.doc())
    if (!call) return false
    const mount = mountOf(call)
    if (mount && !hasMount(mount)) {
      // The page that has the mount takes it at once; this one gives it a beat.
      await wait(beatMs)
      if (disposed || pageCall(handle.doc())?.id !== call.id) return false
    }

    // 1. `burst`, only while it is null and no stop is in force.
    const id = newId()
    let wrote = false
    // Told before the write, so a view that renders on the change already
    // knows the claim is this page's.
    holding(id)
    handle.change((d) => {
      if (pageCall(d)?.id !== call.id) return
      d.burst = { run: id }
      wrote = true
    })
    if (!wrote) {
      holding(null)
      return false
    }
    held = { id, callId: call.id, controller: null }
    try {
      await wait(beatMs)
      if (gone) return false
      // 2. The claim, only if `burst` still names it and no stop is in force;
      // otherwise its own `burst` let go, if it still names it.
      const mine = { runner: id }
      let claimed = false
      handle.change((d) => {
        if (disposed || d.burst?.run !== id || stopOf(d)) return
        claimed = move(findCall(d, call.id)?.block, "claim", mine)
      })
      if (!claimed) {
        release(id)
        return false
      }
      const controller = (held.controller = new AbortController())

      running(call.tool)
      const outcome = await runCall(call, controller.signal).finally(() => running(null))
      if (gone) return false

      // 3. One change: the move, the result, `made`, and `burst` cleared.
      let moved = false
      handle.change((d) => {
        if (move(findCall(d, call.id)?.block, outcome.isError ? "fail" : "succeed", mine)) {
          moved = true
          if (!findResult(d, call.id)) {
            if (!d.turns) d.turns = []
            d.turns.push(makeTurn("tool", [outcome.result]))
          }
          for (const ref of outcome.made) recordArtifact(d, ref)
        }
        if (d.burst?.run === id) d.burst = null
      })
      // 4. Never under a stop.
      return moved && !stopOf(handle.doc())
    } finally {
      held = null
      holding(null)
    }
  }

  /** Run one claimed call with the page's context and the toolset prepareRun builds for the session. */
  async function runCall(call, signal) {
    // The tools' own writers (session.write, watches) write only while this
    // page's claim may: not after its signal, never under a stop.
    const guarded = guardedStore(store, { signal, settled: Promise.resolve() })
    await Promise.resolve()
    let outcome
    let tool = null
    try {
      const prepared = await prepareRun(handle.doc(), {
        ctx: context,
        store: guarded,
        builtins: opts.builtins ?? [],
        plugins: opts.plugins ?? (async () => []),
        buildToolset: opts.buildToolset ?? null,
        startSession: opts.startSession ?? null,
        followSession: opts.followSession ?? null,
      })
      tool = prepared.toolset.get(call.tool)
      const ctx = prepared.ctx
      const events = ctx.events?.forTool(call.tool)
      outcome = await runTool(tool, call.input, {
        ...ctx,
        ...prepared.privileged(tool),
        signal,
        events,
        recall: storeRecall(guarded),
        hasTool: (id) => !!prepared.toolset.get(id),
      })
      // A page does not wait for the network: what the tool could not do is
      // its answer, and the model may ask again.
      if (outcome.interrupted) Object.assign(outcome, { output: `Error: ${outcome.reason}`, isError: true, summary: `${call.tool} interrupted` })
      for (const after of opts.afterCall ?? []) {
        const earlier = results(handle.doc())
          .map((result) => result.facts)
          .filter(Boolean)
        const more = await after(ctx, call, tool, outcome, earlier)
        const text = typeof more === "string" ? more : more?.text
        if (text) outcome.output = `${outcome.output}\n\n${text}`
        if (more?.facts) outcome.facts = { ...outcome.facts, ...JSON.parse(JSON.stringify(more.facts)) }
      }
    } catch (err) {
      // A scope refused, a toolset that would not build: the call's answer.
      outcome = { output: `Error: ${String(err?.message ?? err)}`, isError: true, summary: `${call.tool} failed` }
    }
    const result = resultBlock(call.id, outcome.output, {
      isError: outcome.isError,
      summary: outcome.summary,
      image: outcome.image ?? null,
      doc: outcome.doc ?? null,
      file: outcome.file ?? null,
      facts: outcome.facts ?? null,
    })
    const made = [outcome.doc, ...(outcome.made ?? [])].filter((ref) => ref?.url)
    return { isError: !!outcome.isError, result, made }
  }

  /** Clear `burst` while it names `id`. */
  function release(id) {
    handle.change((d) => {
      if (d.burst?.run === id) d.burst = null
    })
  }

  /**
   * The page is going: in one change, the call it claimed is abandoned
   * INTERRUPTED (only while it still runs under its claim) and `burst`
   * cleared (only while it names it). It takes nothing more.
   */
  function pagehide() {
    if (gone) return
    gone = true
    disposed = true
    const was = held
    held = null
    if (was) {
      handle.change((d) => {
        const found = was.callId ? findCall(d, was.callId) : null
        if (found && move(found.block, "abandon", { runner: was.id }) && !findResult(d, was.callId)) {
          if (!d.turns) d.turns = []
          d.turns.push(makeTurn("tool", [resultBlock(was.callId, INTERRUPTED, { isError: true, summary: "interrupted", placeholder: true })]))
        }
        if (d.burst?.run === was.id) d.burst = null
      })
      was.controller?.abort("pagehide")
    }
    dispose()
  }

  /** Take nothing more; a call under way still writes its result and clears `burst`. */
  function dispose() {
    disposed = true
    handle.off?.("change", onChange)
    if (typeof target?.removeEventListener === "function") target.removeEventListener("pagehide", onPagehide)
  }

  return { tick, pagehide, dispose }
}
