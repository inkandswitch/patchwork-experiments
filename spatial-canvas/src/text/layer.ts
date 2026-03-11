import * as Automerge from '@automerge/automerge'
import type { CanvasDoc, DocHandle } from '../core/types.js'
import { deleteShapes } from '../core/commands.js'
import type { TextShape } from './text.js'

export const FONT_FAMILY = "'Playpen Sans', 'Comic Sans MS', cursive, sans-serif"
export const DEFAULT_FONT_SIZE = 18

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

function applyTextStyles(el: HTMLElement, shape: TextShape) {
  const size = shape.fontSize ?? DEFAULT_FONT_SIZE
  const color = shape.color ?? '#1a1a1a'
  el.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'white-space:pre-wrap',
    'word-break:break-word',
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
    `line-height:1.4`,
  ].join(';')
}

/**
 * Opens an inline contenteditable editor for a text shape, positioned inside
 * the .sc-layer container. Used by both the layer (double-click) and the
 * place-tool (on creation).
 */
export function openEditor(
  handle: DocHandle<CanvasDoc>,
  container: HTMLElement,
  shapeId: string,
  onClose?: () => void,
) {
  const doc = handle.doc()
  if (!doc) return
  const shape = doc.shapes[shapeId] as TextShape | undefined
  if (!shape) return

  const size = shape.fontSize ?? DEFAULT_FONT_SIZE
  const color = shape.color ?? '#1a1a1a'

  const editor = document.createElement('div')
  editor.contentEditable = 'true'
  editor.spellcheck = false
  editor.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'white-space:pre-wrap',
    'word-break:break-word',
    'min-width:4px',
    'min-height:1em',
    'outline:none',
    'cursor:text',
    `transform:translate(${shape.x}px,${shape.y}px)`,
    `z-index:2147483647`,
    `font-family:${FONT_FAMILY}`,
    `font-size:${size}px`,
    `color:${color}`,
    `line-height:1.4`,
    'caret-color:auto',
  ].join(';')

  editor.textContent = shape.text ?? ''
  container.appendChild(editor)

  // Place cursor at end
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)

  editor.focus()

  function commit() {
    const text = editor.textContent ?? ''
    if (text.trim() === '') {
      deleteShapes(handle, [shapeId])
    } else {
      handle.change(d => {
        Automerge.updateText(d as Automerge.Doc<unknown>, ['shapes', shapeId, 'text'], text)
      })
    }
    editor.remove()
    onClose?.()
  }

  editor.addEventListener('blur', commit, { once: true })

  editor.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      editor.removeEventListener('blur', commit)
      editor.remove()
      // If there was no pre-existing text (new shape), delete it
      const currentText = handle.doc()?.shapes[shapeId] as TextShape | undefined
      if (!currentText?.text?.trim()) {
        deleteShapes(handle, [shapeId])
      }
      onClose?.()
    }
  })

  return editor
}

/**
 * TextLayer — renders all shapes with type === 'text' as positioned divs.
 */
export default function TextLayer(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): () => void {
  ensureFont()
  element.style.cssText = 'position:absolute;inset:0;'

  const mounted = new Map<string, HTMLElement>()
  // Track which shapes are currently being edited so we skip re-rendering them
  const editing = new Set<string>()

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>()
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === 'text') currentIds.add(shape.id)
    }

    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) {
        el.remove()
        mounted.delete(id)
      }
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

        el.addEventListener('dblclick', () => {
          if (editing.has(text.id)) return
          editing.add(text.id)
          // Hide the static div while editing
          el!.style.visibility = 'hidden'
          openEditor(handle, element, text.id, () => {
            editing.delete(text.id)
            if (el) el.style.visibility = ''
          })
        })
      }

      if (!editing.has(text.id)) {
        applyTextStyles(el, text)
        el.textContent = text.text ?? ''
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
