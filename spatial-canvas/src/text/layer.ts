import * as Automerge from '@automerge/automerge'
import type { CanvasDoc, DocHandle } from '../core/types.js'
import { deleteShapes } from '../core/commands.js'
import type { TextShape } from './text.js'

export const FONT_FAMILY = "'Cutive Mono', 'Courier New', Courier, monospace"
export const DEFAULT_FONT_SIZE = 18

// field-sizing:content lets the browser auto-size the textarea natively (Chrome 123+, Safari 18+).
// For Firefox we fall back to a mirror-span measurement.
const supportsFieldSizing = CSS.supports('field-sizing', 'content')

let fontInjected = false
function ensureFont() {
  if (fontInjected) return
  fontInjected = true
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap'
  document.head.appendChild(link)
}

interface Entry {
  textarea: HTMLTextAreaElement
  mirror: HTMLSpanElement | null
  resize: () => void
}

export default function TextLayer(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): () => void {
  ensureFont()
  element.style.cssText = 'position:absolute;inset:0;'

  const mounted = new Map<string, Entry>()

  function applyMutableStyles(textarea: HTMLTextAreaElement, mirror: HTMLSpanElement | null, text: TextShape) {
    const size  = text.fontSize ?? DEFAULT_FONT_SIZE
    const color = text.color ?? '#1a1a1a'
    textarea.style.transform = `translate(${text.x}px,${text.y}px)`
    textarea.style.zIndex    = String(text.zIndex)
    textarea.style.color     = color
    textarea.style.fontSize  = `${size}px`
    if (mirror) mirror.style.fontSize = `${size}px`
  }

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>()
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === 'text') currentIds.add(shape.id)
    }

    for (const [id, { textarea, mirror }] of mounted) {
      if (!currentIds.has(id)) {
        textarea.remove()
        mirror?.remove()
        mounted.delete(id)
      }
    }

    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== 'text') continue
      const text = shape as TextShape

      let entry = mounted.get(text.id)
      if (!entry) {
        const size  = text.fontSize ?? DEFAULT_FONT_SIZE
        const color = text.color ?? '#1a1a1a'

        const textarea = document.createElement('textarea')
        textarea.spellcheck = false
        textarea.rows = 1
        textarea.dataset.shapeId = text.id

        const baseStyles = [
          'position:absolute', 'top:0', 'left:0',
          'resize:none', 'overflow:hidden', 'border:none', 'outline:none',
          'background:transparent', 'padding:0', 'margin:0',
          'white-space:pre', 'cursor:text', 'line-height:1.4',
          `font-family:${FONT_FAMILY}`,
          `font-size:${size}px`,
          `color:${color}`,
          `transform:translate(${text.x}px,${text.y}px)`,
          `z-index:${text.zIndex}`,
        ]
        if (supportsFieldSizing) baseStyles.push('field-sizing:content')
        textarea.style.cssText = baseStyles.join(';')

        let mirror: HTMLSpanElement | null = null
        let resize: () => void

        if (supportsFieldSizing) {
          // Browser handles sizing natively — no JS measurement needed
          resize = () => {}
        } else {
          mirror = document.createElement('span')
          mirror.style.cssText = [
            'position:absolute', 'visibility:hidden', 'pointer-events:none',
            'white-space:pre', 'top:0', 'left:0', 'line-height:1.4',
            `font-family:${FONT_FAMILY}`,
            `font-size:${size}px`,
          ].join(';')
          element.appendChild(mirror)

          resize = () => {
            const val = textarea.value
            // Trailing newline needs a dummy char so the extra line is measured
            mirror!.textContent = val.endsWith('\n') ? val + ' ' : (val || ' ')
            textarea.style.width  = mirror!.offsetWidth  + 'px'
            textarea.style.height = mirror!.offsetHeight + 'px'
          }
        }

        element.appendChild(textarea)

        entry = { textarea, mirror, resize }
        mounted.set(text.id, entry)

        textarea.addEventListener('pointerdown', e => e.stopPropagation())

        textarea.addEventListener('input', () => {
          resize()
          handle.change(d => {
            Automerge.updateText(
              d as Automerge.Doc<unknown>,
              ['shapes', text.id, 'text'],
              textarea.value,
            )
          })
        })

        textarea.addEventListener('blur', () => {
          if (!textarea.value.trim()) deleteShapes(handle, [text.id])
        })

        textarea.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Escape') textarea.blur()
        })

        textarea.value = text.text ?? ''
        resize()

        // New empty shape — focus immediately
        if (!text.text) requestAnimationFrame(() => textarea.focus())
      } else {
        applyMutableStyles(entry.textarea, entry.mirror, text)

        if (document.activeElement !== entry.textarea) {
          const newValue = text.text ?? ''
          if (entry.textarea.value !== newValue) {
            entry.textarea.value = newValue
            entry.resize()
          }
        }
      }
    }
  }

  handle.on('change', render)
  const initial = handle.doc()
  if (initial) render({ doc: initial })

  return () => {
    handle.off('change', render)
    for (const { textarea, mirror } of mounted.values()) {
      textarea.remove()
      mirror?.remove()
    }
    mounted.clear()
  }
}
