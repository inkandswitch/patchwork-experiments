/**
 * notebook_run: the agent runs a notebook's cells headless, the way a person
 * does with the run buttons: imports resolved and made importable first, the
 * run recorded in the notebook, outputs and execution counts written into
 * the document as they arrive (CellRunner, the same code the view runs).
 *
 * No DOM, no `window`, and no bare imports, so it loads in a worker as well
 * as a page: Automerge comes from the context or the page's importmap, else
 * a stand-in (shared/automerge.ts); the plugin registry likewise, else none.
 * Python runs in Pyodide in its own Worker.
 */

import { automergeStandIn, hasAutomerge, setAutomerge, type Automerge } from "../shared/automerge"
import { CellRunner, type RunOutcome } from "../shared/cells"
import { importsOf, titleOf } from "../shared/imports"
import { kernelConfig } from "../shared/kernel-config"
import { NotebookWriter } from "../shared/notebook-writer"
import { type DatatypeLookup, type LastRun, lookupIn, noRegistry, runHooks } from "../shared/run"
import { kernelBootstrap } from "../shared/types"
import { PyodideKernelClient } from "../native/src/kernel/pyodide"
import { type Input, linkImports, pickCells, report, strip } from "./notebook-run"

export { linkImports, pickCells, report }

/** Built by native/scripts/build_kernel.py; chunks live in dist/, next to native/. */
const PYODIDE_URL = new URL(/* @vite-ignore */ "./native/pyodide/pyodide.mjs", import.meta.url).href

const IDLE_MS = 10 * 60_000
const MAX_KERNELS = 2
const DEFAULT_TIMEOUT_S = 600
const MAX_TIMEOUT_S = 1800

type Ctx = { repo: { find(url: string): Promise<any> }; automerge?: Automerge; plugins?: unknown; signal?: AbortSignal }

/** Bare specifiers as variables, so neither a bundler nor a worker without an importmap trips on them. */
const AUTOMERGE = "@automerge/automerge"
const PLUGINS = "@inkandswitch/patchwork-plugins"
const tryImport = async (specifier: string): Promise<any> => {
  try {
    return await import(/* @vite-ignore */ specifier)
  } catch {
    return null
  }
}

async function ensureAutomerge(ctx: Ctx): Promise<void> {
  if (hasAutomerge()) return
  const module = ctx.automerge ?? (await tryImport(AUTOMERGE))
  setAutomerge(module?.ImmutableString && module?.splice ? module : automergeStandIn())
}

async function datatypeLookup(ctx: Ctx): Promise<DatatypeLookup> {
  const plugins = ctx.plugins ?? (await tryImport(PLUGINS))
  return plugins ? lookupIn(plugins) : noRegistry
}

// ---------------------------------------------------------------- kernels

type Session = { url: string; kernel: PyodideKernelClient; runner: CellRunner; last(): LastRun | null; timer?: ReturnType<typeof setTimeout> }

/** This realm's kernels, one per notebook, kept between calls so a later call can carry on; the least recently used goes first. */
const sessions = new Map<string, Session>()

function drop(url: string): void {
  const session = sessions.get(url)
  if (!session) return
  sessions.delete(url)
  clearTimeout(session.timer)
  session.runner.dispose()
  session.kernel.dispose()
}

function keepAlive(session: Session): void {
  clearTimeout(session.timer)
  session.timer = setTimeout(() => drop(session.url), IDLE_MS)
}

function sessionFor(url: string, handle: any, ctx: Ctx, datatype: DatatypeLookup): Session {
  const existing = sessions.get(url)
  if (existing) {
    sessions.delete(url)
    sessions.set(url, existing)
    return existing
  }
  while (sessions.size >= MAX_KERNELS) drop(sessions.keys().next().value!)
  if (typeof Worker === "undefined") throw new Error("Python can't start here: this realm can't start a Worker for Pyodide.")
  const kernel = new PyodideKernelClient({ pyodideUrl: PYODIDE_URL, bootstrap: kernelBootstrap(kernelConfig(ctx.repo as any)) })
  const writer = new NotebookWriter(handle)
  const hooks = runHooks({ writer, kernel, find: u => ctx.repo.find(u), datatype, by: "agent" })
  const session: Session = { url, kernel, runner: new CellRunner(writer, kernel, hooks), last: hooks.last }
  sessions.set(url, session)
  return session
}

// ---------------------------------------------------------------- the tool

export const notebookRun = {
  async execute(input: Input, ctx: Ctx): Promise<string> {
    if (!input?.url) throw new Error("Pass `url`: the automerge: URL of a Jupyter notebook.")
    const url = strip(input.url)
    const handle = await ctx.repo.find(url)
    const doc = handle.doc()
    if (!Array.isArray(doc?.cells)) throw new Error(`${url} isn't a Jupyter notebook (it has no cells).`)
    await ensureAutomerge(ctx)
    const writer = new NotebookWriter(handle)

    if (input.link?.length || input.unlink?.length) {
      const imports = await linkImports(importsOf(doc), input, async u => {
        try {
          return titleOf((await ctx.repo.find(u)).doc())
        } catch {
          return "data"
        }
      })
      writer.setPatchworkMetadata({ imports })
    }

    const ids = pickCells(handle.doc(), input.cells)
    if (!ids.length) return `"${titleOf(doc)}" has no code cells; nothing ran.`
    const datatype = await datatypeLookup(ctx)
    if (input.restart) drop(url)
    const session = sessionFor(url, handle, ctx, datatype)
    keepAlive(session)

    const started = Date.now()
    const timeout = Math.min(Math.max(Number(input.timeout) || DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S) * 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const outcome = await Promise.race([
      session.runner.run(ids),
      new Promise<RunOutcome>(resolve => {
        timer = setTimeout(() => {
          timedOut = true
          resolve({ results: ids.map(id => ({ id, status: "stopped", executionCount: null })) })
        }, timeout)
      }),
    ]).finally(() => clearTimeout(timer))
    if (timedOut) drop(url)
    const last = session.last()
    return report({ title: titleOf(handle.doc()), doc: handle.doc(), outcome, last, elapsedMs: Date.now() - started, notes: last?.notes ?? [], timedOut })
  },

  summarize(input: Input, output: string): string {
    const first = String(output ?? "").split("\n")[0]
    return `run notebook · ${first.replace(/^Ran /, "").slice(0, 120)}`
  },
}

export default notebookRun
