import * as Automerge from "@automerge/automerge"
import type { DocHandle, Repo } from "@automerge/automerge-repo"
import { onCleanup } from "solid-js"
import { render } from "solid-js/web"
import { setAutomerge } from "../shared/automerge"
import { kernelConfig } from "../shared/kernel-config"
import type { NotebookDoc } from "../shared/schema"
import { kernelBootstrap } from "../shared/types"
import { trackCompare, watchCompare } from "./src/compare/compare"
import { NotebookStore } from "./src/doc"
import { Executor } from "./src/execution"
import { PyodideKernelClient } from "./src/kernel/pyodide"
import { Notebook } from "./src/notebook"
import { createRenderMime } from "./src/outputs"
import { forDocument, lookupIn, noRegistry, runHooks, type DatatypeLookup, type FindDoc } from "../shared/run"
import css from "./src/style.css?inline"

declare global {
  interface Window {
    repo: Repo
  }
}

/** Built by native/scripts/build_kernel.py; chunks live in dist/, next to native/. */
const PYODIDE_URL = new URL(/* @vite-ignore */ "./native/pyodide/pyodide.mjs", import.meta.url).href

/** Patchwork's plugin registry, through the page's importmap; none in the dev harness. */
const PLUGINS = "@inkandswitch/patchwork-plugins"
const registry: Promise<DatatypeLookup> = import(/* @vite-ignore */ PLUGINS).then(lookupIn, () => noRegistry)

/**
 * The notebook UI built for Patchwork: Jupyter's kernel protocol and output
 * renderers, with cells, editing and comparing of its own, on the same
 * document the JupyterLab tool edits.
 */
export default function NativeNotebookTool(handle: DocHandle<NotebookDoc>, element: HTMLElement) {
  setAutomerge(Automerge)
  const style = document.createElement("style")
  style.textContent = css
  const host = document.createElement("div")
  host.className = "pwnb-host"
  element.append(style, host)

  const repo: Repo = (element as { repo?: Repo }).repo ?? window.repo
  const find: FindDoc = url => repo.find(url as any) as any
  const dispose = render(() => {
    const store = new NotebookStore(handle)
    // A point in history runs nothing, as in the JupyterLab tool.
    const kernel = handle.isReadOnly?.()
      ? undefined
      : new PyodideKernelClient({ pyodideUrl: PYODIDE_URL, bootstrap: kernelBootstrap(kernelConfig(repo)) })
    // Before every run, the imports are resolved and the run recorded (shared/run.ts), as notebook_run does.
    const datatype: DatatypeLookup = forDocument(async type => (await registry)(type), handle.url)
    const executor = kernel && new Executor(store, kernel, runHooks({ writer: store, kernel, find, datatype, by: "person" }))
    const open = (url: string, title?: string) =>
      element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url, title }, bubbles: true, composed: true }))
    onCleanup(() => {
      executor?.dispose()
      kernel?.dispose()
      store.dispose()
    })
    return (
      <Notebook
        store={store}
        rendermime={createRenderMime()}
        compare={trackCompare(store, watchCompare(element))}
        kernel={kernel}
        executor={executor}
        links={{ find, datatype, url: handle.url, open }}
      />
    )
  }, host)

  return () => {
    dispose()
    style.remove()
    host.remove()
  }
}
