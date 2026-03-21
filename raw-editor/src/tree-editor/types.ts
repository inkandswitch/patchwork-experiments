import type { JSX } from "solid-js"

export type CollectionKey = string | number

export interface NodeData {
  key: CollectionKey
  path: CollectionKey[]
  level: number
  value: unknown
  size: number | null
  parentData: object | null
}

export interface EditorProps {
  data: unknown
  onEdit: (value: unknown, path: CollectionKey[]) => void
  onDelete: (value: unknown, path: CollectionKey[]) => void
  onAdd: (value: unknown, path: CollectionKey[]) => void
  collapse?: (nodeData: NodeData) => boolean
  indent?: number
  showStringQuotes?: boolean
  showCollectionCount?: boolean | "when-closed"
  enableClipboard?: boolean
  showArrayIndices?: boolean
  customRenderers?: CustomRenderer[]
  jsonStringify?: (data: unknown) => string
}

export interface CustomRenderer {
  condition: (nodeData: { value: unknown; path: CollectionKey[] }) => boolean
  render: (props: { value: unknown; nodeData: NodeData }) => JSX.Element
  showEditTools?: boolean
}
