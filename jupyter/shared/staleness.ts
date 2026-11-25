/**
 * Whether a notebook's last run is out of date: whether any document it read
 * has changed in a way that touches what it read.
 *
 *   an import       its module's text now (made the same way, through its
 *                   datatype) against the hash the run recorded; an import
 *                   is read whole, so any change to its text counts.
 *   a load          each path the cells read: the value there now (or the
 *                   keys of a mapping, or the length of a list) against the
 *                   hash the run recorded. A change elsewhere in the
 *                   document doesn't count.
 *   unchanged heads fresh, without reading anything.
 *   can't be opened stale: the run can't be repeated as it was.
 *
 * Pure (decide) over documents opened by the caller (assess), so the view,
 * notebook_run and tests share one decision.
 */

import { docToJson, moduleHash, moduleSource, readHash, type RunRecord, sourceOf } from "./imports"
import { type DatatypeLookup, type FindDoc, jsonView, type Opened, openDocuments } from "./run"

export type StaleReason = {
  docUrl: string
  title: string
  why: "changed" | "missing"
  /** The paths read that changed ("entries.pack_series.value"); empty for an import, which is read whole. */
  paths: string[]
  /** The import's name, when it was read as one. */
  name?: string
}

export type Staleness = { stale: boolean; reasons: StaleReason[] }

const same = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
export const pathText = (path: ReadonlyArray<string | number>) => (path.length ? path.map(String).join(".") : "the whole document")

/** The decision, over documents as they are now (`opened`, by URL). */
export function decide(run: RunRecord | null, opened: Map<string, Opened>): Staleness {
  const reasons: StaleReason[] = []
  if (!run) return { stale: false, reasons }
  for (const imp of run.imports ?? []) {
    if (imp.as === "missing") continue
    const now = opened.get(imp.docUrl)
    if (!now || now.problem !== undefined) {
      reasons.push({ docUrl: imp.docUrl, title: imp.title, why: "missing", paths: [], name: imp.name })
      continue
    }
    if (same(now.heads, imp.heads)) continue
    let text: string
    try {
      const source = sourceOf(now.doc, now.hook)
      text = moduleSource({ name: imp.name, docUrl: imp.docUrl }, { ...source, title: now.title })
    } catch {
      text = ""
    }
    if (moduleHash(text) !== imp.hash) reasons.push({ docUrl: imp.docUrl, title: now.title, why: "changed", paths: [], name: imp.name })
  }
  for (const read of run.reads ?? []) {
    const now = opened.get(read.docUrl)
    if (!now || now.problem !== undefined) {
      reasons.push({ docUrl: read.docUrl, title: read.title, why: "missing", paths: [] })
      continue
    }
    if (same(now.heads, read.heads)) continue
    const data = read.as === "json" ? jsonView(now.doc, now.hook) : docToJson(now.doc)
    const changed = read.paths.filter(p => readHash(data, p.path, !!p.keys) !== p.hash).map(p => pathText(p.path))
    if (changed.length) reasons.push({ docUrl: read.docUrl, title: now.title, why: "changed", paths: [...new Set(changed)] })
  }
  return { stale: reasons.length > 0, reasons }
}

/** Every document the run read, as recorded. */
export function readUrls(run: RunRecord | null): string[] {
  return [...new Set([...(run?.imports ?? []).filter(i => i.as !== "missing").map(i => i.docUrl), ...(run?.reads ?? []).map(r => r.docUrl)])]
}

/** Opens what the run read and decides. */
export async function assess(run: RunRecord | null, { find, datatype, timeoutMs }: { find: FindDoc; datatype: DatatypeLookup; timeoutMs?: number }): Promise<Staleness> {
  if (!run) return { stale: false, reasons: [] }
  return decide(run, await openDocuments(readUrls(run), { find, datatype, timeoutMs }))
}

/** One line for people and the agent: "Nootka assumptions changed since the last run (entries.pack_series.value)". */
export function staleText(staleness: Staleness, limit = 3): string {
  return staleness.reasons
    .map(r => {
      if (r.why === "missing") return `"${r.title}" can't be opened`
      const paths = r.paths.length ? ` (${r.paths.slice(0, limit).join(", ")}${r.paths.length > limit ? `, and ${r.paths.length - limit} more` : ""})` : ""
      return `"${r.title}" changed${paths}`
    })
    .join("; ")
}
