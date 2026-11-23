import { jsonEqual, readString, toPlain } from "../../../shared/json"
import type { CellDoc, NotebookDoc } from "../../../shared/schema"
import { type DeletedCell, deletedCells, shownOutputs } from "./notebook-diff"

/**
 * How this draft's version of a notebook differs from the other draft's,
 * cell by cell, for showing both as alternatives (the Combined mode). Cells
 * are matched by id, so a moved cell is the same cell.
 */
export type VersionDiff = {
  /** This version's cells that differ from the other's, by id. */
  cells: Map<string, VersionCell>
  /** The other version's cells this one doesn't have, placed where they'd be. */
  theirs: DeletedCell[]
}

export type VersionCell =
  /** Only this version has the cell. */
  | { type: "ours" }
  /** Both have it; what the other's has instead, where that differs. Metadata doesn't show, so it doesn't count. */
  | {
      type: "differs"
      source: string | null
      cellType: string | null
      outputs: unknown[] | null
    }

export function versionDiff(ours: NotebookDoc, theirs: NotebookDoc): VersionDiff {
  const theirCells = new Map((theirs.cells ?? []).map(cell => [readString(cell.id), cell]))
  const cells = new Map<string, VersionCell>()
  for (const cell of ours.cells ?? []) {
    const id = readString(cell.id)
    const other = theirCells.get(id)
    const difference = other ? cellDifference(cell, other) : { type: "ours" as const }
    if (difference) cells.set(id, difference)
  }
  return { cells, theirs: deletedCells(theirs.cells ?? [], ours.cells ?? []) }
}

function cellDifference(ours: CellDoc, theirs: CellDoc): VersionCell | null {
  const source = readString(ours.source) === readString(theirs.source) ? null : readString(theirs.source)
  const cellType = readString(ours.cell_type) === readString(theirs.cell_type) ? null : readString(theirs.cell_type)
  const outputs = jsonEqual(shownOutputs(ours.outputs), shownOutputs(theirs.outputs))
    ? null
    : toPlain<unknown[]>(theirs.outputs ?? [])
  if (source === null && cellType === null && outputs === null) return null
  return { type: "differs", source, cellType, outputs }
}

/** A stretch of lines `a[fromA, toA)` that `b` has as `b[fromB, toB)`; either may be empty. */
export type LineChange = { fromA: number; toA: number; fromB: number; toB: number }

/**
 * How lines `b` differ from lines `a`, by their longest common subsequence.
 * Cells are short, so the quadratic table is fine; what's alike at either
 * end is left out of it.
 */
export function lineDiff(a: readonly string[], b: readonly string[]): LineChange[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const midA = a.slice(start, a.length - end)
  const midB = b.slice(start, b.length - end)

  // common[i][j]: how many lines midA[i..] and midB[j..] have in common, in order.
  const common = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1))
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      common[i][j] = midA[i] === midB[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }

  const changes: LineChange[] = []
  let i = 0
  let j = 0
  let open: LineChange | null = null
  const extend = (takeA: boolean) => {
    open ??= { fromA: start + i, toA: start + i, fromB: start + j, toB: start + j }
    if (takeA) open.toA = start + ++i
    else open.toB = start + ++j
  }
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      if (open) changes.push(open)
      open = null
      i++
      j++
    } else if (j >= midB.length || (i < midA.length && common[i + 1][j] >= common[i][j + 1])) {
      extend(true)
    } else {
      extend(false)
    }
  }
  if (open) changes.push(open)
  return changes
}
