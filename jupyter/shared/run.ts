/**
 * Before and after a run: resolving a notebook's imports live and making
 * them importable in its kernel, and recording what the run ran with. The
 * native tool and notebook_run both run cells through CellRunner with these
 * hooks, so a person's run and the agent's resolve and record the same way.
 *
 * No DOM and no bare imports: this runs in a page, and in a worker.
 */

import type { KernelClient } from "../native/src/kernel/types"
import type { RunnerHooks, RunOutcome } from "./cells"
import {
  codeFingerprint,
  type DatatypeHook,
  importsOf,
  moduleSource,
  nameProblem,
  type NotebookImport,
  outputsFingerprint,
  type ResolvedImport,
  type RunRecord,
  setupCode,
  sourceOf,
  titleOf,
} from "./imports"
import type { NotebookWriter } from "./notebook-writer"

/** Opens a document: `repo.find`, as far as this file cares. */
export type FindDoc = (url: string) => Promise<{ doc(): any; heads?(): string[] | undefined }>

/**
 * A datatype's implementation by id: the implementation, null when no such
 * datatype is registered, undefined when the registry can't be consulted here.
 */
export type DatatypeLookup = (type: string) => Promise<DatatypeHook | undefined>

/** Patchwork's plugin registry (the module `@inkandswitch/patchwork-plugins`) as a DatatypeLookup. */
export function lookupIn(plugins: any): DatatypeLookup {
  const registry = plugins?.getRegistry?.("patchwork:datatype")
  if (!registry) return async () => undefined
  return async type => {
    if (!registry.get?.(type)) return null
    try {
      return ((await registry.load(type))?.module ?? null) as DatatypeHook
    } catch {
      return null
    }
  }
}

/** A lookup for a realm with no registry. */
export const noRegistry: DatatypeLookup = async () => undefined

const FIND_TIMEOUT_MS = 15_000

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} didn't open within ${Math.round(ms / 1000)} s`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Every import as it is now: each document opened, its heads read, and its
 * module's source made, in the order shared/imports.ts gives. A document
 * that can't be opened becomes a module that raises ImportError saying so.
 * `notes` says what a person or the agent should know, such as an import
 * bound as JSON only because the registry couldn't be consulted here.
 */
export async function resolveImports(
  imports: NotebookImport[],
  { find, datatype, timeoutMs = FIND_TIMEOUT_MS }: { find: FindDoc; datatype: DatatypeLookup; timeoutMs?: number },
): Promise<{ resolved: ResolvedImport[]; notes: string[] }> {
  const notes: string[] = []
  const resolved = await Promise.all(
    imports.map(async (imp): Promise<ResolvedImport> => {
      let handle: Awaited<ReturnType<FindDoc>>
      let doc: any
      try {
        handle = await within(Promise.resolve().then(() => find(imp.docUrl)), timeoutMs, imp.name)
        doc = handle.doc()
        if (!doc) throw new Error("it is empty or unavailable")
      } catch (error) {
        const problem = (error as Error)?.message ?? String(error)
        const missing = { kind: "missing" as const, text: "", title: imp.name, problem }
        return { ...imp, kind: "missing", title: imp.name, heads: [], type: null, module: moduleSource(imp, missing), problem }
      }
      const heads = [...(handle.heads?.() ?? [])]
      const type: string | null = typeof doc["@patchwork"]?.type === "string" ? doc["@patchwork"].type : null
      const title = titleOf(doc)
      const hook = type ? await datatype(type) : null
      let source: ReturnType<typeof sourceOf>
      try {
        source = sourceOf(doc, hook)
      } catch (error) {
        const problem = (error as Error)?.message ?? String(error)
        return { ...imp, kind: "missing", title, heads, type, module: moduleSource(imp, { kind: "missing", text: "", title, problem }), problem }
      }
      if (hook === undefined && source.kind === "json" && type) {
        notes.push(`${imp.name} ("${title}", a ${type}) is bound as JSON: the plugin registry can't be consulted here, so its datatype couldn't give Python source.`)
      }
      return { ...imp, kind: source.kind, title, heads, type, module: moduleSource(imp, { ...source, title }) }
    }),
  )
  return { resolved, notes }
}

