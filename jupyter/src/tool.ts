import * as Automerge from "@automerge/automerge"
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo"
import type { NotebookDoc } from "../extension/src/model"
import type { PatchworkBridge } from "../extension/src/bridge"
import { kernelConfig } from "./kernel"

declare global {
  interface Window {
    repo: Repo
    accountDocHandle?: DocHandle<{ contactUrl?: AutomergeUrl }>
    __patchworkJupyter?: Map<string, PatchworkBridge>
  }
}

const BRIDGE_PREFIX = "patchwork-jupyter:"
const NOTEBOOK_PAGE = new URL(/* @vite-ignore */ "./lite/notebooks/index.html", import.meta.url)

/** Shows the real Jupyter Notebook UI, editing the document through a Patchwork drive. */
export default function JupyterTool(handle: DocHandle<NotebookDoc>, element: HTMLElement) {
  const token = crypto.randomUUID()
  const bridges = (window.__patchworkJupyter ??= new Map())
  const user = { name: "Anonymous", color: colorFor(token) }
  bridges.set(token, {
    Automerge,
    repo: window.repo,
    handle,
    user,
    kernel: kernelConfig(window.repo),
    onCreate: url =>
      element.dispatchEvent(
        new CustomEvent("patchwork:open-document", { detail: { url }, bubbles: true, composed: true }),
      ),
  })
  void loadUserName().then(name => {
    if (name) Object.assign(user, { name, color: colorFor(name) })
  })

  const iframe = document.createElement("iframe")
  iframe.style.cssText = "display: block; inline-size: 100%; block-size: 100%; border: 0"
  iframe.name = BRIDGE_PREFIX + token
  iframe.allow = "clipboard-read; clipboard-write"
  iframe.src = notebookSrc(handle)
  element.append(iframe)

  return () => {
    iframe.remove()
    bridges.delete(token)
  }
}

function notebookSrc(handle: DocHandle<NotebookDoc>): string {
  const title = (handle.doc()?.title || "Untitled").replace(/[/\\]/g, "-")
  const url = new URL(NOTEBOOK_PAGE)
  url.searchParams.set("path", `Patchwork:${handle.documentId}/${title}.ipynb`)
  return url.href
}

async function loadUserName(): Promise<string | undefined> {
  const contactUrl = window.accountDocHandle?.doc()?.contactUrl
  if (!contactUrl) return undefined
  const contact = await window.repo.find<{ name?: string }>(contactUrl)
  return contact.doc()?.name || undefined
}

function colorFor(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 70% 45%)`
}
