import type { CanvasShape } from '../core/types.js'

export interface TextShape extends CanvasShape {
  type: 'text'
  text: string
  color?: string
  fontSize?: number  // default 18
}
