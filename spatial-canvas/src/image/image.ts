import type { AutomergeUrl } from '@automerge/automerge-repo'
import type { CanvasShape } from '../canvas/types.js'

export interface ImageShape extends CanvasShape {
  type: 'image'
  fileUrl: AutomergeUrl  // URL of a UnixFileEntry Automerge doc
  width: number
  height: number
}
