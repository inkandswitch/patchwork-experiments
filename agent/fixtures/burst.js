/**
 * A session run in a test as a pool runs it: one burst (kernel/burst.js) per
 * `tick()`, each a new run of one task, over the store the test reads.
 *
 *   const runner = burstRunner({ store, ctx, buildToolset, getProvider, canRun })
 *   await runner.tick()        // one burst; resolves its result
 *   runner.interrupt()         // the burst under way is cancelled, as from the queue browser
 *   await runner.prepare(doc)  // what a burst's tools would get (kernel/runner.js prepareRun)
 *
 * A memory store (kernel/store.js memoryStore) is found through a stand-in
 * handle whose heads are a change counter; every other url through the
 * test's own repo (`ctx.repo`), if it gave one. The task's runs are every
 * run this runner has made, so a later tick settles what an earlier one
 * left as its own task's.
 *
 * `ask()` is how a page asks (runners/ask.js askWork, in brief): while a
 * burst of this runner is under way it is that burst (asking is asking
 * once); otherwise a new burst when the store's copy shows work a run can do,
 * at most twice at one version of the store. When a burst ends, it judges
 * once more, for what was written while it ran. A test that hears changes
 * asks on each, as a page showing the session does.
 *
 * The network: a burst waits for it inside itself. Here, by default, a burst
 * that would wait ends instead (its pool stopping), the session left saying
 * it is reconnecting, and `tick()` resolves `{ outcome: "reconnecting" }`, as
 * a test of one burst wants. `waitForNetwork` replaces that.
 */

import { runBurst } from "../kernel/burst.js"
import { prepareRun, fullContext } from "../kernel/runner.js"
import { recordingEvents } from "../kernel/events.js"
import { needsWork } from "../kernel/runner.js"

/** A DocHandle's surface, over a memory store. */
export function memoryHandle(store) {
  let version = 0
  const unsubscribe = new Map()
  store.onChange?.(() => version++)
  return {
    url: store.url,
    doc: () => store.doc(),
    change: (fn) => store.change(fn),
    heads: () => [`h${version}`],
    on(event, fn) {
      if (event !== "change" || !store.onChange) return
      unsubscribe.set(fn, store.onChange(() => fn({ doc: store.doc() })))
    },
    off(event, fn) {
      unsubscribe.get(fn)?.()
      unsubscribe.delete(fn)
    },
  }
}

/** Is `store` one a test made itself (a memory store, or one with no repo behind it), not a real handle's? */
const ownStore = (store, repo) => !!store.onChange || !repo || !store.appendTextIn

/** A repo that finds `store` by its url, and anything else through `repo`. */
export function repoWith(store, repo = null) {
  const handle = ownStore(store, repo) ? memoryHandle(store) : null
  const find = async (url, ...rest) => {
    if (handle && String(url).split("#")[0] === store.url) return handle
    if (!repo) throw new Error(`No document ${url} here.`)
    return repo.find(url, ...rest)
  }
  return new Proxy(repo ?? {}, {
    get(target, key) {
      if (key === "find") return find
      const value = target[key]
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

/** Text appended to a plain object's field: a memory store's splice. */
function plainSplice(draft, path, index, remove, text) {
  let node = draft
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]]
  const key = path[path.length - 1]
  const was = String(node[key] ?? "")
  node[key] = was.slice(0, index) + text + was.slice(index + remove)
}

let made = 0

export function burstRunner(opts) {
  const store = opts.store
  const base = opts.ctx ?? {}
  const repo = repoWith(store, base.repo ?? null)
  const prefix = opts.runnerUrl ?? `run-${++made}`
  const runs = []
  const own = []
  let controller = null
  let waited = false
  // Asking, as a page asks: the burst under way, and the asks at one version.
  let current = null
  let changes = 0
  store.onChange?.(() => changes++)
  // A real handle's heads, once found; a test store's count of its changes.
  let real = null
  if (!ownStore(store, base.repo ?? null)) Promise.resolve(base.repo.find(store.url)).then((h) => (real = h), () => {})
  const version = () => (real?.heads ? real.heads().join(",") : String(changes))
  let asked = { at: null, count: 0 }
  const askCanRun = opts.canRun ?? ((where) => where === "worker")

  const runner = {
    store,
    repo,
    getProvider: opts.getProvider,
    runs,
    own,
    /** The run under way, or the last. */
    run: null,
    async tick() {
      const run = `${prefix}${runs.length ? `-${runs.length + 1}` : ""}`
      runs.push(run)
      runner.run = run
      controller = new AbortController()
      waited = false
      const ctx = {
        repo,
        signal: controller.signal,
        run,
        taskUrl: "automerge:task",
        settled: opts.settled ?? Promise.resolve(),
        progress: (value) => {
          for (const hash of value?.own ?? []) if (!own.includes(hash)) own.push(hash)
        },
        log: () => {},
      }
      const mine = controller
      const result = await runBurst(ctx, {
        session: store.url,
        taskRuns: () => opts.taskRuns?.() ?? runs,
        getProvider: () => runner.getProvider(),
        key: opts.getKey?.() ?? null,
        context: { ...base, repo },
        builtins: opts.builtins ?? [],
        plugins: async () => (typeof opts.pluginTools === "function" ? ((await opts.pluginTools().catch(() => [])) ?? []) : []),
        buildToolset: opts.buildToolset ?? null,
        sections: opts.sections ?? [],
        afterCall: opts.afterCall ?? [],
        system: opts.system,
        canRun: opts.canRun,
        getModelInfo: opts.getModelInfo,
        onEvent: opts.onEvent,
        splice: ownStore(store, base.repo ?? null) ? plainSplice : undefined,
        flushMs: opts.flushMs ?? 5,
        waitForNetwork:
          opts.waitForNetwork ??
          (async () => {
            waited = true
            mine.abort("stopping")
          }),
      })
      if (controller === mine) controller = null
      return waited && result.outcome === "stopping" ? { ...result, outcome: "reconnecting" } : result
    },
    /** Ask for the session's work, as a page does: see the header. */
    ask() {
      if (current) return current
      if (!needsWork(store.doc(), askCanRun)) return Promise.resolve({ asked: false, why: "no work" })
      const at = version()
      if (asked.at === at && asked.count >= 2) return Promise.resolve({ asked: false, why: "asked twice at these heads" })
      asked = { at, count: (asked.at === at ? asked.count : 0) + 1 }
      const going = runner.tick().finally(() => {
        if (current === going) current = null
      })
      current = going
      // The task it followed has ended: judge once more.
      going.then(() => runner.ask()).catch(() => {})
      return going
    },
    /** Cancel the burst under way, as the queue browser's stop does. */
    interrupt(reason = "cancelled") {
      controller?.abort(reason)
    },
    stop() {
      runner.interrupt()
    },
    /** What a burst's tools would get for `doc`. */
    async prepare(doc) {
      const ctx = { events: recordingEvents(), ...base, repo }
      return prepareRun(doc, {
        ctx,
        store,
        fullCtx: fullContext(ctx, store),
        builtins: opts.builtins ?? [],
        plugins: async () => (typeof opts.pluginTools === "function" ? ((await opts.pluginTools().catch(() => [])) ?? []) : []),
        buildToolset: opts.buildToolset ?? null,
      })
    },
  }
  return runner
}
