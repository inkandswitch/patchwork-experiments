import type { CanvasDoc, DocHandle } from '../core/types.js'
import { createShape, nextZIndex, newId } from '../core/commands.js'
import { screenToCanvas } from '../core/inputs.js'
import type { ImageShape } from './image.js'

const MAX_SIZE = 500

/** Scale dimensions so neither side exceeds MAX_SIZE, preserving aspect ratio. */
function clampSize(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_SIZE / Math.max(w, h))
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

/** Convert an automerge URL to a service-worker-served HTTP URL. */
function automergeToHttpUrl(automergeUrl: string): string {
  return `/${encodeURIComponent(automergeUrl)}`
}

export default function ImageLayer(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): () => void {
  element.style.cssText = 'position:absolute;inset:0;'

  const repo     = (element.closest('.sc-container') as any)?.repo
  const canvasEl = element.closest('.sc-canvas') as HTMLElement | null

  // ---- Rendering -------------------------------------------------------

  const mounted = new Map<string, HTMLImageElement>()

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>()
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === 'image') currentIds.add(shape.id)
    }

    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) {
        el.remove()
        mounted.delete(id)
      }
    }

    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== 'image') continue
      const s = shape as ImageShape

      let img = mounted.get(s.id)
      if (!img) {
        img = document.createElement('img')
        img.style.cssText = 'position:absolute;top:0;left:0;display:block;'
        img.dataset.shapeId = s.id
        img.draggable = false
        img.onload  = () => console.log('[image-layer] img loaded', s.id, img!.naturalWidth, 'x', img!.naturalHeight)
        img.onerror = (e) => console.error('[image-layer] img failed to load', s.id, automergeToHttpUrl(s.fileUrl), e)
        img.src = automergeToHttpUrl(s.fileUrl)
        element.appendChild(img)
        mounted.set(s.id, img)
      }

      img.style.transform = `translate(${s.x}px,${s.y}px)`
      img.style.width     = `${s.width}px`
      img.style.height    = `${s.height}px`
      img.style.zIndex    = String(s.zIndex)
    }
  }

  handle.on('change', render)
  const initial = handle.doc()
  if (initial) render({ doc: initial })

  // ---- Drop handling ---------------------------------------------------

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    console.log('[image-layer] drop event', { hasTransfer: !!e.dataTransfer, hasRepo: !!repo, hasCanvas: !!canvasEl })
    if (!e.dataTransfer || !repo || !canvasEl) return

    const allFiles = Array.from(e.dataTransfer.files)
    console.log('[image-layer] dropped files:', allFiles.map(f => `${f.name} (${f.type})`))

    const files = allFiles.filter(f => f.type.startsWith('image/'))
    if (!files.length) { console.warn('[image-layer] no image files in drop'); return }

    const pos = screenToCanvas(canvasEl, e.clientX, e.clientY)
    console.log('[image-layer] canvas position:', pos)

    for (const file of files) {
      console.log('[image-layer] processing', file.name, file.type, file.size, 'bytes')
      const buf   = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)

      const { w, h } = await imageDimensions(bytes, file.type)
      const { width, height } = clampSize(w, h)
      console.log('[image-layer] dimensions:', w, 'x', h, '→', width, 'x', height)

      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : ''

      const fileHandle = repo.create()
      console.log('[image-layer] created file doc', fileHandle.url)
      fileHandle.change((d: any) => {
        d.content   = bytes
        d.mimeType  = file.type
        d.extension = ext
        d.name      = file.name
      })

      const doc = handle.doc()
      const shape: ImageShape = {
        id:      newId(),
        type:    'image',
        x:       pos.x,
        y:       pos.y,
        zIndex:  doc ? nextZIndex(doc) : 0,
        fileUrl: fileHandle.url,
        width,
        height,
      }
      console.log('[image-layer] creating shape', shape)
      createShape(handle, shape)
    }
  }

  canvasEl?.addEventListener('dragover', onDragOver)
  canvasEl?.addEventListener('drop', onDrop)

  return () => {
    handle.off('change', render)
    canvasEl?.removeEventListener('dragover', onDragOver)
    canvasEl?.removeEventListener('drop', onDrop)
    for (const el of mounted.values()) el.remove()
    mounted.clear()
  }
}
