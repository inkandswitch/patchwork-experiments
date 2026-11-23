import type { DocHandle } from "@automerge/automerge-repo"
import type * as nbformat from "@jupyterlab/nbformat"
import { type Accessor, createSignal } from "solid-js"
import { automerge } from "../../shared/automerge"
import { NotebookWriter } from "../../shared/notebook-writer"
import { emptyList, readString, toAutomerge, toPlain } from "../../shared/json"
import { asList, cellToDoc, findCellIndex, sourcePath } from "../../shared/notebook-doc"
import type { CellDoc, NotebookDoc } from "../../shared/schema"

export type CellType = "code" | "markdown" | "raw"

/** A text edit in a cell's source, in the positions before the edit. */
export type SourceEdit = { from: number; to: number; insert: string }

/**
 * The notebook document as Solid signals, and every change the native tool
 * makes to it. Patchwork re-points the handle in place at a draft or a point
 * in history, so everything is re-read on each change rather than patched.
 */
export class NotebookStore extends NotebookWriter {
  readonly doc: Accessor<NotebookDoc | undefined>
  readonly readOnly: Accessor<boolean>

  constructor(handle: DocHandle<NotebookDoc>) {
    super(handle)
    // Automerge returns the same object until the document changes.
    const [doc, setDoc] = createSignal(handle.doc())
    const [readOnly, setReadOnly] = createSignal(isReadOnly(handle))
    this.doc = doc
    this.readOnly = readOnly
    this._onChange = () => {
      setDoc(handle.doc())
      setReadOnly(isReadOnly(handle))
    }
    handle.on("change", this._onChange)
  }

  dispose(): void {
    this.handle.off("change", this._onChange)
  }

  override cell(id: string, doc = this.doc()): CellDoc | undefined {
    if (!doc) return undefined
    const index = findCellIndex(doc, id)
    return index < 0 ? undefined : doc.cells![index]
  }

  /** Inserts a new cell at `index` and returns its id. */
  insertCell(index: number, cellType: CellType, source = ""): string {
    const id = crypto.randomUUID()
    this._change(doc => {
      if (!doc.cells) doc.cells = emptyList()
      const cell = { id, cell_type: cellType, source, metadata: {}, ...(cellType === "code" ? { outputs: [], execution_count: null } : {}) }
      asList(doc.cells).insertAt(Math.min(index, doc.cells.length), cellToDoc(cell))
    })
    return id
  }

  /** Inserts copies of nbformat cells at `index`, with fresh ids, returning them. */
  insertCells(index: number, cells: nbformat.ICell[]): string[] {
    const ids = cells.map(() => crypto.randomUUID())
    this._change(doc => {
      if (!doc.cells) doc.cells = emptyList()
      const at = Math.min(index, doc.cells.length)
      asList(doc.cells).insertAt(at, ...cells.map((cell, i) => cellToDoc({ ...cell, id: ids[i] } as any)))
    })
    return ids
  }

  deleteCells(ids: string[]): void {
    this._change(doc => {
      for (const id of ids) {
        const index = findCellIndex(doc, id)
        if (index >= 0) asList(doc.cells!).deleteAt(index)
      }
    })
  }

  /**
   * Moves a cell by deleting it and inserting a copy. Automerge has no list
   * move, so a concurrent edit to the moved cell is lost; the same is true
   * of the JupyterLab tool.
   */
  moveCell(id: string, delta: number): void {
    this._change(doc => {
      const index = findCellIndex(doc, id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= doc.cells!.length) return
      const copy = cellToDoc(plainCell(doc.cells![index]) as any)
      asList(doc.cells!).deleteAt(index)
      asList(doc.cells!).insertAt(target, copy)
    })
  }

  setCellType(id: string, cellType: CellType): void {
    this._change(doc => {
      const index = findCellIndex(doc, id)
      if (index < 0) return
      const cell = doc.cells![index] as CellDoc & Record<string, unknown>
      if (readString(cell.cell_type) === cellType) return
      cell.cell_type = toAutomerge(cellType) as string
      if (cellType === "code") {
        cell.outputs = emptyList()
        cell.execution_count = null
        delete cell.attachments
      } else {
        delete cell.outputs
        delete cell.execution_count
      }
    })
  }

  editSource(id: string, edits: SourceEdit[]): void {
    this._change(doc => {
      const index = findCellIndex(doc, id)
      if (index < 0) return
      const path = ensureSourceText(doc, index)
      let shift = 0
      for (const { from, to, insert } of edits) {
        automerge().splice(doc, path, from + shift, to - from, insert)
        shift += insert.length - (to - from)
      }
    })
  }

  /** Changes the document, and the `doc` signal with it rather than when the handle says so. */
  protected override change(fn: (doc: NotebookDoc) => void): void {
    if (this.readOnly()) return
    this.handle.change(fn)
    this._onChange()
  }

  private _change(fn: (doc: NotebookDoc) => void): void {
    this.change(fn)
  }

  private _onChange: () => void
}

/** nbformat JSON for a cell read from the document. */
export function plainCell(cell: CellDoc): nbformat.ICell {
  return { ...toPlain(cell), source: readString(cell.source) }
}

function isReadOnly(handle: DocHandle<NotebookDoc>): boolean {
  return !!(handle as { isReadOnly?(): boolean }).isReadOnly?.()
}

/** Peers may have stored the source as a scalar string; make it splice-able. */
function ensureSourceText(doc: NotebookDoc, index: number) {
  const cell = doc.cells![index]
  if (typeof cell.source !== "string") cell.source = readString(cell.source)
  return sourcePath(index)
}
