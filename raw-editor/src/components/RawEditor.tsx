import * as Automerge from "@automerge/automerge"
import {
  type AutomergeUrl,
  type DocHandle,
  isValidAutomergeUrl,
} from "@automerge/automerge-repo"
import { OpenDocumentEvent } from "@inkandswitch/patchwork-elements"
import { createSignal, onCleanup, Show } from "solid-js"
import { render } from "solid-js/web"
import { TreeEditor, type CollectionKey, type TreeEditorHandle } from "../tree-editor"
import { Uint8ArrayInspector } from "./Uint8ArrayInspector"
import { UndoIcon, RedoIcon, DownloadIcon } from "../tree-editor/Icons"
import { applyAtPath, deleteAtPath } from "../automerge-helpers"
import { createUndoRedo } from "../undo-redo"
import { createFontState, FontPicker } from "../font-picker"
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

function cloneValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
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
      oldValue: cloneValue(currentValue),
      newValue: cloneValue(value),
    })
    changeDoc((d: any) => applyAtPath(d, path as Automerge.Prop[], value))
  }

  const onDelete = (value: unknown, path: CollectionKey[]) => {
    undoRedo.push({ type: "delete", path: path as Automerge.Prop[], oldValue: cloneValue(value) })
    changeDoc((d: any) => deleteAtPath(d, path as Automerge.Prop[]))
  }

  const onAdd = (value: unknown, path: CollectionKey[]) => {
    undoRedo.push({ type: "add", path: path as Automerge.Prop[], newValue: cloneValue(value) })
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

  const font = createFontState()

  let treeHandle: TreeEditorHandle | undefined

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      treeHandle?.stopEditing()
      return
    }
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault()
      if (e.shiftKey) undoRedo.redo()
      else undoRedo.undo()
    }
  }

  return (
    <div class="raw-editor-wrapper" tabIndex={-1} onKeyDown={keyHandler} style={{ "font-family": font.fontFamily() }}>
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
              <FontPicker fontId={font.fontId} onSelect={font.selectFont} />
            </div>

            <div class="re-content">
              <TreeEditor
                ref={(h) => { treeHandle = h }}
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
              />
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
