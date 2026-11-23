import type { DocHandle } from "@automerge/automerge-repo"
import type * as nbformat from "@jupyterlab/nbformat"
import { automerge } from "./automerge"
import { emptyList, emptyMap, readString, toAutomerge } from "./json"
import { asList, findCellIndex, outputsToDoc } from "./notebook-doc"
import type { CellDoc, NotebookDoc } from "./schema"

/**
 * The changes running a cell makes to a notebook document: outputs and
 * execution counts, and the run record in its metadata. Framework-free and
 * DOM-free, so the native tool (through NotebookStore) and notebook_run
 * (headless, possibly in a worker) write exactly the same document.
 */
export class NotebookWriter {
  constructor(handle: DocHandle<NotebookDoc>) {
    this.handle = handle
  }

  /** The document as it is now. */
  current(): NotebookDoc | undefined {
    return this.handle.doc()
  }

  /** The document's heads now. */
  heads(): string[] {
    return [...((this.handle as { heads?(): string[] | undefined }).heads?.() ?? [])]
  }

  cell(id: string, doc: NotebookDoc | undefined = this.current()): CellDoc | undefined {
    if (!doc) return undefined
    const index = findCellIndex(doc, id)
    return index < 0 ? undefined : doc.cells![index]
  }

  clearOutputs(id: string): void {
    this.change(doc => {
      const cell = codeCell(doc, id)
      if (!cell) return
      cell.outputs = emptyList()
      cell.execution_count = null
    })
  }

  /** Appends an output, returning its index. */
  appendOutput(id: string, output: nbformat.IOutput): number {
    let index = -1
    this.change(doc => {
      const cell = codeCell(doc, id)
      if (!cell) return
      if (!cell.outputs) cell.outputs = emptyList()
      index = cell.outputs.length
      asList(cell.outputs).insertAt(index, ...outputsToDoc([output]))
    })
    return index
  }

  setOutput(id: string, index: number, output: nbformat.IOutput): void {
    this.change(doc => {
      const cell = codeCell(doc, id)
      if (!cell?.outputs || index >= cell.outputs.length) return
      cell.outputs[index] = outputsToDoc([output])[0] as any
    })
  }

  /** Adds to a stream output's text, or replaces it all when `replace` is set. */
  writeStream(id: string, index: number, text: string, replace: boolean): void {
    this.change(doc => {
      const cellIndex = findCellIndex(doc, id)
      const output = doc.cells?.[cellIndex]?.outputs?.[index]
      if (!output || readString(output.output_type) !== "stream") return
      if (typeof output.text !== "string") output.text = readString(output.text)
      const path = ["cells", cellIndex, "outputs", index, "text"]
      const length = (output.text as string).length
      if (replace) automerge().splice(doc, path, 0, length, text)
      else automerge().splice(doc, path, length, 0, text)
    })
  }

  setExecutionCount(id: string, count: number | null): void {
    this.change(doc => {
      const cell = codeCell(doc, id)
      if (cell) cell.execution_count = count
    })
  }

  /** Sets fields of `metadata.patchwork` (imports, run), creating it as needed. */
  setPatchworkMetadata(fields: Record<string, unknown>): void {
    this.change(doc => {
      if (!doc.metadata) doc.metadata = emptyMap()
      if (!doc.metadata.patchwork) doc.metadata.patchwork = emptyMap()
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete doc.metadata.patchwork[key]
        else doc.metadata.patchwork[key] = toAutomerge(value)
      }
    })
  }

  /** Changes the document; NotebookStore also checks it may and updates its signal. */
  protected change(fn: (doc: NotebookDoc) => void): void {
    this.handle.change(fn)
  }

  protected handle: DocHandle<NotebookDoc>
}

function codeCell(doc: NotebookDoc, id: string): CellDoc | undefined {
  const index = findCellIndex(doc, id)
  const cell = index < 0 ? undefined : doc.cells![index]
  return cell && readString(cell.cell_type) === "code" ? cell : undefined
}
