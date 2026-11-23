/**
 * notebook_run's input and output, pure: which cells, linking, and the
 * compact report. Apart from agent-tool.ts so it is testable without a kernel.
 */

import type { CellResult, RunOutcome } from "../shared/cells"
import { importName, type NotebookImport, nameProblem, resultLines, str } from "../shared/imports"
import type { LastRun } from "../shared/run"
import { type Staleness, staleText } from "../shared/staleness"
import type { RunRecord } from "../shared/imports"

/** Whether the last run is out of date, as a line: what it read that changed, or that it is current. */
export function staleLine(run: RunRecord | null, staleness: Staleness): string {
  if (!run) return "It had no recorded run."
  if (!staleness.stale) return `It was up to date: nothing its last run read (${run.imports.length + (run.reads ?? []).length} document${run.imports.length + (run.reads ?? []).length === 1 ? "" : "s"}) has changed in what it read.`
  return `It was stale: ${staleText(staleness, 6)} since its last run.`
}

/** notebook_run with \`check\`: staleness alone, without running. */
export function checkReport(title: string, run: RunRecord | null, staleness: Staleness): string {
  const line = staleLine(run, staleness).replace(/^It was /, "It is ").replace(/^It had /, "It has ")
  const when = run ? ` Last run ${run.at}${run.by === "agent" ? " by the agent" : ""}, ${run.status}.` : ""
  return `"${title}": ${line}${when}${staleness.stale ? " Run it (notebook_run) to bring its outputs up to date." : ""}`
}

export type Input = {
  url: string
  cells?: "all" | Array<number | string>
  restart?: boolean
  timeout?: number
  link?: Array<{ url: string; name?: string }>
  unlink?: string[]
  check?: boolean
}

// ---------------------------------------------------------------- input

export const strip = (url: string) => String(url).trim().split("#")[0]

/** The cell ids to run, from `cells`: all code cells, or cell numbers (from 1, as this tool prints them) and ids. */
export function pickCells(doc: any, cells: Input["cells"]): string[] {
  const all: any[] = Array.isArray(doc?.cells) ? doc.cells : []
  const isCode = (c: any) => str(c?.cell_type) === "code"
  if (cells === undefined || cells === "all") return all.filter(isCode).map(c => str(c.id))
  if (!Array.isArray(cells) || !cells.length) throw new Error('`cells` is "all" or a list of cell numbers (from 1) or cell ids.')
  const out: string[] = []
  const wrong: string[] = []
  for (const want of cells) {
    const index = typeof want === "number" || /^\d+$/.test(String(want)) ? Number(want) - 1 : all.findIndex(c => str(c?.id) === String(want))
    const cell = all[index]
    if (!cell) wrong.push(`${JSON.stringify(want)} (the notebook has ${all.length} cells)`)
    else if (!isCode(cell)) wrong.push(`cell ${index + 1} (a ${str(cell.cell_type)} cell)`)
    else if (!out.includes(str(cell.id))) out.push(str(cell.id))
  }
  if (wrong.length) throw new Error(`These aren't code cells: ${wrong.join(", ")}. Nothing ran.`)
  return out.sort((a, b) => all.findIndex(c => str(c.id) === a) - all.findIndex(c => str(c.id) === b))
}

/** The imports after linking and unlinking, or a problem naming what's wrong. */
export async function linkImports(current: NotebookImport[], input: Pick<Input, "link" | "unlink">, titleOfUrl: (url: string) => Promise<string>): Promise<NotebookImport[]> {
  let imports = current.filter(i => !(input.unlink ?? []).includes(i.name))
  for (const name of input.unlink ?? []) if (!current.some(i => i.name === name)) throw new Error(`There is no import called ${name} to unlink; the imports are ${current.map(i => i.name).join(", ") || "none"}.`)
  for (const item of input.link ?? []) {
    const url = strip(item?.url ?? "")
    if (!/^automerge:/.test(url)) throw new Error(`link: ${JSON.stringify(item?.url)} isn't a document URL (automerge:…).`)
    const others = imports.filter(i => i.docUrl !== url)
    const name = item.name ?? imports.find(i => i.docUrl === url)?.name ?? importName(await titleOfUrl(url), others.map(i => i.name))
    const problem = nameProblem(name, others.map(i => i.name))
    if (problem) throw new Error(`link: ${problem}.`)
    imports = imports.some(i => i.docUrl === url) ? imports.map(i => (i.docUrl === url ? { name, docUrl: url } : i)) : [...imports, { name, docUrl: url }]
  }
  return imports
}

// ---------------------------------------------------------------- output

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)
const KINDS: Record<string, string> = {
  hook: "Python from its datatype",
  "py-file": "its Python",
  notebook: "its code cells",
  json: "its data, as the dict `data`",
  missing: "not available",
}
const version = (heads: string[]) => (heads.length ? heads.map(h => h.slice(0, 8)).join("+") : "?")

