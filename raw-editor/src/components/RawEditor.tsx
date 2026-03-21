import * as Automerge from "@automerge/automerge"
import {
  type AutomergeUrl,
  type DocHandle,
  isValidAutomergeUrl,
} from "@automerge/automerge-repo"
import { OpenDocumentEvent } from "@inkandswitch/patchwork-elements"
import { createSignal, onCleanup, Show } from "solid-js"
import { render } from "solid-js/web"
import { TreeEditor, type CollectionKey } from "../tree-editor"
import { Uint8ArrayInspector } from "./Uint8ArrayInspector"
import { UndoIcon, RedoIcon, DownloadIcon } from "../tree-editor/Icons"
import "../rawEditor.css"

// ─── TinyTool mount point ─────────────────────────────────────────────────────

export const TinyTool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const dispose = render(() => <RawEditor handle={handle} element={element} />, element)
  return dispose
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const UINT8_PLACEHOLDER = '"<Uint8Array>"'

function jsonStringifyWithUint8(data: unknown): string {
  let hasUint8 = false
  const result = JSON.stringify(
    data,
    (_key, value) => {
      if (value instanceof Uint8Array) {
        hasUint8 = true
        return UINT8_PLACEHOLDER
      }
      return value
    },
    2
  )
  if (hasUint8) {
    return `⚠ Contains binary data (Uint8Array) — editing disabled.\n\n${result}`
  }
  return result
}

function prepareForJson(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(prepareForJson)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = prepareForJson(v)
    return out
  }
  return value
}

// ─── Automerge doc mutation helpers ───────────────────────────────────────────

function walkToParent(
  doc: any,
  path: Automerge.Prop[]
): [parent: any, key: string | number] | null {
  let node = doc
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]]
    if (node == null) return null
  }
  return [node, path[path.length - 1]]
}

function applyAtPath(doc: any, path: Automerge.Prop[], value: unknown) {
  const target = walkToParent(doc, path)
  if (!target) return
  const [node, key] = target
  if (
    typeof value === "string" &&
    typeof node[key] === "string" &&
    !Automerge.isImmutableString(node[key])
  ) {
    Automerge.updateText(doc, path, value)
  } else {
    node[key] = value
  }
}

function deleteAtPath(doc: any, path: Automerge.Prop[]) {
  const target = walkToParent(doc, path)
  if (!target) return
  const [node, key] = target
  if (Array.isArray(node) && typeof key === "number") {
    node.splice(key, 1)
  } else {
    delete node[key]
  }
}

// ─── Undo / Redo ─────────────────────────────────────────────────────────────

type UndoEntry =
  | { type: "edit"; path: Automerge.Prop[]; oldValue: unknown; newValue: unknown }
  | { type: "delete"; path: Automerge.Prop[]; oldValue: unknown }
  | { type: "add"; path: Automerge.Prop[]; newValue: unknown }

function applyUndoEntry(d: any, entry: UndoEntry) {
  switch (entry.type) {
    case "edit":
      applyAtPath(d, entry.path, entry.oldValue)
      break
    case "delete":
      applyAtPath(d, entry.path, entry.oldValue)
      break
    case "add":
      deleteAtPath(d, entry.path)
      break
  }
}

function applyRedoEntry(d: any, entry: UndoEntry) {
  switch (entry.type) {
    case "edit":
      applyAtPath(d, entry.path, entry.newValue)
      break
    case "delete":
      deleteAtPath(d, entry.path)
      break
    case "add":
      applyAtPath(d, entry.path, entry.newValue)
      break
  }
}

function createUndoRedo(changeDoc: (fn: (d: any) => void) => void) {
  const [past, setPast] = createSignal<UndoEntry[]>([])
  const [future, setFuture] = createSignal<UndoEntry[]>([])

  return {
    canUndo: () => past().length > 0,
    canRedo: () => future().length > 0,
    push(entry: UndoEntry) {
      setPast((p) => [...p, entry])
      setFuture([])
    },
    undo() {
      const p = past()
      if (p.length === 0) return
      const entry = p[p.length - 1]
      setPast(p.slice(0, -1))
      setFuture((f) => [...f, entry])
      changeDoc((d: any) => applyUndoEntry(d, entry))
    },
    redo() {
      const f = future()
      if (f.length === 0) return
      const entry = f[f.length - 1]
      setFuture(f.slice(0, -1))
      setPast((p) => [...p, entry])
      changeDoc((d: any) => applyRedoEntry(d, entry))
    },
  }
}

// ─── Custom nodes ─────────────────────────────────────────────────────────────

function makeCustomRenderers(element: HTMLElement) {
  return [
    {
      condition: ({ value }: { value: unknown }) => value instanceof Uint8Array,
      render: (props: { value: unknown }) => (
        <Uint8ArrayInspector bytes={props.value as Uint8Array} />
      ),
      showEditTools: false,
    },
    {
      condition: ({ value }: { value: unknown }) =>
        typeof value === "string" && isValidAutomergeUrl(value),
      render: (props: { value: unknown }) => (
        <span
          class="re-automerge-url"
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            element.dispatchEvent(
              new OpenDocumentEvent({
                url: props.value as AutomergeUrl,
                toolId: "raw",
              })
            )
          }}
        >
          {props.value as string}
        </span>
      ),
      showEditTools: true,
    },
  ]
}

// ─── Main component ───────────────────────────────────────────────────────────

