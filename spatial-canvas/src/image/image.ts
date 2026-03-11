import type { CanvasShape, AutomergeUrl } from '../core/types.js'

export interface ImageShape extends CanvasShape {
  type: 'image'
  fileUrl: AutomergeUrl  // URL of a UnixFileEntry Automerge doc
  width: number
  height: number
}
