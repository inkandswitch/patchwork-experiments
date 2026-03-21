import { createContext, createSelector, createSignal, useContext } from "solid-js"
import type { CollectionKey, CustomRenderer, NodeData } from "./types"

export interface EditorContext {
  isEditing: (pathString: string) => boolean
  startEditing: (pathString: string) => void
  stopEditing: () => void

  onEdit: (value: unknown, path: CollectionKey[]) => void
  onDelete: (value: unknown, path: CollectionKey[]) => void
  onAdd: (value: unknown, path: CollectionKey[]) => void
  collapse: (nodeData: NodeData) => boolean
  indent: number
  showStringQuotes: boolean
  showCollectionCount: boolean | "when-closed"
  showArrayIndices: boolean
  enableClipboard: boolean
  customRenderers: CustomRenderer[]
  jsonStringify: (data: unknown) => string
}

const Ctx = createContext<EditorContext>()
export const EditorProvider = Ctx.Provider
export const useEditor = () => useContext(Ctx)!

export function createEditingState() {
  const [editingPath, setEditingPath] = createSignal<string | null>(null)
  const isEditing = createSelector(editingPath)

  return {
    isEditing,
    startEditing(pathString: string) {
      setEditingPath(pathString)
    },
    stopEditing() {
      setEditingPath(null)
    },
  }
}
