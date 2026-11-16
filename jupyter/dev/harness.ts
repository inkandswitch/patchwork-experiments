import * as A from "@automerge/automerge/slim"
import { initializeWasm, Repo, type AutomergeUrl, type DocHandle, type PeerId } from "@automerge/automerge-repo/slim"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
// @ts-ignore — the default init is a wasm-bindgen runtime helper not in the .d.ts
import initSubduction, { MemorySigner } from "@automerge/automerge-subduction/slim"
import automergeWasm from "@automerge/automerge/automerge.wasm?url"
import subductionWasm from "@automerge/automerge-subduction/wasm?url"
import JupyterTool from "../src/tool"
import { JupyterNotebookDatatype } from "../src/datatype"

/** Stands in for Patchwork: a tab Repo like createRepo()'s, without a server, showing one notebook. */
async function main() {
  await Promise.all([initializeWasm(new Request(automergeWasm)), initSubduction(new Request(subductionWasm))])
  const storage = new IndexedDBStorageAdapter()
  const repo = new Repo({
    storage,
    signer: await loadSigner(storage),
    peerId: `patchwork-tab-${crypto.randomUUID()}` as PeerId,
    subductionWebsocketEndpoints: [],
    headsChannel: "patchwork-heads",
  })
  Object.assign(window, { repo })

  const url = new URLSearchParams(location.search).get("doc") as AutomergeUrl | null
  const handle = url ? await repo.find<any>(url) : repo.create<any>()
  if (!url) {
    handle.change(doc => {
      doc["@patchwork"] = { type: "jupyter-notebook" }
      JupyterNotebookDatatype.init(doc)
    })
    history.replaceState(null, "", `?doc=${handle.url}`)
  }
  const heads = new URLSearchParams(location.search).get("heads")
  const shown = overlay(heads ? handle.view(heads.split(",") as any) : handle)
  Object.assign(window, { harness: { A, repo, handle, shown } })
  JupyterTool(shown, document.getElementById("app")!)
}

/**
 * Like Patchwork's OverlayHandle: keeps presenting `initial`'s url while
 * `swap` re-points it at a draft or a view at some heads, announcing the
 * swap as a `change` with `scopeReplaced`.
 */
function overlay(initial: DocHandle<any>): DocHandle<any> & { swap(next: DocHandle<any>): void } {
  let backing = initial
  const listeners = new Map<string, Set<(payload: any) => void>>()
  const forwarders = Object.fromEntries(
    ["change", "ephemeral-message"].map(event => [
      event,
      (payload: any) => listeners.get(event)?.forEach(listener => listener({ ...payload, handle: self })),
    ]),
  )
  const attach = (handle: DocHandle<any>) => Object.entries(forwarders).forEach(([e, f]) => handle.on(e as any, f))
  const detach = (handle: DocHandle<any>) => Object.entries(forwarders).forEach(([e, f]) => handle.off(e as any, f))
  const own: Record<string, unknown> = {
    url: initial.url,
    documentId: initial.documentId,
    on(event: string, listener: (payload: any) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
      return self
    },
    off(event: string, listener: (payload: any) => void) {
      listeners.get(event)?.delete(listener)
      return self
    },
    swap(next: DocHandle<any>) {
      const before = backing.doc()
      detach(backing)
      backing = next
      attach(backing)
      const after = backing.doc()
      forwarders.change({ doc: after, patches: [], scopeReplaced: true, patchInfo: { before, after, source: "change" } })
    },
  }
  const self: any = new Proxy(own, {
    get(target, key: string) {
      if (key in target) return target[key]
      const value = (backing as any)[key]
      return typeof value === "function" ? value.bind(backing) : value
    },
  })
  attach(backing)
  return self
}

async function loadSigner(storage: IndexedDBStorageAdapter): Promise<MemorySigner> {
  const key = ["patchwork", "subduction-signer"]
  const stored = await storage.load(key)
  if (stored) return MemorySigner.fromBytes(stored)
  const seed = crypto.getRandomValues(new Uint8Array(32))
  await storage.save(key, seed)
  return MemorySigner.fromBytes(seed)
}

void main()