/** The record of a run's imports: names, documents, versions, how each was bound. */
export function importsRecord(resolved: ResolvedImport[]): RunRecord["imports"] {
  return resolved.map(r => ({ name: r.name, docUrl: r.docUrl, title: r.title, heads: r.heads, as: r.kind, type: r.type, ...(r.problem ? { problem: r.problem } : {}) }))
}

/** Why the imports can't be set up as they are (bad or duplicate names), or null. */
export function importsProblem(imports: NotebookImport[]): string | null {
  for (let i = 0; i < imports.length; i++) {
    const problem = nameProblem(imports[i].name, imports.slice(0, i).map(x => x.name))
    if (problem) return `import ${problem}`
  }
  return null
}

export type RunContext = {
  writer: NotebookWriter
  kernel: KernelClient
  find: FindDoc
  datatype: DatatypeLookup
  by: RunRecord["by"]
  timeoutMs?: number
  now?: () => Date
}

/** What the last batch resolved and recorded, for whoever started it to report. */
export type LastRun = { resolved: ResolvedImport[]; notes: string[]; record: RunRecord }

/**
 * The hooks a CellRunner runs a batch with. prepare: resolve the imports,
 * write their modules into the kernel (setupCode), record the run as
 * running; a problem (a bad name, a name hiding a module Python has) is
 * recorded and stops the batch. finish: record when and how it ended, which
 * cells ran, and the outputs' fingerprint, so a reader can tell the record
 * describes the outputs it sits beside.
 */
export function runHooks(context: RunContext): Pick<RunnerHooks, "prepare" | "finish"> & { last(): LastRun | null } {
  const { writer, kernel, find, datatype, by, timeoutMs } = context
  const now = () => (context.now?.() ?? new Date()).toISOString()
  let last: LastRun | null = null
  let lastGeneration: number | null = null

  return {
    last: () => last,
    async prepare(ids) {
      const doc = writer.current()
      const fresh = lastGeneration !== kernel.generation
      lastGeneration = kernel.generation
      const imports = importsOf(doc)
      const { resolved, notes } = await resolveImports(imports, { find, datatype, timeoutMs })
      const record: RunRecord = {
        at: now(),
        finished: null,
        status: "running",
        by,
        cells: ids,
        kernel: fresh ? "fresh" : "continued",
        code: codeFingerprint(doc, writer.heads()),
        outputs: null,
        imports: importsRecord(resolved),
      }
      last = { resolved, notes, record }
      let problem = importsProblem(imports)
      if (!problem) {
        const reply = await kernel.executeSilent(setupCode(Object.fromEntries(resolved.map(r => [r.name, r.module]))))
        if (reply.status !== "ok") {
          const error = reply as { ename?: string; evalue?: string }
          problem = `the imports couldn't be set up: ${error.ename ?? "error"}: ${error.evalue ?? ""}`.trim()
        }
      }
      if (problem) {
        last.record = { ...record, status: "error", finished: now(), cells: [], outputs: outputsFingerprint(writer.current()), problem }
        writer.setPatchworkMetadata({ run: last.record })
        throw new Error(problem)
      }
      writer.setPatchworkMetadata({ run: record })
    },
    finish(outcome: RunOutcome) {
      if (outcome.problem || !last) return
      const ran = outcome.results.filter(r => r.status === "ok" || r.status === "error")
      const status = outcome.results.some(r => r.status === "error") ? "error" : outcome.results.some(r => r.status === "stopped") ? "stopped" : "ok"
      last.record = { ...last.record, finished: now(), status, cells: ran.map(r => r.id), outputs: outputsFingerprint(writer.current()) }
      writer.setPatchworkMetadata({ run: last.record })
    },
  }
}
