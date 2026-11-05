import * as A from "@automerge/automerge/slim"
import {
  initializeWasm,
  Repo,
  type AutomergeUrl,
  type DocHandle,
  type PeerId,
  type StorageAdapterInterface,
} from "@automerge/automerge-repo/slim"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
// @ts-ignore — the default init is a wasm-bindgen runtime helper not in the .d.ts
import initSubduction, { MemorySigner } from "@automerge/automerge-subduction/slim"
import automergeWasm from "@automerge/automerge/automerge.wasm?url"
import subductionWasm from "@automerge/automerge-subduction/wasm?url"

/** Where the page's Patchwork node keeps its data, so this node can share it. */
export type KernelConfig = {
  storagePrefix: string
  syncServer?: string
}

/** The parts of Pyodide's Emscripten FS this module uses. */
type FS = {
  mkdirTree(path: string): void
  writeFile(path: string, data: string | Uint8Array): void
  readFile(path: string): Uint8Array
  readdir(path: string): string[]
  unlink(path: string): void
  stat(path: string): { mode: number; size: number; mtime: Date }
  isDir(mode: number): boolean
  analyzePath(path: string): { exists: boolean }
}

type Content = string | Uint8Array | A.ImmutableString
type FileDoc = { content: Content; name: string; extension: string; mimeType: string }
type DocLink = { name: string; type: string; url: AutomergeUrl }
type FolderDoc = { title: string; docs: DocLink[] }

type FileEntry = {
  kind: "file"
  path: string
  handle: DocHandle<FileDoc>
  /** The bytes last written to or read from the document, to tell Python's edits apart. */
  synced: Uint8Array
  /** `mtime:size` of the file when it was last synced, so unchanged files aren't read. */
  stamp: string
  onChange?: () => void
}
type FolderEntry = {
  kind: "folder"
  path: string
  handle: DocHandle<FolderDoc>
  children: Map<string, Entry>
  onChange?: () => void
}
type Entry = FileEntry | FolderEntry

/** Python's writes are picked up between executions; IPython has no hook that runs after every cell. */
const SYNC_INTERVAL_MS = 500

let repo: Repo | null = null
let fs: FS | null = null
let timer: ReturnType<typeof setInterval> | null = null
const mounts = new Map<string, Entry>()

/**
 * Start this kernel's Patchwork node: it opens the origin's IndexedDB, signs as
 * the same peer as the tabs, hears their saves on the heads channel and keeps
 * its own socket to the sync server.
 */
export async function connect(config: KernelConfig, pyodideFS: FS): Promise<void> {
  fs = pyodideFS
  if (repo) return
  await Promise.all([initializeWasm(new Request(automergeWasm)), initSubduction(new Request(subductionWasm))])
  const storage = new IndexedDBStorageAdapter()
  repo = new Repo({
    signer: await loadOrCreateSigner(storage),
    storage,
    peerId: `${config.storagePrefix}-kernel-${crypto.randomUUID()}` as PeerId,
    subductionWebsocketEndpoints: config.syncServer ? [config.syncServer] : [],
    headsChannel: `${config.storagePrefix}-heads`,
    enableRemoteHeadsGossiping: true,
  })
}

/** Mirror a Patchwork file or folder at `path`, returning the path of the mounted file or folder. */
export async function mount(url: string, path: string): Promise<string> {
  const handle = await requireRepo().find<FileDoc | FolderDoc>(url as AutomergeUrl)
  const doc = handle.doc()
  const target = isFolder(doc) ? path : `${path}/${(doc as FileDoc).name}`
  unmount(target)
  const entry = await load(handle, target)
  mounts.set(target, entry)
  timer ??= setInterval(() => {
    try {
      sync()
    } catch (error) {
      console.warn("patchwork: couldn't sync mounted files", error)
    }
  }, SYNC_INTERVAL_MS)
  return target
}

