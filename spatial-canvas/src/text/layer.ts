import type { CanvasDoc, DocHandle } from '../core/types.js'
import type { TextShape } from './text.js'
import { FONT_FAMILY, DEFAULT_FONT_SIZE, isEditing, openEditor } from './editor.js'

function applyTextStyles(el: HTMLElement, shape: TextShape) {
  const size = shape.fontSize ?? DEFAULT_FONT_SIZE
  const color = shape.color ?? '#1a1a1a'
  el.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'white-space:pre',
    'min-width:4px',
    'min-height:1em',
    'outline:none',
    'cursor:default',
    'user-select:none',
    `transform:translate(${shape.x}px,${shape.y}px)`,
    `z-index:${shape.zIndex}`,
    `font-family:${FONT_FAMILY}`,
    `font-size:${size}px`,
    `color:${color}`,
    'line-height:1.4',
  ].join(';')
}

// Inject Google Fonts once per page load
let fontInjected = false
function ensureFont() {
  if (fontInjected) return
  fontInjected = true
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Playpen+Sans:wght@400;700&display=swap'
  document.head.appendChild(link)
}

export default function TextLayer(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): () => void {
  ensureFont()
  element.style.cssText = 'position:absolute;inset:0;'

  const mounted = new Map<string, HTMLElement>()

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>()
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === 'text') currentIds.add(shape.id)
    }

    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) { el.remove(); mounted.delete(id) }
    }

    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== 'text') continue
      const text = shape as TextShape

      let el = mounted.get(text.id)
      if (!el) {
        el = document.createElement('div')
        el.dataset.shapeId = text.id
        element.appendChild(el)
        mounted.set(text.id, el)

        el.addEventListener('pointerdown', e => e.stopPropagation())
        el.addEventListener('click', (e: MouseEvent) => {
          if (isEditing(element, text.id)) return
          el!.style.visibility = 'hidden'
          openEditor(handle, element, text.id,
            () => { if (el) el.style.visibility = '' },
            { clientX: e.clientX, clientY: e.clientY },
          )
        })

        // New shape with no text — open editor immediately
        if (!text.text) {
          openEditor(handle, element, text.id,
            () => { if (el) el.style.visibility = '' },
          )
        }
      }

      if (!isEditing(element, text.id)) {
        applyTextStyles(el, text)
        el.textContent = text.text ?? ''
      } else {
        el.style.visibility = 'hidden'
      }
    }
  }

  handle.on('change', render)
  const initial = handle.doc()
  if (initial) render({ doc: initial })

  return () => {
    handle.off('change', render)
    for (const el of mounted.values()) el.remove()
    mounted.clear()
  }
}
