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
  docToJson,
  documentUrlsIn,
  type DocumentFiles,
  importsOf,
  moduleHash,
  moduleSource,
  nameProblem,
  type NotebookImport,
  outputsFingerprint,
  type ReadRecord,
  READS_CODE,
  readHash,
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

/** A document as opened before a run: what it is now, or why it couldn't be opened. */
export type Opened =
  | { url: string; doc: any; heads: string[]; type: string | null; title: string; hook: DatatypeHook | undefined; problem?: undefined }
  | { url: string; problem: string; doc?: undefined; heads?: undefined; type?: undefined; title?: undefined; hook?: undefined }

/** Opens each document once, reading its heads and looking up its datatype; never throws. */
export async function openDocuments(urls: string[], { find, datatype, timeoutMs = FIND_TIMEOUT_MS }: { find: FindDoc; datatype: DatatypeLookup; timeoutMs?: number }): Promise<Map<string, Opened>> {
  const out = new Map<string, Opened>()
  await Promise.all(
    [...new Set(urls)].map(async url => {
      try {
        const handle = await within(Promise.resolve().then(() => find(url)), timeoutMs, url)
        const doc = handle.doc()
        if (!doc) throw new Error("it is empty or unavailable")
        const heads = [...(handle.heads?.() ?? [])]
        const type: string | null = typeof doc["@patchwork"]?.type === "string" ? doc["@patchwork"].type : null
        out.set(url, { url, doc, heads, type, title: titleOf(doc), hook: type ? await datatype(type) : null })
      } catch (error) {
        out.set(url, { url, problem: (error as Error)?.message ?? String(error) })
      }
    }),
  )
  return out
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
  { find, datatype, timeoutMs = FIND_TIMEOUT_MS, opened }: { find: FindDoc; datatype: DatatypeLookup; timeoutMs?: number; opened?: Map<string, Opened> },
): Promise<{ resolved: ResolvedImport[]; notes: string[] }> {
  const docs = opened ?? (await openDocuments(imports.map(i => i.docUrl), { find, datatype, timeoutMs }))
  const notes: string[] = []
  const resolved = imports.map((imp): ResolvedImport => {
    const it = docs.get(imp.docUrl) ?? { url: imp.docUrl, problem: "it wasn't opened" }
    if (it.problem !== undefined) {
      const problem = it.problem.replace(imp.docUrl, imp.name)
      return { ...imp, kind: "missing", title: imp.name, heads: [], type: null, module: moduleSource(imp, { kind: "missing", text: "", title: imp.name, problem }), problem }
    }
    const { doc, heads, type, title, hook } = it
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
  })
  return { resolved, notes }
}