export function unmount(path: string): void {
  const entry = mounts.get(path)
  if (!entry) return
  mounts.delete(path)
  forget(entry)
  if (mounts.size === 0 && timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Write files Python changed, created or deleted back to their documents. */
export function sync(): void {
  for (const entry of mounts.values()) {
    if (entry.kind === "file") syncFile(entry)
    else syncFolder(entry)
  }
}

/** Wait until every change is saved locally. */
export async function flush(): Promise<void> {
  await repo?.flush()
}

function requireRepo(): Repo {
  if (!repo) throw new Error("patchwork is not connected; the notebook tool connects it when the kernel starts")
  return repo
}

function requireFS(): FS {
  if (!fs) throw new Error("patchwork is not connected")
  return fs
}

async function load(handle: DocHandle<FileDoc | FolderDoc>, path: string): Promise<Entry> {
  const doc = handle.doc()
  if (isFolder(doc)) {
    requireFS().mkdirTree(path)
    const entry: FolderEntry = { kind: "folder", path, handle: handle as DocHandle<FolderDoc>, children: new Map() }
    await reconcileFolder(entry)
    entry.handle.on("change", entry.onChange = () => void reconcileFolder(entry))
    return entry
  }
  const entry: FileEntry = { kind: "file", path, handle: handle as DocHandle<FileDoc>, synced: new Uint8Array(), stamp: "" }
  writeLocal(entry)
  entry.handle.on("change", entry.onChange = () => {
    if (bytesEqual(readLocal(entry.path), entry.synced)) writeLocal(entry)
  })
  return entry
}

function forget(entry: Entry): void {
  if (entry.onChange) entry.handle.off("change", entry.onChange)
  if (entry.kind === "folder") for (const child of entry.children.values()) forget(child)
}

/** Bring a mounted folder in line with its document: load new links, drop removed ones. */
async function reconcileFolder(entry: FolderEntry): Promise<void> {
  const links = (entry.handle.doc().docs ?? []).filter(link => link.type === "file" || link.type === "folder")
  const names = new Set(links.map(link => link.name))
  for (const [name, child] of entry.children) {
    if (names.has(name)) continue
    entry.children.delete(name)
    forget(child)
    if (child.kind === "file" && bytesEqual(readLocal(child.path), child.synced)) remove(child.path)
  }
  await Promise.all(
    links
      .filter(link => entry.children.get(link.name)?.handle.url !== link.url)
      .map(async link => {
        const handle = await requireRepo().find<FileDoc | FolderDoc>(link.url)
        const previous = entry.children.get(link.name)
        if (previous) forget(previous)
        entry.children.set(link.name, await load(handle, `${entry.path}/${link.name}`))
      }),
  )
}

function syncFile(entry: FileEntry): void {
  if (!exists(entry.path) || stampOf(entry.path) === entry.stamp) return
  const local = readLocal(entry.path)
  entry.stamp = stampOf(entry.path)
  if (bytesEqual(local, entry.synced)) return
  entry.synced = local
  entry.handle.change(doc => {
    if (typeof doc.content === "string") {
      const text = decodeText(local)
      if (text !== null) return A.updateText(doc, ["content"], text)
    }
    if (doc.content instanceof A.ImmutableString) {
      const text = decodeText(local)
      if (text !== null) return void (doc.content = new A.ImmutableString(text))
    }
    doc.content = local
  })
}

function syncFolder(entry: FolderEntry): void {
  const disk = requireFS()
  if (!exists(entry.path)) return
  const onDisk = new Set(disk.readdir(entry.path).filter(name => name !== "." && name !== ".."))
  const removed = [...entry.children.keys()].filter(name => !onDisk.has(name))
  for (const name of removed) {
    forget(entry.children.get(name)!)
    entry.children.delete(name)
  }
  const added: DocLink[] = []
  for (const name of onDisk) {
    const child = entry.children.get(name)
    if (child?.kind === "file") syncFile(child)
    else if (child?.kind === "folder") syncFolder(child)
    else added.push(create(entry, name))
  }
  if (removed.length === 0 && added.length === 0) return
  entry.handle.change(doc => {
    for (const name of removed) {
      const index = doc.docs.findIndex(link => link.name === name)
      if (index >= 0) doc.docs.splice(index, 1)
    }
    doc.docs.push(...added)
  })
}

/** Create a document for a file or folder Python made inside a mounted folder. */
function create(parent: FolderEntry, name: string): DocLink {
  const path = `${parent.path}/${name}`
  const disk = requireFS()
  if (disk.isDir(disk.stat(path).mode)) {
    const handle = requireRepo().create<FolderDoc>({ "@patchwork": { type: "folder" }, title: name, docs: [] } as FolderDoc)
    const child: FolderEntry = { kind: "folder", path, handle, children: new Map() }
    parent.children.set(name, child)
    syncFolder(child)
    handle.on("change", child.onChange = () => void reconcileFolder(child))
    return { name, type: "folder", url: handle.url }
  }
  const bytes = readLocal(path)
  const text = decodeText(bytes)
  const extension = name.includes(".") ? name.split(".").pop()! : ""
  const handle = requireRepo().create<FileDoc>({
    "@patchwork": { type: "file" },
    name,
    extension,
    mimeType: mimeTypeFor(extension, text !== null),
    content: text ?? bytes,
  } as FileDoc)
  const child: FileEntry = { kind: "file", path, handle, synced: bytes, stamp: stampOf(path) }
  handle.on("change", child.onChange = () => {
    if (bytesEqual(readLocal(child.path), child.synced)) writeLocal(child)
  })
  parent.children.set(name, child)
  return { name, type: "file", url: handle.url }
}

function writeLocal(entry: FileEntry): void {
  const content = entry.handle.doc()?.content
  const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content ?? ""))
  const disk = requireFS()
  disk.mkdirTree(entry.path.slice(0, entry.path.lastIndexOf("/")) || "/")
  disk.writeFile(entry.path, bytes)
  entry.synced = bytes
  entry.stamp = stampOf(entry.path)
}

function readLocal(path: string): Uint8Array {
  return exists(path) ? requireFS().readFile(path) : new Uint8Array()
}

function stampOf(path: string): string {
  const { mtime, size } = requireFS().stat(path)
  return `${mtime.getTime()}:${size}`
}

function exists(path: string): boolean {
  return requireFS().analyzePath(path).exists
}

function remove(path: string): void {
  if (exists(path)) requireFS().unlink(path)
}

function isFolder(doc: unknown): doc is FolderDoc {
  return Array.isArray((doc as FolderDoc | undefined)?.docs)
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const MIME_TYPES: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
  py: "text/x-python",
  html: "text/html",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  parquet: "application/vnd.apache.parquet",
}

function mimeTypeFor(extension: string, isText: boolean): string {
  return MIME_TYPES[extension.toLowerCase()] ?? (isText ? "text/plain" : "application/octet-stream")
}

const SIGNER_KEY = ["patchwork", "subduction-signer"]
const SIGNER_LOCK = "patchwork-subduction-signer"

/** The origin-wide identity, shared with patchwork's tabs (see patchwork-bootloader/signer). */
function loadOrCreateSigner(storage: StorageAdapterInterface): Promise<MemorySigner> {
  return navigator.locks.request(SIGNER_LOCK, async () => {
    const stored = await storage.load(SIGNER_KEY)
    if (stored) return MemorySigner.fromBytes(stored)
    const seed = crypto.getRandomValues(new Uint8Array(32))
    await storage.save(SIGNER_KEY, seed)
    return MemorySigner.fromBytes(seed)
  })
}
