import * as A from "@automerge/automerge/slim"
import { initializeWasm, Repo, type AutomergeUrl, type DocHandle, type PeerId } from "@automerge/automerge-repo/slim"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import { accept } from "@inkandswitch/patchwork-providers"
// @ts-ignore — the default init is a wasm-bindgen runtime helper not in the .d.ts
import initSubduction, { MemorySigner } from "@automerge/automerge-subduction/slim"
import automergeWasm from "@automerge/automerge/automerge.wasm?url"
import subductionWasm from "@automerge/automerge-subduction/wasm?url"
import { JupyterNotebookDatatype } from "../shared/datatype"

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
    handle.change((doc: any) => {
      doc["@patchwork"] = { type: "jupyter-notebook" }
      JupyterNotebookDatatype.init(doc)
    })
    const params = new URLSearchParams(location.search)
    params.set("doc", handle.url)
    history.replaceState(null, "", `?${params}`)
  }
  const heads = new URLSearchParams(location.search).get("heads")
  const shown = overlay(heads ? handle.view(heads.split(",") as any) : handle)
  const compare = compareView(document.body)
  Object.assign(window, { harness: { A, repo, handle, shown, compare } })
  const tool = (await import("../native/tool")).default
  tool(shown, document.getElementById("app")!)
}

type Names = { ours: string; theirs: string }

/** What strand's panels answer `compare:view` with (packages/projects/src/compare.ts there). */
type CompareView = {
  mode: string | null
  options: unknown
  other: Uint8Array | null
  missing: boolean
  collapsed: boolean
  editable: boolean
  names: Names | null
  merging: boolean
}

type CompareOptions = { mode?: string; collapsed?: boolean; merging?: boolean; names?: Names | null }

const NOT_COMPARED: CompareView = {
  mode: null,
  options: null,
  other: null,
  missing: false,
  collapsed: false,
  editable: false,
  names: null,
  merging: false,
}

/**
 * Like a strand panel comparing the checked-out draft with another: answers
 * `compare:view` with the other draft's version of the notebook (saved), or
 * `missing` when `other` is "missing", in the given mode; or with nothing
 * compared when `other` is null.
 */
function compareView(element: HTMLElement): (other: DocHandle<any> | "missing" | null, options?: CompareOptions) => void {
  let view = NOT_COMPARED
  const subscribers = new Set<(value: CompareView) => void>()
  element.addEventListener("patchwork:subscribe", event => {
    if (event.detail.selector.type !== "compare:view") return
    accept<CompareView>(event, respond => {
      respond(view)
      subscribers.add(respond)
      return () => subscribers.delete(respond)
    })
  })
  return (other, options = {}) => {
    view = other
      ? {
          mode: options.mode ?? "inline",
          options: null,
          other: other === "missing" ? null : A.save(other.doc()),
          missing: other === "missing",
          collapsed: !!options.collapsed,
          editable: other !== "missing" && !options.merging,
          names: options.names === undefined ? { ours: "Draft", theirs: "Main" } : options.names,
          merging: !!options.merging,
        }
      : NOT_COMPARED
    for (const respond of subscribers) respond(view)
  }
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
