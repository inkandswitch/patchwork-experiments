import * as Automerge from "@automerge/automerge"
import type * as nbformat from "@jupyterlab/nbformat"
import { setAutomerge } from "./automerge"
import { notebookDoc } from "./notebook-doc"
import type { NotebookDoc } from "./schema"

setAutomerge(Automerge)

export { notebookDoc }

export const JupyterNotebookDatatype = {
  init(doc: NotebookDoc) {
    Object.assign(doc, notebookDoc(emptyNotebook(), "Untitled Notebook"))
  },
  getTitle(doc: NotebookDoc) {
    return doc.title || "Untitled Notebook"
  },
  setTitle(doc: NotebookDoc, title: string) {
    doc.title = title
  },
  markCopy(doc: NotebookDoc) {
    doc.title = `Copy of ${doc.title || "Untitled Notebook"}`
  },
}

function emptyNotebook(): nbformat.INotebookContent {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: "python", display_name: "Python (Pyodide)", language: "python" },
      language_info: { name: "python" },
    },
    cells: [{ id: crypto.randomUUID(), cell_type: "code", source: "", metadata: {}, outputs: [], execution_count: null }],
  }
}
