import * as Automerge from "@automerge/automerge"
import { createSignal } from "solid-js"
import { applyAtPath, deleteAtPath } from "./automerge-helpers"

export type UndoEntry =
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

export function createUndoRedo(changeDoc: (fn: (d: any) => void) => void) {
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
