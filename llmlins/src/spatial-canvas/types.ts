// ============================================================================
// Automerge document types
// ============================================================================

import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo'
export type { AutomergeUrl, DocHandle }

export interface CanvasShape {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number  // radians
  zIndex: number
  docUrl: AutomergeUrl
  toolId: string
  shapeType: 'embed' | 'token'
}

export interface CanvasDoc {
  shapes: Record<string, CanvasShape>
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

export interface Session {
  update(info: PointerInfo): void
  complete(info: PointerInfo): void
  cancel(): void
}

export interface MountedShape {
  updatePosition(shape: CanvasShape): void
  setSelected(selected: boolean): void
  unmount(): void
}

export type Disposer = () => void

