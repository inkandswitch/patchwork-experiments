import { createContext, createSelector, createSignal, useContext } from "solid-js"
import type { CollectionKey, CustomRenderer, NodeData } from "./types"

export interface EditingInfo {
  pathString: string
  path: CollectionKey[]
  value: unknown
  nodeData: NodeData
}

export interface EditorContext {
  isEditing: (pathString: string) => boolean
  startEditing: (info: EditingInfo) => void
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
    startEditing(info: EditingInfo) {
      setEditingPath(info.pathString)
    },
    stopEditing() {
      setEditingPath(null)
    },
  }
}
