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

/** Read image dimensions from a File without adding it to the DOM. */
function imageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth,  h: img.naturalHeight }) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')) }
    img.src = url
  })
}

export default function ImageLayer(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): () => void {
  element.style.cssText = 'position:absolute;inset:0;'

  const repo = (element.closest('.sc-container') as any)?.repo
  const canvasEl = element.closest('.sc-canvas') as HTMLElement | null

  // ---- Rendering -------------------------------------------------------

  /** Per-shape blob URLs — revoked when the shape is removed. */
  const blobUrls  = new Map<string, string>()
  const mounted   = new Map<string, HTMLImageElement>()

  function setBlobSrc(img: HTMLImageElement, shape: ImageShape) {
    if (blobUrls.has(shape.id)) return  // already resolved
    if (!repo) return

    const fileHandle = repo.find(shape.fileUrl)

    function tryLoad() {
      const doc = fileHandle.doc()
      if (!doc) return
      const content = doc.content as Uint8Array | undefined
      if (!content) return
      const blob = new Blob([content], { type: doc.mimeType ?? 'image/png' })
      const url  = URL.createObjectURL(blob)
      blobUrls.set(shape.id, url)
      img.src = url
      fileHandle.off('change', tryLoad)
    }

    tryLoad()
    if (!blobUrls.has(shape.id)) {
      fileHandle.on('change', tryLoad)
    }
  }

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>()
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === 'image') currentIds.add(shape.id)
    }

    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) {
        el.remove()
        const url = blobUrls.get(id)
        if (url) { URL.revokeObjectURL(url); blobUrls.delete(id) }
        mounted.delete(id)
      }
    }

    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== 'image') continue
      const img_shape = shape as ImageShape

      let img = mounted.get(img_shape.id)
      if (!img) {
        img = document.createElement('img')
        img.style.cssText = 'position:absolute;top:0;left:0;display:block;'
        img.dataset.shapeId = img_shape.id
        img.draggable = false
        element.appendChild(img)
        mounted.set(img_shape.id, img)
        setBlobSrc(img, img_shape)
      }

      img.style.transform = `translate(${img_shape.x}px,${img_shape.y}px)`
      img.style.width     = `${img_shape.width}px`
      img.style.height    = `${img_shape.height}px`
      img.style.zIndex    = String(img_shape.zIndex)
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
    if (!e.dataTransfer || !repo || !canvasEl) return

    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (!files.length) return

    const pos = screenToCanvas(canvasEl, e.clientX, e.clientY)

    for (const file of files) {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)

      const { w, h } = await imageDimensions(file)
      const { width, height } = clampSize(w, h)

      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : ''

      const fileHandle = repo.create()
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
    for (const url of blobUrls.values()) URL.revokeObjectURL(url)
    mounted.clear()
    blobUrls.clear()
  }
}