function RawEditor(props: {
  handle: DocHandle<unknown>
  element: HTMLElement
}) {
  const initialDoc = props.handle.isReady()
    ? (props.handle.doc() as Record<string, unknown>)
    : undefined
  const [doc, setDoc] = createSignal<Record<string, unknown> | undefined>(initialDoc)

  if (!initialDoc) {
    props.handle.whenReady().then(() =>
      setDoc(props.handle.doc() as Record<string, unknown>)
    )
  }

  const onChange = () => setDoc(props.handle.doc() as Record<string, unknown>)
  props.handle.on("change", onChange)
  onCleanup(() => props.handle.off("change", onChange))

  const changeDoc = (fn: (d: any) => void) => props.handle.change(fn)

  const undoRedo = createUndoRedo(changeDoc)

  const docUrl = props.handle.url

  const collapseFilter = ({ size, level }: { size: number | null; level: number }) =>
    (size !== null && size > 100) || level >= 3

  const customRenderers = makeCustomRenderers(props.element)

  const onEdit = (value: unknown, path: CollectionKey[]) => {
    const currentDoc = doc()
    if (!currentDoc) return
    let currentValue: unknown = currentDoc
    for (const p of path) currentValue = (currentValue as any)?.[p]
    undoRedo.push({
      type: "edit",
      path: path as Automerge.Prop[],
      oldValue: currentValue,
      newValue: value,
    })
    changeDoc((d: any) => applyAtPath(d, path as Automerge.Prop[], value))
  }

  const onDelete = (value: unknown, path: CollectionKey[]) => {
    undoRedo.push({ type: "delete", path: path as Automerge.Prop[], oldValue: value })
    changeDoc((d: any) => deleteAtPath(d, path as Automerge.Prop[]))
  }

  const onAdd = (value: unknown, path: CollectionKey[]) => {
    undoRedo.push({ type: "add", path: path as Automerge.Prop[], newValue: value })
    changeDoc((d: any) => applyAtPath(d, path as Automerge.Prop[], value))
  }

  const onDownloadAutomerge = () => {
    const d = doc()
    if (!d) return
    downloadBlob(
      new Blob([Automerge.save(d) as BlobPart], {
        type: "application/octet-stream",
      }),
      `${props.handle.documentId}.automerge`
    )
  }

  const onDownloadJson = () => {
    const d = doc()
    if (!d) return
    downloadBlob(
      new Blob([JSON.stringify(prepareForJson(d), null, 2)], {
        type: "application/json",
      }),
      `${props.handle.documentId ?? "document"}.json`
    )
  }

  const [urlCopied, setUrlCopied] = createSignal(false)
  let urlCopyTimeout: ReturnType<typeof setTimeout>
  onCleanup(() => clearTimeout(urlCopyTimeout))
  const copyUrl = () => {
    navigator.clipboard.writeText(docUrl).then(() => {
      setUrlCopied(true)
      clearTimeout(urlCopyTimeout)
      urlCopyTimeout = setTimeout(() => setUrlCopied(false), 1500)
    })
  }

  // Keyboard handler: Cmd+Z undo, Cmd+Shift+Z redo, Escape cancel
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      const cancelBtn = props.element.querySelector(
        ".te-confirm-buttons .te-icon-cancel"
      ) as HTMLElement | null
      if (cancelBtn) {
        e.preventDefault()
        e.stopPropagation()
        cancelBtn.click()
      }
      return
    }
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault()
      if (e.shiftKey) undoRedo.redo()
      else undoRedo.undo()
    }
  }
  document.addEventListener("keydown", keyHandler, true)
  onCleanup(() => document.removeEventListener("keydown", keyHandler, true))

  return (
    <div class="raw-editor-wrapper">
      <Show
        when={doc()}
        fallback={
          <div class="re-loading">Loading {docUrl}…</div>
        }
      >
        {(loadedDoc) => (
          <>
            <div class="re-toolbar">
              <span
                class={`re-url${urlCopied() ? " re-url--copied" : ""}`}
                title="Click to copy"
                onClick={copyUrl}
              >
                {urlCopied() ? "Copied!" : docUrl}
              </span>
              <div class="re-actions">
                <button
                  class="re-btn"
                  onClick={() => undoRedo.undo()}
                  disabled={!undoRedo.canUndo()}
                  title="Undo (Ctrl+Z)"
                >
                  <UndoIcon /> Undo
                </button>
                <button
                  class="re-btn"
                  onClick={() => undoRedo.redo()}
                  disabled={!undoRedo.canRedo()}
                  title="Redo (Ctrl+Shift+Z)"
                >
                  <RedoIcon /> Redo
                </button>
                <button
                  class="re-btn"
                  onClick={onDownloadJson}
                  title="Download as JSON"
                >
                  <DownloadIcon /> JSON
                </button>
                <button
                  class="re-btn"
                  onClick={onDownloadAutomerge}
                  title="Download Automerge binary"
                >
                  <DownloadIcon /> .automerge
                </button>
              </div>
            </div>

            <div class="re-content">
              <TreeEditor
                data={loadedDoc()}
                onEdit={onEdit}
                onDelete={onDelete}
                onAdd={onAdd}
                collapse={collapseFilter}
                indent={3}
                showStringQuotes
                showCollectionCount="when-closed"
                enableClipboard
                customRenderers={customRenderers}
                jsonStringify={jsonStringifyWithUint8}
              />
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
