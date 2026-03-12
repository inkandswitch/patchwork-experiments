import { getSupportedToolsForType } from '@inkandswitch/patchwork-plugins'
import type { CanvasDoc, DocHandle } from '../core/types.js'
import { createShape, nextZIndex, newId } from '../core/commands.js'
import { screenToCanvas } from '../core/inputs.js'
import type { ImageShape } from '../image/image.js'
import type { EmbedShape } from '../embed/types.js'

const MAX_IMAGE_SIZE = 500
const DEFAULT_EMBED_WIDTH  = 400
const DEFAULT_EMBED_HEIGHT = 300
const EMBED_GAP = 16

/** Scale dimensions so neither side exceeds MAX_IMAGE_SIZE, preserving aspect ratio. */
function clampSize(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/** Read image dimensions from bytes by loading a temporary in-memory Image. */
function imageDimensions(bytes: Uint8Array, mimeType: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
    const url  = URL.createObjectURL(blob)
    const img  = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image for dimension check')) }
    img.src = url
  })
}

/** Pick the best tool ID for a docType: prefer specific support over wildcard. */
function resolveToolId(docType: string): string {
  const tools = getSupportedToolsForType(docType).filter(t => !(t as any).unlisted)
  console.log('[drop-layer] resolveToolId', docType, '→ candidates:', tools.map(t => (t as any).id))
  const specific = tools.find(t => {
    const sd = (t as any).supportedDatatypes
    return Array.isArray(sd) && !sd.includes('*')
  })
  return specific?.id ?? tools[0]?.id ?? ''
}

export default function DropLayer(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): () => void {
  const repo     = (element.closest('.sc-container') as any)?.repo
  const canvasEl = element.closest('.sc-canvas') as HTMLElement | null

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer) return
    const types = e.dataTransfer.types
    if (!types.includes('Files') && !types.includes('text/x-patchwork-urls')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    if (!e.dataTransfer || !repo || !canvasEl) return

    const pos = screenToCanvas(canvasEl, e.clientX, e.clientY)

    // ---- Patchwork URL drops -------------------------------------------

    const patchworkRaw = e.dataTransfer.getData('text/x-patchwork-urls')
    if (patchworkRaw) {
      let urls: string[]
      try { urls = JSON.parse(patchworkRaw) } catch { urls = [] }

      for (let i = 0; i < urls.length; i++) {
        const docUrl = urls[i]
        let docType = ''

        let toolId = ''
        try {
          const fileHandle = repo.find(docUrl)
          const doc = (fileHandle as any).doc() as any
          docType = doc?.['@patchwork']?.type ?? ''
          toolId  = resolveToolId(docType)
          console.log('[drop-layer] patchwork url:', docUrl, '→ docType:', docType || '(empty)', '→ toolId:', toolId || '(none)')
        } catch (err) {
          console.warn('[drop-layer] could not read @patchwork.type for', docUrl, err)
        }

        const canvasDoc = handle.doc()
        const shape: EmbedShape = {
          id:      newId(),
          type:    'embed',
          x:       pos.x,
          y:       pos.y + i * (DEFAULT_EMBED_HEIGHT + EMBED_GAP),
          zIndex:  canvasDoc ? nextZIndex(canvasDoc) : 0,
          docUrl,
          docType,
          toolId,
          width:   DEFAULT_EMBED_WIDTH,
          height:  DEFAULT_EMBED_HEIGHT,
        }
        createShape(handle, shape)
      }
    }

    // ---- Image file drops ----------------------------------------------

    const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))

    for (const file of imageFiles) {
      const buf   = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)

      const { w, h } = await imageDimensions(bytes, file.type)
      const { width, height } = clampSize(w, h)

      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : ''

      const fileHandle = repo.create()
      fileHandle.change((d: any) => {
        d.content   = bytes
        d.mimeType  = file.type
        d.extension = ext
        d.name      = file.name
      })

      const canvasDoc = handle.doc()
      const shape: ImageShape = {
        id:      newId(),
        type:    'image',
        x:       pos.x,
        y:       pos.y,
        zIndex:  canvasDoc ? nextZIndex(canvasDoc) : 0,
        fileUrl: fileHandle.url,
        width,
        height,
      }
      createShape(handle, shape)
    }
  }

  canvasEl?.addEventListener('dragover', onDragOver)
  canvasEl?.addEventListener('drop', onDrop)

  return () => {
    canvasEl?.removeEventListener('dragover', onDragOver)
    canvasEl?.removeEventListener('drop', onDrop)
  }
}
