import type { DocHandle, Repo } from "@automerge/automerge-repo"
import type * as nbformat from "@jupyterlab/nbformat"
import { notebookDoc } from "./datatype"

type FileDoc = { content: unknown; extension?: string; name?: string }

/** Create a Jupyter notebook document from an uploaded .ipynb file. */
export const importIpynb = {
  isApplicable(handle: DocHandle<FileDoc>) {
    const doc = handle.doc()
    return doc?.extension === "ipynb" || !!doc?.name?.endsWith(".ipynb")
  },
  async default(handle: DocHandle<FileDoc>, repo: Repo & { create2?<T>(initial: T): Promise<DocHandle<T>> }) {
    const doc = handle.doc()
    const notebook = JSON.parse(fileText(doc.content)) as nbformat.INotebookContent
    const title = (doc.name ?? "Notebook").replace(/\.ipynb$/, "")
    const initial = { "@patchwork": { type: "jupyter-notebook" }, ...notebookDoc(notebook, title) }
    const created = repo.create2 ? await repo.create2(initial) : repo.create(initial)
    return created.url
  },
}

function fileText(content: unknown): string {
  if (content instanceof Uint8Array) return new TextDecoder().decode(content)
  return String(content)
}
