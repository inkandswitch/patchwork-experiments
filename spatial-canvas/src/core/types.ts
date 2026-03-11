// ============================================================================
// Automerge document types
// ============================================================================

export type AutomergeUrl = string

/**
 * Minimal base shape stored in the canvas doc.
 * Each tool extends this with its own fields (e.g. RectangleShape, PenShape).
 */
export interface CanvasShape {
  id: string
  x: number
  y: number
  zIndex: number
  type: string
}

export interface CanvasDoc {
  shapes: Record<string, CanvasShape>
  selectionByUser: { [contactUrl: string]: { [shapeId: string]: true } }
}

// ============================================================================
// Ephemeral / runtime types
// ============================================================================

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Vec2 {
  x: number
  y: number
}

export interface PointerInfo {
  x: number          // page coordinates
  y: number
  dx: number         // delta from last event
  dy: number
  origin: Vec2       // page coordinates at pointer-down
  pointerId: number
  buttons: number
  shiftKey: boolean
  metaKey: boolean
  altKey: boolean
}

export type Disposer = () => void

// ============================================================================
// DocHandle — minimal interface matching Automerge's DocHandle API
// ============================================================================

export interface DocHandle<T> {
  doc(): T | undefined
  on(event: 'change', callback: (payload: { doc: T }) => void): void
  off(event: 'change', callback: (payload: { doc: T }) => void): void
  change(fn: (doc: T) => void): void
  url: AutomergeUrl
}