/** The run as compact text: a summary line, the imports, a line per cell, result lines, a stdout tail. Pure. */
export function report({
  title,
  doc,
  outcome,
  last,
  elapsedMs,
  notes = [],
  timedOut = false,
  before = null,
}: {
  title: string
  doc: any
  outcome: RunOutcome
  last: LastRun | null
  elapsedMs: number
  notes?: string[]
  timedOut?: boolean
  /** Whether it was stale before this run, and why. */
  before?: string | null
}): string {
  const cells: any[] = Array.isArray(doc?.cells) ? doc.cells : []
  const number = (id: string) => cells.findIndex(c => str(c?.id) === id) + 1
  const count = (status: CellResult["status"]) => outcome.results.filter(r => r.status === status).length
  const tally = (["ok", "error", "skipped", "stopped"] as const).filter(s => count(s)).map(s => `${count(s)} ${s}`).join(", ")
  const lines: string[] = []
  const kernel = last?.record.kernel === "fresh" ? "fresh kernel" : "kernel carried on from earlier runs"
  lines.push(`Ran "${title}": ${tally || "nothing"} in ${(elapsedMs / 1000).toFixed(1)} s (${kernel}).`)
  if (before) lines.push(before)
  if (timedOut) lines.push("Stopped: it ran past the time limit, so the kernel was shut down. Pass a longer `timeout` or fix the cell that hangs.")
  if (outcome.problem) lines.push(`It didn't run: ${outcome.problem}`)
  if (last?.resolved.length) {
    lines.push(`Imports: ${last.resolved.map(r => `${r.name} ← "${r.title}" (${KINDS[r.kind]}${r.kind === "missing" ? `: ${r.problem}` : `, version ${version(r.heads)}`})`).join("; ")}`)
  }
  for (const note of notes) lines.push(`Note: ${note}`)
  const first = outcome.results.find(r => r.status !== "ok")
  if (last?.record.kernel === "fresh" && outcome.results.length) {
    const firstRun = Math.min(...outcome.results.map(r => number(r.id)))
    const earlier = cells.slice(0, firstRun - 1).filter(c => str(c?.cell_type) === "code").length
    if (earlier) lines.push(`Note: the kernel was fresh, so the ${earlier} code cell${earlier === 1 ? "" : "s"} before cell ${firstRun} didn't run in it.`)
  }
  for (const r of outcome.results) {
    const n = number(r.id)
    if (r.status === "error") {
      lines.push(`cell ${n} error  ${clip(`${r.ename ?? "Error"}: ${r.evalue ?? ""}`, 300)}`)
      const tail = (r.traceback ?? []).join("\n").replace(ANSI, "").split("\n").filter(l => l.trim()).slice(-6)
      for (const line of tail) lines.push(`    ${clip(line, 200)}`)
    } else if (r.status === "skipped") lines.push(`cell ${n} skipped (cell ${first ? number(first.id) : "?"} failed first)`)
    else if (r.status === "stopped") lines.push(`cell ${n} stopped${r.evalue ? ` (${clip(r.evalue, 200)})` : ""}`)
    else lines.push(`cell ${n} ok${r.executionCount != null ? ` [${r.executionCount}]` : ""}`)
  }
  const ran = new Set(outcome.results.filter(r => r.status === "ok" || r.status === "error").map(r => r.id))
  const results: string[] = []
  const stdout: string[] = []
  for (const cell of cells) {
    if (!ran.has(str(cell?.id))) continue
    for (const out of cell.outputs ?? []) {
      const type = str(out?.output_type)
      const text = type === "stream" ? str(out.text) : type === "execute_result" ? (Array.isArray(out.data?.["text/plain"]) ? out.data["text/plain"].map(str).join("") : str(out.data?.["text/plain"])) : ""
      if (!text) continue
      for (const r of resultLines(text)) results.push(`  ${r.line}  (cell ${number(str(cell.id))})`)
      if (type === "stream") for (const line of text.replace(/\n$/, "").split("\n")) stdout.push(`  ${clip(line, 200)}`)
    }
  }
  if (results.length) {
    lines.push(`Result lines (id value), ${results.length}:`)
    lines.push(...results.slice(0, 40))
    if (results.length > 40) lines.push(`  … and ${results.length - 40} more`)
  }
  if (stdout.length) {
    const tail = stdout.slice(-20)
    let text = tail.join("\n")
    if (text.length > 1500) text = `…${text.slice(-1500)}`
    lines.push(`Printed output, last ${tail.length} of ${stdout.length} line${stdout.length === 1 ? "" : "s"}:`)
    lines.push(text)
  }
  lines.push("Outputs and execution counts are in the notebook, and the run is recorded in its metadata (metadata.patchwork.run).")
  return lines.join("\n")
}

