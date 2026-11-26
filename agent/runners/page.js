/**
 * What a page does for a session it shows or drives: it runs the calls only
 * a page can run. Not yet used: today's runners (runners/tab.js) still run
 * them.
 *
 * A burst never runs a call that needs a page (`where: "host"`): it parks,
 * clears `burst` and ends (kernel/burst.js). A page acts when its copy of the
 * session shows no stop, a null `burst`, and a first runnable call that needs
 * a page:
 *   1. it writes `burst` = a fresh id, only while `burst` is null and no stop
 *      is in force, and waits BEAT_MS;
 *   2. only if `burst` still names its id does it claim the call, and run it
 *      with the page's context and the toolset prepareRun builds; a stop
 *      coming into force aborts the tool's signal;
 *   3. in one change it writes the call's move, its result and `made`, and
 *      clears `burst` (only while the call still runs under its claim, and
 *      `burst` only while it names it);
 *   4. it takes the next such call the same way, never under a stop, and
 *      then asks (`ask`, handed in) for whatever work is left.
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
import { prepareRun } from "../kernel/runner.js"
import { runTool } from "../kernel/tool.js"
import { storeRecall } from "../kernel/loop.js"
import { stopOf } from "../session/status.js"
import { findCall, findResult, move, runnableCalls, results, callsAwaitingApproval, questionsAwaitingAnswer } from "../session/calls.js"
import { makeTurn, resultBlock } from "../session/blocks.js"
import { recordArtifact } from "../session/made.js"
import { INTERRUPTED } from "../session/recovery.js"
import { WHERE } from "../session/schema.js"

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
 * the session waits on a person (an approval or a question, as needsWork
 * says), and only when the first runnable call needs a page.
 */
export function pageCall(doc) {
  if (!doc || stopOf(doc) || doc.burst != null) return null
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
 * @param {object} opts.context     the page's tool context (runners/tab.js builds it); its `repo` is the page's
 * @param {object[]} [opts.builtins]
 * @param {()=>Promise<object[]>} [opts.plugins]
 * @param {(doc:object)=>Promise<object>} [opts.buildToolset]
 * @param {Function[]} [opts.afterCall]  as the loop's (kernel/loop.js)
 * @param {Function} [opts.startSession] how this page runs a step's session, for the workflow tools
 * @param {(mountId:string)=>boolean} [opts.hasMount]  default: the context's getMount
 * @param {()=>Promise<unknown>} [opts.ask]  asks for the session's work once this page has run its calls
 * @param {number} [opts.beatMs]
 * @param {(ms:number)=>Promise<void>} [opts.wait]  the clock
 * @param {()=>string} [opts.newId]
 * @param {Function} [opts.splice]
 * @param {EventTarget|null} [opts.target]  where `pagehide` is heard; default globalThis
 * @returns {{ tick: ()=>Promise<void>, pagehide: ()=>void, dispose: ()=>void }}
 */
export function pageCalls(handle, opts) {
  const context = opts.context ?? {}
  const beatMs = opts.beatMs ?? BEAT_MS
  const wait = opts.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const hasMount = opts.hasMount ?? ((id) => !!context.getMount?.(id))
  const store = handleStore(handle, opts.splice ?? null)

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
    handle.change((d) => {
      if (pageCall(d)?.id !== call.id) return
      d.burst = { run: id }
      wrote = true
    })
    if (!wrote) return false
    held = { id, callId: call.id, controller: null }
    try {
      await wait(beatMs)
      if (gone) return false
      // 2. The claim, only if `burst` still names it and no stop is in force;
      // otherwise its own `burst` let go, if it still names it.
      const mine = { runner: id, generation: null }
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

      const outcome = await runCall(call, controller.signal)
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
        if (found && move(found.block, "abandon", { runner: was.id, generation: null }) && !findResult(d, was.callId)) {
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