/** A document's datatype JSON view (asSource(doc, "json")) as data, or undefined when it has none. */
export function jsonView(doc: any, hook: DatatypeHook | undefined): unknown {
  if (typeof hook?.asSource !== "function") return undefined
  try {
    const text = hook.asSource(doc, "json")
    return typeof text === "string" ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

/** What a document is as patchwork.load gives it: the raw data and its JSON view, if any. */
export type Snapshot = { raw: unknown; json: unknown; title: string; heads: string[] }

/**
 * The files patchwork.load reads, for every opened document (imports and
 * URLs in the code alike), and the snapshots they were made from, to hash
 * what the cells read.
 */
export function documentFiles(opened: Map<string, Opened>, imports: NotebookImport[]): { files: DocumentFiles; snapshots: Map<string, Snapshot> } {
  const files: DocumentFiles = { index: { names: Object.fromEntries(imports.map(i => [i.name, i.docUrl])), documents: {} }, files: {} }
  const snapshots = new Map<string, Snapshot>()
  let n = 0
  for (const [url, it] of opened) {
    if (it.problem !== undefined) {
      files.index.documents[url] = { title: url, problem: it.problem }
      continue
    }
    n++
    const raw = docToJson(it.doc) ?? {}
    const json = jsonView(it.doc, it.hook)
    files.files[`${n}.raw.json`] = JSON.stringify(raw)
    if (json !== undefined) files.files[`${n}.view.json`] = JSON.stringify(json)
    files.index.documents[url] = { title: it.title, raw: `${n}.raw.json`, ...(json !== undefined ? { json: `${n}.view.json` } : {}) }
    snapshots.set(url, { raw, json, title: it.title, heads: it.heads })
  }
  return { files, snapshots }
}

/** The run record's reads, from what the kernel says the cells loaded and the snapshots they loaded it from. */
export function readsRecord(loaded: Array<{ docUrl: string; as: "raw" | "json"; paths: Array<{ path: Array<string | number>; keys?: boolean }> }>, snapshots: Map<string, Snapshot>): ReadRecord[] {
  const out: ReadRecord[] = []
  for (const read of loaded) {
    const snap = snapshots.get(read.docUrl)
    if (!snap) continue
    const data = read.as === "json" ? snap.json : snap.raw
    out.push({
      docUrl: read.docUrl,
      title: snap.title,
      heads: snap.heads,
      as: read.as,
      paths: read.paths.map(p => ({ path: p.path, ...(p.keys ? { keys: true } : {}), hash: readHash(data, p.path, !!p.keys) })),
    })
  }
  return out.sort((a, b) => (a.docUrl < b.docUrl ? -1 : a.docUrl > b.docUrl ? 1 : a.as < b.as ? -1 : 1))
}

/** The record of a run's imports: names, documents, versions, how each was bound. */
export function importsRecord(resolved: ResolvedImport[]): RunRecord["imports"] {
  return resolved.map(r => ({ name: r.name, docUrl: r.docUrl, title: r.title, heads: r.heads, as: r.kind, type: r.type, hash: moduleHash(r.module), ...(r.problem ? { problem: r.problem } : {}) }))
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
export type LastRun = { resolved: ResolvedImport[]; notes: string[]; record: RunRecord; snapshots: Map<string, Snapshot> }

/**
 * The hooks a CellRunner runs a batch with. prepare: open every document the
 * run may read (its imports, and every automerge: URL in its code), write
 * the imports' modules and the documents patchwork.load reads into the
 * kernel (setupCode), and record the run as running; a problem (a bad name,
 * a name hiding a module Python has) is recorded and stops the batch.
 * finish: ask the kernel what the cells loaded, and record that with when
 * and how the run ended, which cells ran, and the outputs' fingerprint, so a
 * reader can tell the record describes the outputs it sits beside.
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
      const opened = await openDocuments([...imports.map(i => i.docUrl), ...documentUrlsIn(doc)], { find, datatype, timeoutMs })
      const { resolved, notes } = await resolveImports(imports, { find, datatype, opened })
      const { files, snapshots } = documentFiles(opened, imports)
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
        reads: [],
      }
      last = { resolved, notes, record, snapshots }
      let problem = importsProblem(imports)
      if (!problem) {
        const reply = await kernel.executeSilent(setupCode(Object.fromEntries(resolved.map(r => [r.name, r.module])), files))
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
    async finish(outcome: RunOutcome) {
      if (outcome.problem || !last) return
      const current = last
      let reads: ReadRecord[] = []
      try {
        reads = readsRecord(JSON.parse((await kernel.capture(READS_CODE)).trim() || "[]"), current.snapshots)
      } catch (error) {
        console.warn("[jupyter] couldn't read what the run loaded", error)
      }
      const ran = outcome.results.filter(r => r.status === "ok" || r.status === "error")
      const status = outcome.results.some(r => r.status === "error") ? "error" : outcome.results.some(r => r.status === "stopped") ? "stopped" : "ok"
      current.record = { ...current.record, finished: now(), status, cells: ran.map(r => r.id), outputs: outputsFingerprint(writer.current()), reads }
      writer.setPatchworkMetadata({ run: current.record })
    },
  }
}
